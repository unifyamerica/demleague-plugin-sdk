import { Controller, Get, Injectable, OnModuleInit } from '@nestjs/common';
import { SDK_API_VERSION } from '../constants';
import { PluginModule } from '../decorators/plugin-module.decorator';
import {
  PluginPayloadTooLargeError,
  PluginPermissionDeniedError,
  PluginStorageQuotaExceededError,
  PluginUndeclaredCollectionError,
  PluginUndeclaredEventError,
  PluginValidationError,
} from '../errors/sdk-errors';
import { DataProxy } from '../services/data.proxy';
import { EventBusProxy } from '../services/event-bus.proxy';
import { ModuleLifecycleProxy } from '../services/module-lifecycle.proxy';
import { PluginUndeclaredLifecycleHookError } from '../errors/sdk-errors';
import type { ModuleLifecycleEvent } from '../types/lifecycle';
import { PluginContext } from '../services/plugin-context';
import { UsersProxy } from '../services/users.proxy';
import { createPluginTestHarness, PluginTestHarness } from './index';

@Injectable()
class CounterService implements OnModuleInit {
  seen: string[] = [];
  // What a member-added handler could see: [user ids found, records counted]
  memberAddedView: [string[], number][] = [];
  // onEnabled calls: the event and the organization it ran in
  enabledIn: [ModuleLifecycleEvent, string | null][] = [];
  // Other lifecycle hooks: [hook, organization it ran in, records it could see]
  hooksRun: [string, string | null, number][] = [];

  constructor(
    readonly data: DataProxy,
    readonly events: EventBusProxy,
    readonly users: UsersProxy,
    readonly lifecycle: ModuleLifecycleProxy,
    readonly context: PluginContext,
  ) {}

  onModuleInit() {
    this.events.on('core.user.created', async (event) => {
      this.seen.push(event.payload.userId);
      await this.data
        .collection<{ userId: string }>('counters')
        .insert({ userId: event.payload.userId });
    });
    this.lifecycle.onEnabled(async (event) => {
      this.enabledIn.push([event, this.context.tenant()?.id ?? null]);
      await this.data.collection('counters').insert({ userId: 'scaffold' });
    });
    this.lifecycle.onDataRemoved(async () => {
      this.hooksRun.push([
        'onDataRemoved',
        this.context.tenant()?.id ?? null,
        await this.data.collection('counters').count(),
      ]);
    });
    this.lifecycle.onUpgraded(async (event) => {
      this.hooksRun.push([
        `onUpgraded from ${event.lastPluginVersion}`,
        this.context.tenant()?.id ?? null,
        await this.data.collection('counters').count(),
      ]);
    });
    this.events.on('core.organization.member-added', async () => {
      const users = await this.users.findByIds(['u1', 'u2']);
      this.memberAddedView.push([
        users.map((user) => user.id),
        await this.data.collection('counters').count(),
      ]);
    });
  }
}

@Controller('counters')
class CounterController {
  @Get()
  list() {
    return [];
  }
}

@PluginModule({
  manifest: {
    sdkApiVersion: SDK_API_VERSION,
    namespace: 'acme.counter',
    version: '1.0.0',
    displayName: 'Counter',
    permissions: ['users:read', 'data:read', 'data:write'],
    endpoints: [{ method: 'GET', path: '/counters' }],
    collections: ['counters'],
    events: {
      emits: ['acme.counter.counted'],
      subscribes: ['core.user.created', 'core.organization.member-added'],
    },
    lifecycle: { onEnabled: true, onDataRemoved: true, onUpgraded: true },
    limits: { maxDocumentBytes: 100, maxDocuments: 3, maxStorageBytes: 150 },
  },
  controllers: [CounterController],
  providers: [CounterService],
})
class CounterPlugin {}

