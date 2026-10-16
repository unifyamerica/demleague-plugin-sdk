import { randomBytes, randomUUID } from 'crypto';
import {
  PluginPayloadTooLargeError,
  PluginPermissionDeniedError,
  PluginStorageQuotaExceededError,
  PluginUndeclaredCollectionError,
  PluginUndeclaredEventError,
  PluginUndeclaredLifecycleHookError,
} from '../errors/sdk-errors';
import {
  assertSafeDocument,
  assertSafeFilter,
  normalizeQuery,
  PluginQuery,
} from '../query/filter';
import { DataProxy, PluginCollection } from '../services/data.proxy';
import { EventBusProxy } from '../services/event-bus.proxy';
import { ModuleLifecycleProxy } from '../services/module-lifecycle.proxy';
import { PluginContext } from '../services/plugin-context';
import { PluginLogger } from '../services/plugin-logger';
import { PluginMembersQuery, UsersProxy } from '../services/users.proxy';
import {
  PluginActor,
  PluginOrganization,
  PluginPage,
  PluginRecord,
  PluginUser,
  PluginUserProfileUpdate,
} from '../types/dto';
import {
  assertEmittedInTenant,
  coreEventOrganizationId,
  coreEventUserId,
  EventPayload,
  PluginEvent,
  PluginEventHandler,
} from '../types/events';
import {
  DEFAULT_RESOURCE_LIMITS,
  PluginManifest,
  PluginResourceLimits,
} from '../types/manifest';
import {
  ModuleLifecycleEvent,
  ModuleLifecycleHandler,
  ModuleLifecycleHook,
  ModuleLifecycleHooks,
} from '../types/lifecycle';
import { PluginPermission } from '../types/permissions';
import { matchesFilter } from './match-filter';

// ℹ️ These stand in for the host's proxies in plugin unit tests. They enforce the same manifest rules the host
// does (permissions, declared collections & events, document size, storage limits), so a test fails where
// production would. What they can't reproduce is the acting user's own permissions, the rate limits and the
// registry's ceilings, which the host adds.

export class TestPluginContext extends PluginContext {
  private currentActor: PluginActor | null;
  private currentTenant: PluginOrganization | null = null;
  private currentEventUserId: string | null = null;
  private currentCaller: string | null = null;

  constructor(
    readonly manifest: Readonly<PluginManifest>,
    readonly permissions: ReadonlySet<PluginPermission>,
    actor: PluginActor | null,
  ) {
    super();
    this.currentActor = actor;
  }

  get namespace(): string {
    return this.manifest.namespace;
  }

  // Like the host: the actor only carries their membership in the current organization (none without one)
  actor(): PluginActor | null {
    if (!this.currentActor) {
      return null;
    }
    const tenantId = this.currentTenant?.id;
    return {
      ...this.currentActor,
      memberships: tenantId
        ? this.currentActor.memberships
            .filter((membership) => membership.organizationId === tenantId)
            .map((membership) => ({
              ...membership,
              roles: [...membership.roles],
            }))
        : [],
    };
  }

  /** Changes who the "request" is made by, `null` for a public endpoint / event handler. */
  setActor(actor: PluginActor | null): void {
    this.currentActor = actor;
  }

  tenant(): PluginOrganization | null {
    return this.currentTenant;
  }

  /** Changes which organization the "request" (or event handler) works in, `null` for none. */
  setTenant(tenant: PluginOrganization | null): void {
    this.currentTenant = tenant;
  }

  // The user a core event without an organization is about, while its handlers run (set by `deliver()`)
  eventUserId(): string | null {
    return this.currentEventUserId;
  }

  setEventUserId(userId: string | null): void {
    this.currentEventUserId = userId;
  }

  caller(): string | null {
    return this.currentCaller;
  }

  /** The module calling one of the plugin's exported operations (set by the harness's `invokeExport()`). */
  setCaller(caller: string | null): void {
    this.currentCaller = caller;
  }

  /**
   * Like the host: whether the plugin may see this user. In an organization, its active members (here: users
   * with a membership in it); without one, only the acting user or the event's user.
   */
  canSeeUser(user: PluginUser): boolean {
    const tenantId = this.currentTenant?.id;
    if (tenantId) {
      return user.memberships.some(
        (membership) => membership.organizationId === tenantId,
      );
    }
    return user.id === (this.currentActor?.id ?? this.currentEventUserId);
  }

  assertPermission(permission: PluginPermission): void {
    if (!this.permissions.has(permission)) {
      throw new PluginPermissionDeniedError(this.namespace, permission);
    }
  }
}

