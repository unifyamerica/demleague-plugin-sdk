import { PluginValidationError } from '../errors/sdk-errors';

// The core event catalog. Payloads only carry ids: a plugin that wants the record has to fetch it through a
// proxy, so events can never leak data past the plugin's permissions.
export const CoreEvents = {
  USER_CREATED: 'core.user.created',
  USER_UPDATED: 'core.user.updated',
  ORGANIZATION_CREATED: 'core.organization.created',
  ORGANIZATION_UPDATED: 'core.organization.updated',
  // A user became an active member of an organization (added, or a removed membership restored)
  ORGANIZATION_MEMBER_ADDED: 'core.organization.member-added',
} as const;
export type CoreEvent = (typeof CoreEvents)[keyof typeof CoreEvents];

export interface CoreEventPayloads {
  'core.user.created': { userId: string };
  'core.user.updated': { userId: string; changedFields: string[] };
  'core.organization.created': { organizationId: string };
  'core.organization.updated': {
    organizationId: string;
    changedFields: string[];
  };
  'core.organization.member-added': { organizationId: string; userId: string };
}

export const isCoreEvent = (name: string): name is CoreEvent =>
  (Object.values(CoreEvents) as string[]).includes(name);

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type EventPayload<TName extends string> = TName extends CoreEvent
  ? CoreEventPayloads[TName]
  : Record<string, JsonValue>;

export interface PluginEvent<TName extends string = string> {
  id: string;
  name: TName;
  // `core` or the emitting plugin's namespace
  source: string;
  emittedAt: string;
  // The organization the event happened in: a core event's `payload.organizationId`, or the tenant of the
  // request a plugin emitted it from. `null` for events about no organization (e.g. `core.user.created`).
  // The host only delivers an organization's events to the modules turned on in it, and runs the handlers in
  // it: `PluginContext.tenant()` is that organization, so data, users and organizations are confined to it.
  organizationId: string | null;
  payload: Readonly<EventPayload<TName>>;
}

// The organization a core event's payload names, if any
export const coreEventOrganizationId = (
  payload: Readonly<Record<string, unknown>>,
): string | null =>
  typeof payload.organizationId === 'string' ? payload.organizationId : null;

// The user a core event's payload is about, if any
export const coreEventUserId = (
  payload: Readonly<Record<string, unknown>>,
): string | null =>
  typeof payload.userId === 'string' ? payload.userId : null;

/**
 * A plugin's event happens in the organization it's emitted from: a payload naming another one (an
 * `organizationId` field other than the current organization's) is a PluginValidationError, so subscribers
 * can't be pointed at another organization.
 */
export const assertEmittedInTenant = (
  payload: Readonly<Record<string, unknown>>,
  tenantId: string | null,
): void => {
  if (
    Object.hasOwn(payload, 'organizationId') &&
    payload.organizationId !== tenantId
  ) {
    throw new PluginValidationError(
      `An event's organizationId must be the organization it's emitted in (${tenantId ?? 'none'})`,
    );
  }
};

export type PluginEventHandler<TName extends string = string> = (
  event: PluginEvent<TName>,
) => void | Promise<void>;