describe('plugin test harness', () => {
  let harness: PluginTestHarness;
  let service: CounterService;

  beforeEach(async () => {
    harness = await createPluginTestHarness(CounterPlugin, {
      actor: { id: 'u1', memberships: [] },
      users: [
        {
          id: 'u1',
          firstName: 'Ada',
          lastName: 'L',
          email: 'ada@example.com',
          memberships: [],
        },
      ],
    });
    service = harness.module.get(CounterService);
  });

  afterEach(() => harness.close());

  it('should store, query and soft delete records in declared collections', async () => {
    const counters = service.data.collection<{ userId: string; n: number }>(
      'counters',
    );
    const a = await counters.insert({ userId: 'u1', n: 2 });
    await counters.insert({ userId: 'u2', n: 1 });

    expect(a).toEqual(
      expect.objectContaining({
        userId: 'u1',
        n: 2,
        createdBy: 'u1',
        id: expect.any(String),
      }),
    );
    expect(
      (await counters.find({ sort: { n: 1 } })).items.map((record) => record.n),
    ).toEqual([1, 2]);
    expect(await counters.count({ n: { $gte: 2 } })).toBe(1);

    expect(await counters.remove(a.id)).toBe(true);
    expect(await counters.findById(a.id)).toBeNull();
    expect(await counters.count()).toBe(1);
  });

  it('should only give the actor their membership in the current organization', () => {
    harness.context.setActor({
      id: 'u1',
      memberships: [
        { organizationId: 'org-a', roles: ['org_admin'] },
        { organizationId: 'org-b', roles: ['member'] },
      ],
    });

    expect(harness.context.actor()?.memberships).toEqual([]);
    harness.context.setTenant({
      id: 'org-b',
      name: 'B',
      slug: 'b',
      description: null,
    });
    expect(harness.context.actor()?.memberships).toEqual([
      { organizationId: 'org-b', roles: ['member'] },
    ]);
  });

  it('should leave fields alone that an update leaves undefined', async () => {
    const counters = service.data.collection<{ userId?: string; n?: number }>(
      'counters',
    );
    const record = await counters.insert({ userId: 'u1', n: 1 });

    expect(
      await counters.update(record.id, { userId: undefined, n: 2 }),
    ).toEqual(expect.objectContaining({ userId: 'u1', n: 2 }));
  });

  it('should enforce declared collections, the filter language and the document size', async () => {
    expect(() => service.data.collection('other')).toThrow(
      PluginUndeclaredCollectionError,
    );
    await expect(
      service.data
        .collection('counters')
        .find({ filter: { $where: '1' } as any }),
    ).rejects.toThrow(PluginValidationError);
    await expect(
      service.data.collection('counters').insert({ blob: 'x'.repeat(200) }),
    ).rejects.toThrow(PluginPayloadTooLargeError);
  });

  it('should enforce the storage limits on live documents across collections', async () => {
    const counters = service.data.collection<{ n?: number; blob?: string }>(
      'counters',
    );
    const big = await counters.insert({ blob: 'x'.repeat(80) });
    await expect(counters.insert({ blob: 'x'.repeat(80) })).rejects.toThrow(
      PluginStorageQuotaExceededError,
    );
    await expect(
      counters.update(big.id, { blob: 'x'.repeat(85) }),
    ).resolves.not.toBeNull();
    await expect(
      counters.update(big.id, { blob: 'x'.repeat(89) }),
    ).resolves.not.toBeNull();
    expect(harness.data.usage).toEqual(
      expect.objectContaining({ documents: 1, bytes: 100 }),
    );

    await counters.remove(big.id);
    await counters.insert({ n: 1 });
    await counters.insert({ n: 2 });
    const third = await counters.insert({ n: 3 });
    await expect(counters.insert({ n: 4 })).rejects.toThrow(
      PluginStorageQuotaExceededError,
    );
    // Removing a document frees its space
    await counters.remove(third.id);
    await expect(counters.insert({ n: 4 })).resolves.toBeDefined();
  });

  it('should enforce permissions', async () => {
    const readOnly = await createPluginTestHarness(CounterPlugin, {
      permissions: ['data:read', 'users:read'],
    });
    await expect(
      readOnly.data.collection('counters').insert({}),
    ).rejects.toThrow(PluginPermissionDeniedError);
    await readOnly.close();
  });

  it('should hide user emails without users:read:email', async () => {
    expect(await service.users.findById('u1')).not.toHaveProperty('email');
  });

  it('should isolate records by the current organization, with or without an acting user', async () => {
    const counters = service.data.collection<{ userId: string }>('counters');
    const orgA = { id: 'org-a', name: 'A', slug: 'a', description: null };

    const outside = await counters.insert({ userId: 'none' });
    harness.context.setTenant(orgA);
    const inside = await counters.insert({ userId: 'a' });

    expect(outside.organizationId).toBeNull();
    expect(inside.organizationId).toBe('org-a');
    expect((await counters.find()).items.map((r) => r.userId)).toEqual(['a']);
    expect(await counters.findById(outside.id)).toBeNull();
    expect(await counters.update(outside.id, { userId: 'x' })).toBeNull();
    expect(await counters.remove(outside.id)).toBe(false);

    harness.context.setTenant(null);
    expect(await counters.count()).toBe(1);

    // Without an acting user (public endpoints, event handlers) too
    harness.context.setActor(null);
    harness.context.setTenant(orgA);
    expect(await counters.findById(outside.id)).toBeNull();
    expect(await counters.count()).toBe(1);
  });

  it('should confine users and organizations to the current organization', async () => {
    const orgA = { id: 'org-a', name: 'A', slug: 'a', description: null };
    const orgB = { id: 'org-b', name: 'B', slug: 'b', description: null };
    const user = (id: string, organizationIds: string[]) => ({
      id,
      firstName: id,
      lastName: 'L',
      memberships: organizationIds.map((organizationId) => ({
        organizationId,
        roles: ['member'],
      })),
    });
    const confined = await createPluginTestHarness(CounterPlugin, {
      actor: { id: 'u1', memberships: [] },
      tenant: orgA,
      users: [user('u1', ['org-a', 'org-b']), user('u2', ['org-b'])],
      organizations: [orgA, orgB],
      permissions: ['users:read', 'users:write', 'organizations:read'],
    });

    // Only Alpha's members, listing only their Alpha membership
    expect(await confined.users.findByIds(['u1', 'u2'])).toEqual([
      expect.objectContaining({
        id: 'u1',
        memberships: [{ organizationId: 'org-a', roles: ['member'] }],
      }),
    ]);
    await expect(
      confined.users.updateProfile('u2', { firstName: 'X' }),
    ).rejects.toThrow();
    expect(
      (await confined.organizations.findByIds(['org-a', 'org-b'])).map(
        (organization) => organization.id,
      ),
    ).toEqual(['org-a']);

    // Without an organization: only the acting user, and no organization
    confined.context.setTenant(null);
    expect(
      (await confined.users.findByIds(['u1', 'u2'])).map((found) => found.id),
    ).toEqual(['u1']);
    expect(await confined.organizations.findById('org-a')).toBeNull();
    await confined.close();
  });

  it("should run handlers in the event's organization", async () => {
    const orgA = { id: 'org-a', name: 'A', slug: 'a', description: null };
    harness.context.setTenant(orgA);
    await service.data.collection('counters').insert({ userId: 'a' });
    harness.context.setTenant(null);
    harness.users.users.get('u1')!.memberships = [
      { organizationId: 'org-a', roles: ['member'] },
    ];

    await harness.events.deliver('core.organization.member-added', {
      organizationId: 'org-a',
      userId: 'u1',
    });
    await harness.events.deliver('core.organization.member-added', {
      organizationId: 'org-b',
      userId: 'u1',
    });

    // Alpha's member and record in Alpha, nothing in Beta
    expect(service.memberAddedView).toEqual([
      [['u1'], 1],
      [[], 0],
    ]);
    expect(harness.context.tenant()).toBeNull();
  });

  it('should run lifecycle hooks in the organization, without an actor', async () => {
    expect(harness.lifecycle.registeredHooks()).toEqual([
      'onEnabled',
      'onDataRemoved',
      'onUpgraded',
    ]);
    expect(() => service.lifecycle.onDisabled(() => undefined)).toThrow(
      PluginUndeclaredLifecycleHookError,
    );

    await harness.lifecycle.enable('org-a', { attempt: 2 });

    expect(service.enabledIn).toEqual([
      [
        expect.objectContaining({
          organizationId: 'org-a',
          firstTime: true,
          pluginVersion: '1.0.0',
          attempt: 2,
        }),
        'org-a',
      ],
    ]);
    const [record] = [...harness.data.store.get('counters')!.values()];
    expect(record).toEqual(
      expect.objectContaining({ organizationId: 'org-a', createdBy: null }),
    );
    // The test's own actor and tenant are back
    expect(harness.context.actor()?.id).toBe('u1');
    expect(harness.context.tenant()).toBeNull();
  });

  it("should remove only that organization's data, after onDataRemoved", async () => {
    const counters = service.data.collection<{ userId: string }>('counters');
    const orgA = { id: 'org-a', name: 'A', slug: 'a', description: null };
    const orgB = { id: 'org-b', name: 'B', slug: 'b', description: null };
    harness.context.setTenant(orgA);
    await counters.insert({ userId: 'a1' });
    const removed = await counters.insert({ userId: 'a2' });
    await counters.remove(removed.id);
    harness.context.setTenant(orgB);
    await counters.insert({ userId: 'b' });
    harness.context.setTenant(null);

    await harness.lifecycle.removeData('org-a');

    // The hook still saw Alpha's (live) record, then Alpha's records were deleted, removed ones too
    expect(service.hooksRun).toEqual([['onDataRemoved', 'org-a', 1]]);
    expect(
      [...harness.data.store.get('counters')!.values()].map((r) => r.userId),
    ).toEqual(['b']);
    expect(harness.data.usage).toEqual(
      expect.objectContaining({ documents: 1 }),
    );
  });

  it('should run onUpgraded in the organization', async () => {
    await harness.lifecycle.upgrade('org-a', { lastPluginVersion: '0.9.0' });

    expect(service.hooksRun).toEqual([['onUpgraded from 0.9.0', 'org-a', 0]]);
  });

  it("should page through the current organization's members", async () => {
    const member = (id: string, organizationId: string) => ({
      id,
      firstName: id,
      lastName: 'L',
      memberships: [{ organizationId, roles: ['member'] }],
    });
    const members = await createPluginTestHarness(CounterPlugin, {
      tenant: { id: 'org-a', name: 'A', slug: 'a', description: null },
      users: [
        member('u3', 'org-a'),
        member('u1', 'org-a'),
        member('u2', 'org-b'),
      ],
    });

    const page = await members.users.findMembers({ limit: 1 });
    expect(page).toEqual(
      expect.objectContaining({ total: 2, limit: 1, skip: 0 }),
    );
    expect(page.items.map((user) => user.id)).toEqual(['u1']);
    expect(
      (await members.users.findMembers({ skip: 1 })).items.map((u) => u.id),
    ).toEqual(['u3']);
    await expect(members.users.findMembers({ limit: 500 })).rejects.toThrow(
      PluginValidationError,
    );
    await members.close();
  });

  it("should refuse events naming another organization than the one they're emitted in", () => {
    harness.context.setTenant({
      id: 'org-a',
      name: 'A',
      slug: 'a',
      description: null,
    });
    expect(() =>
      service.events.emit('acme.counter.counted', { organizationId: 'org-b' }),
    ).toThrow(PluginValidationError);
    expect(() =>
      service.events.emit('acme.counter.counted', { organizationId: 'org-a' }),
    ).not.toThrow();
  });

  it('should only allow declared events and deliver to subscribers without an actor', async () => {
    expect(() => service.events.emit('acme.counter.other', {})).toThrow(
      PluginUndeclaredEventError,
    );
    service.events.emit('acme.counter.counted', { total: 1 });
    expect(harness.events.emitted).toEqual([
      expect.objectContaining({
        name: 'acme.counter.counted',
        payload: { total: 1 },
      }),
    ]);

    await harness.events.deliver('core.user.created', { userId: 'u9' });

    expect(service.seen).toEqual(['u9']);
    const [record] = (await service.data.collection('counters').find()).items;
    expect(record.createdBy).toBeNull();
    expect(harness.context.actor()?.id).toBe('u1');
  });
});