export class InMemoryUsersProxy extends UsersProxy {
  readonly users = new Map<string, PluginUser & { timezone?: string | null }>();

  constructor(
    private readonly context: TestPluginContext,
    users: PluginUser[] = [],
  ) {
    super();
    users.forEach((user) => this.users.set(user.id, structuredClone(user)));
  }

  // Like the host: only the current organization's membership is listed
  private toDto(user: PluginUser): PluginUser {
    const copy = structuredClone(user);
    delete (copy as { timezone?: unknown }).timezone;
    if (!this.context.permissions.has('users:read:email')) {
      delete copy.email;
    }
    const tenantId = this.context.tenant()?.id;
    copy.memberships = tenantId
      ? copy.memberships.filter(
          (membership) => membership.organizationId === tenantId,
        )
      : [];
    return copy;
  }

  private visibleUser(id: string) {
    const user = this.users.get(id);
    return user && this.context.canSeeUser(user) ? user : undefined;
  }

  async findById(id: string): Promise<PluginUser | null> {
    this.context.assertPermission('users:read');
    const user = this.visibleUser(id);
    return user ? this.toDto(user) : null;
  }

  async findByIds(ids: string[]): Promise<PluginUser[]> {
    this.context.assertPermission('users:read');
    return ids.flatMap((id) => {
      const user = this.visibleUser(id);
      return user ? [this.toDto(user)] : [];
    });
  }

  async findMembers(
    query: PluginMembersQuery = {},
  ): Promise<PluginPage<PluginUser>> {
    this.context.assertPermission('users:read');
    const { limit, skip } = normalizeQuery(query);
    const members = [...this.users.values()]
      .filter((user) => this.context.canSeeUser(user))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
      items: members.slice(skip, skip + limit).map((user) => this.toDto(user)),
      total: members.length,
      limit,
      skip,
    };
  }

  async updateProfile(
    id: string,
    changes: PluginUserProfileUpdate,
  ): Promise<PluginUser> {
    this.context.assertPermission('users:write');
    const user = this.visibleUser(id);
    if (!user) {
      throw new Error(`User ${id} not found`);
    }
    const { firstName, lastName, timezone } = changes;
    Object.assign(
      user,
      Object.fromEntries(
        Object.entries({ firstName, lastName, timezone }).filter(
          ([, value]) => value !== undefined,
        ),
      ),
    );
    return this.toDto(user);
  }
}

const newObjectId = (): string => randomBytes(12).toString('hex');

const HOST_FIELDS = [
  'id',
  'createdAt',
  'updatedAt',
  'createdBy',
  'organizationId',
  'isEnabled',
];

// The size the host counts against maxStorageBytes: the JSON of the plugin's own fields
// Like the host: fields left `undefined` (a DTO's unset optional fields) are neither stored nor overwrite anything
const definedFields = (document: object): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(document).filter(([, value]) => value !== undefined),
  );

function storedSize(record: object): number {
  return Buffer.byteLength(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(record).filter(([key]) => !HOST_FIELDS.includes(key)),
      ),
    ),
  );
}

/** Live documents across all of a plugin's collections, as the host counts them for the storage limits. */
export class InMemoryStorageUsage {
  documents = 0;
  bytes = 0;

  constructor(private readonly context: TestPluginContext) {}

  private limit(name: keyof PluginResourceLimits): number {
    return (
      this.context.manifest.limits?.[name] ?? DEFAULT_RESOURCE_LIMITS[name]
    );
  }

  reserve(documents: number, bytes: number): void {
    const maxDocuments = this.limit('maxDocuments');
    if (this.documents + documents > maxDocuments) {
      throw new PluginStorageQuotaExceededError(
        this.context.namespace,
        'maxDocuments',
        maxDocuments,
      );
    }
    const maxStorageBytes = this.limit('maxStorageBytes');
    if (bytes > 0 && this.bytes + bytes > maxStorageBytes) {
      throw new PluginStorageQuotaExceededError(
        this.context.namespace,
        'maxStorageBytes',
        maxStorageBytes,
      );
    }
    this.documents += documents;
    this.bytes += bytes;
  }
}

class InMemoryCollection<T extends object> implements PluginCollection<T> {
  constructor(
    private readonly context: TestPluginContext,
    private readonly records: Map<
      string,
      PluginRecord<T> & { isEnabled: boolean }
    >,
    private readonly usage: InMemoryStorageUsage,
  ) {}

