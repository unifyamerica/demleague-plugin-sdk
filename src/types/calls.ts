import {
  PluginPayloadTooLargeError,
  PluginValidationError,
} from '../errors/sdk-errors';
import type { PluginAbilityAction } from './abilities';
import type { JsonValue } from './events';

// How modules call each other. A module exports named operations (`manifest.exports`, implemented by
// `@ExportedOperation()` methods), another module declares the ones it calls (`manifest.calls`), and the core
// team approves each connection in the caller's namespace registry entry (`approvedCalls`). Calls go through
// the host (`ModuleCallsProxy`): never another module's classes, instances or collections.
//
// A call runs as the provider (its own permissions, data and quotas), for the same acting user and in the same
// organization as the caller's request, so it never lets a user do more than the provider's own endpoints would.
// Only plain JSON crosses, copied both ways.

// Operation names: lowercase kebab-case segments separated by dots, e.g. `notes.list`
export const OPERATION_NAME_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

// `consumers: '*'`: any module the core team approves a connection for (the registry never takes a wildcard)
export const ANY_CONSUMER = '*';

// The most JSON a call's input or result may hold
export const MAX_CALL_PAYLOAD_BYTES = 256 * 1024;

// How many calls deep a chain of modules may go (A → B → C); a module calling back into one already in the chain
// (A → B → A) is refused at any depth
export const MAX_CALL_DEPTH = 3;

// An ability on one of the provider's own subjects (declared in `manifest.abilities`), checked against the acting
// user in the current organization, like `@RequireAbility()`
export interface PluginOperationAbility {
  action: PluginAbilityAction;
  subject: string;
}

export interface PluginExportDeclaration {
  summary?: string;
  // Who may have it called on their behalf. Omitted: any member of the organization.
  ability?: PluginOperationAbility;
  // The namespaces that may call it, or `'*'` for any module the core team approves
  consumers: string[] | typeof ANY_CONSUMER;
}

// Operation name → declaration, e.g. `{ 'notes.list': { ability: { action: 'read', subject: 'Note' }, consumers: '*' } }`
export type PluginExports = Record<string, PluginExportDeclaration>;

export interface PluginCallDeclaration {
  operations: string[];
}

// Provider namespace → the operations called, e.g. `{ 'acme.notes': { operations: ['notes.list'] } }`
export type PluginCalls = Record<string, PluginCallDeclaration>;

// The second argument of an `@ExportedOperation()` method
export interface PluginCallInfo {
  // The calling module's namespace (also `PluginContext.caller()`)
  caller: string;
}

// An `@ExportedOperation()` method: the input is a copy of what the caller passed (`null` for none)
export type PluginOperationHandler<TInput = JsonValue, TResult = JsonValue> = (
  input: TInput,
  call: PluginCallInfo,
) => TResult | Promise<TResult>;

/** Whether `value` is plain JSON: null, strings, booleans, finite numbers, arrays and plain objects. */
export const isPlainJson = (value: unknown, depth = 0): boolean => {
  if (depth > 20) return false;
  if (value === null || ['string', 'boolean'].includes(typeof value)) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every((item) => isPlainJson(item, depth + 1));
  }
  if (
    typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    return Object.values(value).every((item) => isPlainJson(item, depth + 1));
  }
  return false;
};

/**
 * A copy of a call's input or result (`what` names it in errors), so no object, function or proxy crosses
 * between modules: `undefined` becomes `null`, anything but plain JSON is a PluginValidationError, more than
 * MAX_CALL_PAYLOAD_BYTES a PluginPayloadTooLargeError.
 */
export function copyCallPayload(value: unknown, what: string): JsonValue {
  if (value === undefined) {
    return null;
  }
  if (!isPlainJson(value)) {
    throw new PluginValidationError(
      `${what} must be plain JSON (no dates, class instances, functions or undefined values)`,
    );
  }
  const json = JSON.stringify(value);
  // ℹ️ Not `Buffer`: this file is part of `./manifest`, which plugin UIs import in the browser
  const size = new TextEncoder().encode(json).length;
  if (size > MAX_CALL_PAYLOAD_BYTES) {
    throw new PluginPayloadTooLargeError(
      `${what} is ${size} bytes, the limit is ${MAX_CALL_PAYLOAD_BYTES}`,
    );
  }
  return JSON.parse(json) as JsonValue;
}