  private assertSize(document: object): void {
    assertSafeDocument(document);
    const max =
      this.context.manifest.limits?.maxDocumentBytes ??
      DEFAULT_RESOURCE_LIMITS.maxDocumentBytes;
    // Like the host: only the plugin's own fields count, not the ones the host adds
    const size = storedSize(document);
    if (size > max) {
      throw new PluginPayloadTooLargeError(
        `Document is ${size} bytes, the limit is ${max}`,
      );
    }
  }

  // Like the host: only the current organization's records (`organizationId: null` ones without one), with or
  // without an acting user
  private visible(record: PluginRecord<T> & { isEnabled: boolean }): boolean {
    return (
      record.isEnabled &&
      (record.organizationId ?? null) === (this.context.tenant()?.id ?? null)
    );
  }

  private toRecord(
    record: PluginRecord<T> & { isEnabled: boolean },
  ): PluginRecord<T> {
    const { isEnabled: _isEnabled, ...copy } = structuredClone(record);
    return copy as unknown as PluginRecord<T>;
  }

  async insert(document: T): Promise<PluginRecord<T>> {
    this.context.assertPermission('data:write');
    this.assertSize(document);
    const organizationId = this.context.tenant()?.id ?? null;
    const now = new Date();
    const record = {
      ...structuredClone(definedFields(document)),
      id: newObjectId(),
      createdAt: now,
      updatedAt: now,
      createdBy: this.context.actor()?.id ?? null,
      organizationId,
      isEnabled: true,
    } as PluginRecord<T> & { isEnabled: boolean };
    this.usage.reserve(1, storedSize(record));
    this.records.set(record.id, record);
    return this.toRecord(record);
  }

  async findById(id: string): Promise<PluginRecord<T> | null> {
    this.context.assertPermission('data:read');
    const record = this.records.get(id);
    return record && this.visible(record) ? this.toRecord(record) : null;
  }

  async find(query?: PluginQuery): Promise<PluginPage<PluginRecord<T>>> {
    this.context.assertPermission('data:read');
    const { filter, sort, limit, skip } = normalizeQuery(query);
    const matches = [...this.records.values()].filter(
      (record) =>
        this.visible(record) &&
        matchesFilter(record as Record<string, unknown>, filter),
    );
    const sortEntries = Object.entries(sort);
    matches.sort((a, b) => {
      for (const [field, direction] of sortEntries) {
        const left = (a as Record<string, any>)[field];
        const right = (b as Record<string, any>)[field];
        if (left < right) return -direction;
        if (left > right) return direction;
      }
      return 0;
    });
    return {
      items: matches
        .slice(skip, skip + limit)
        .map((record) => this.toRecord(record)),
      total: matches.length,
      limit,
      skip,
    };
  }

  async count(filter?: PluginQuery['filter']): Promise<number> {
    this.context.assertPermission('data:read');
    assertSafeFilter(filter);
    return [...this.records.values()].filter(
      (record) =>
        this.visible(record) &&
        matchesFilter(record as Record<string, unknown>, filter),
    ).length;
  }

  async update(
    id: string,
    changes: Partial<T>,
  ): Promise<PluginRecord<T> | null> {
    this.context.assertPermission('data:write');
    const record = this.records.get(id);
    if (!record || !this.visible(record)) {
      return null;
    }
    const {
      id: _id,
      createdAt: _createdAt,
      createdBy: _createdBy,
      organizationId: _organizationId,
      isEnabled: _isEnabled,
      ...allowed
    } = changes as Record<string, unknown>;
    const next = {
      ...record,
      ...structuredClone(definedFields(allowed)),
      updatedAt: new Date(),
    };
    this.assertSize(next);
    this.usage.reserve(0, storedSize(next) - storedSize(record));
    this.records.set(id, next);
    return this.toRecord(next);
  }

  async remove(id: string): Promise<boolean> {
    this.context.assertPermission('data:write');
    const record = this.records.get(id);
    if (!record || !this.visible(record)) {
      return false;
    }
    record.isEnabled = false;
    this.usage.reserve(-1, -storedSize(record));
    return true;
  }
}

export class InMemoryDataProxy extends DataProxy {
  // Records by collection name, soft deleted ones included (`isEnabled: false`)
  readonly store = new Map<string, Map<string, any>>();
  // Counted against maxDocuments and maxStorageBytes, like the host does
  readonly usage: InMemoryStorageUsage;

  constructor(private readonly context: TestPluginContext) {
    super();
    this.usage = new InMemoryStorageUsage(context);
  }

  /** Like the host after `onDataRemoved`: deletes every record (removed ones too) of the organization, in all collections. */
  removeOrganizationData(organizationId: string): void {
    for (const records of this.store.values()) {
      for (const [id, record] of records) {
        if (record.organizationId !== organizationId) continue;
        if (record.isEnabled) this.usage.reserve(-1, -storedSize(record));
        records.delete(id);
      }
    }
  }

  collection<T extends object>(name: string): PluginCollection<T> {
    if (!(this.context.manifest.collections ?? []).includes(name)) {
      throw new PluginUndeclaredCollectionError(this.context.namespace, name);
    }
    if (!this.store.has(name)) {
      this.store.set(name, new Map());
    }
    return new InMemoryCollection<T>(
      this.context,
      this.store.get(name)!,
      this.usage,
    );
  }
}

export class RecordingEventBusProxy extends EventBusProxy {
  readonly emitted: PluginEvent[] = [];
  private readonly handlers = new Map<string, PluginEventHandler<any>[]>();

  constructor(
    private readonly context: TestPluginContext,
    // The organizations `deliver()` runs handlers in (the harness's `organizations` option)
    private readonly organizations: ReadonlyMap<
      string,
      PluginOrganization
    > = new Map(),
  ) {
    super();
  }

  emit<TName extends string>(name: TName, payload: EventPayload<TName>): void {
    if (!(this.context.manifest.events?.emits ?? []).includes(name)) {
      throw new PluginUndeclaredEventError(
        this.context.namespace,
        'emit',
        name,
      );
    }
    assertEmittedInTenant(payload, this.context.tenant()?.id ?? null);
    this.emitted.push({
      id: randomUUID(),
      name,
      source: this.context.namespace,
      emittedAt: new Date().toISOString(),
      organizationId: this.context.tenant()?.id ?? null,
      payload: structuredClone(payload),
    });
  }

  on<TName extends string>(
    name: TName,
    handler: PluginEventHandler<TName>,
  ): void {
    if (!(this.context.manifest.events?.subscribes ?? []).includes(name)) {
      throw new PluginUndeclaredEventError(
        this.context.namespace,
        'subscribe',
        name,
      );
    }
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
  }

  /**
   * Delivers an event to the plugin's handlers the way the host does: without an acting user, in the event's
   * organization (the tenant; looked up in the harness's `organizations` option), awaiting all handlers. Rejects with the
   * first handler error (the host logs it instead). The event's `organizationId` is a core event's
   * `payload.organizationId`, else `organizationId`. Unlike the host, it doesn't check the module is turned on in
   * that organization.
   */
  async deliver<TName extends string>(
    name: TName,
    payload: EventPayload<TName>,
    source = 'core',
    organizationId: string | null = null,
  ): Promise<void> {
    const event: PluginEvent<TName> = {
      id: randomUUID(),
      name,
      source,
      emittedAt: new Date().toISOString(),
      organizationId:
        source === 'core'
          ? coreEventOrganizationId(payload as Record<string, unknown>)
          : organizationId,
      payload: Object.freeze(structuredClone(payload)),
    };
    const previousActor = this.context.actor();
    const previousTenant = this.context.tenant();
    const previousEventUserId = this.context.eventUserId();
    this.context.setActor(null);
    this.context.setTenant(
      event.organizationId
        ? organizationFor(this.organizations, event.organizationId)
        : null,
    );
    this.context.setEventUserId(
      source === 'core'
        ? coreEventUserId(payload as Record<string, unknown>)
        : null,
    );
    try {
      for (const handler of this.handlers.get(name) ?? []) {
        await handler(event);
      }
    } finally {
      this.context.setActor(previousActor);
      this.context.setTenant(previousTenant);
      this.context.setEventUserId(previousEventUserId);
    }
  }

  subscribedEvents(): string[] {
    return [...this.handlers.keys()];
  }
}

export class RecordingPluginLogger extends PluginLogger {
  readonly messages: { level: string; message: unknown }[] = [];

  debug(message: unknown): void {
    this.messages.push({ level: 'debug', message });
  }
  info(message: unknown): void {
    this.messages.push({ level: 'info', message });
  }
  warning(message: unknown): void {
    this.messages.push({ level: 'warning', message });
  }
  error(message: unknown): void {
    this.messages.push({ level: 'error', message });
  }
}

// The harness's organization with that id, or a bare one when the test didn't list it
const organizationFor = (
  organizations: ReadonlyMap<string, PluginOrganization>,
  id: string,
): PluginOrganization =>
  organizations.get(id) ?? { id, name: '', slug: '', description: null };

export class InMemoryModuleLifecycleProxy extends ModuleLifecycleProxy {
  private readonly handlers = new Map<
    ModuleLifecycleHook,
    ModuleLifecycleHandler[]
  >();

  constructor(
    private readonly context: TestPluginContext,
    // The organizations `enable()` / `disable()` run hooks in (the harness's `organizations` option)
    private readonly organizations: ReadonlyMap<
      string,
      PluginOrganization
    > = new Map(),
    // Where `removeData()` deletes the organization's records
    private readonly data?: InMemoryDataProxy,
  ) {
    super();
  }

  onEnabled(handler: ModuleLifecycleHandler): void {
    this.register(ModuleLifecycleHooks.ON_ENABLED, handler);
  }

  onDisabled(handler: ModuleLifecycleHandler): void {
    this.register(ModuleLifecycleHooks.ON_DISABLED, handler);
  }

  onDataRemoved(handler: ModuleLifecycleHandler): void {
    this.register(ModuleLifecycleHooks.ON_DATA_REMOVED, handler);
  }

  onUpgraded(handler: ModuleLifecycleHandler): void {
    this.register(ModuleLifecycleHooks.ON_UPGRADED, handler);
  }

  private register(
    hook: ModuleLifecycleHook,
    handler: ModuleLifecycleHandler,
  ): void {
    if (!this.context.manifest.lifecycle?.[hook]) {
      throw new PluginUndeclaredLifecycleHookError(
        this.context.namespace,
        hook,
      );
    }
    this.handlers.set(hook, [...(this.handlers.get(hook) ?? []), handler]);
  }

  registeredHooks(): ModuleLifecycleHook[] {
    return [...this.handlers.keys()];
  }

  /** Runs the `onEnabled` hooks the way the host does when an org admin turns the module on in the organization. */
  enable(
    organizationId: string,
    event: Partial<Omit<ModuleLifecycleEvent, 'organizationId'>> = {},
  ): Promise<void> {
    return this.run(ModuleLifecycleHooks.ON_ENABLED, organizationId, event);
  }

  /** Runs the `onDisabled` hooks the way the host does when an org admin turns the module off in the organization. */
  disable(
    organizationId: string,
    event: Partial<Omit<ModuleLifecycleEvent, 'organizationId'>> = {},
  ): Promise<void> {
    return this.run(ModuleLifecycleHooks.ON_DISABLED, organizationId, event);
  }

  /**
   * Runs the `onDataRemoved` hooks, then deletes the organization's records like the host does (`harness.data`), when
   * an org admin removes the module's data there.
   */
  async removeData(
    organizationId: string,
    event: Partial<Omit<ModuleLifecycleEvent, 'organizationId'>> = {},
  ): Promise<void> {
    await this.run(ModuleLifecycleHooks.ON_DATA_REMOVED, organizationId, event);
    this.data?.removeOrganizationData(organizationId);
  }

  /** Runs the `onUpgraded` hooks the way the host does in an organization where the module is on after an upgrade. */
  upgrade(
    organizationId: string,
    event: Partial<Omit<ModuleLifecycleEvent, 'organizationId'>> = {},
  ): Promise<void> {
    return this.run(ModuleLifecycleHooks.ON_UPGRADED, organizationId, event);
  }

  /**
   * Without an acting user, in the organization (the tenant), awaiting the hooks. Rejects with the first error (the
   * host records it and retries the hook later). Run a hook twice in a test to check it's idempotent.
   */
  private async run(
    hook: ModuleLifecycleHook,
    organizationId: string,
    overrides: Partial<ModuleLifecycleEvent>,
  ): Promise<void> {
    const event: ModuleLifecycleEvent = {
      organizationId,
      firstTime: hook === ModuleLifecycleHooks.ON_ENABLED,
      lastEnabledAt: null,
      lastDisabledAt: null,
      pluginVersion: this.context.manifest.version,
      lastPluginVersion: null,
      attempt: 1,
      ...overrides,
    };
    const previousActor = this.context.actor();
    const previousTenant = this.context.tenant();
    const previousEventUserId = this.context.eventUserId();
    this.context.setActor(null);
    this.context.setTenant(organizationFor(this.organizations, organizationId));
    this.context.setEventUserId(null);
    try {
      for (const handler of this.handlers.get(hook) ?? []) {
        await handler(Object.freeze({ ...event }));
      }
    } finally {
      this.context.setActor(previousActor);
      this.context.setTenant(previousTenant);
      this.context.setEventUserId(previousEventUserId);
    }
  }
}
