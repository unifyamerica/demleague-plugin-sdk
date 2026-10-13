import type { PluginAbilities } from './abilities';
import type { PluginLifecycleDeclarations } from './lifecycle';
import type { PluginPermission } from './permissions';
import type { PluginUiDeclaration } from './ui';

export const HttpMethods = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
} as const;
export type HttpMethod = (typeof HttpMethods)[keyof typeof HttpMethods];

export const EndpointAuth = {
  USER: 'user',
  PUBLIC: 'public',
} as const;
export type EndpointAuth = (typeof EndpointAuth)[keyof typeof EndpointAuth];

export interface PluginEndpointDeclaration {
  method: HttpMethod;
  // Relative to the plugin's base path (`/plugins/<vendor>/<module>`), e.g. `/notes/:id`
  path: string;
  summary?: string;
  // Defaults to `user` (a valid access token is required). `public` endpoints are reviewed extra carefully.
  auth?: EndpointAuth;
}

export interface PluginEventDeclarations {
  // Events this plugin emits. Must be prefixed with the plugin's namespace, e.g. `acme.notes.note-created`.
  emits?: string[];
  // Core events (`core.*`) or other plugins' events this plugin listens to
  subscribes?: string[];
}

// How each limit is enforced is part of the contract, see the SDK README:
// - requestsPerMinute, dbOperationsPerMinute: hard limits for the whole plugin (rejected with 429)
// - requestsPerMinutePerUser: hard limit per authenticated user, so one user can't use up the plugin's quota
//   (429). Public endpoints only count towards requestsPerMinute.
// - maxDocumentBytes: hard limit per document (rejected with 413)
// - maxDocuments, maxStorageBytes: hard limits on the plugin's live (not removed) documents across all its
//   collections (rejected with 507). Sizes are measured like maxDocumentBytes: the JSON of your fields.
// - requestTimeoutMs: the response fails with 503 (the handler itself can't be cancelled in-process)
// - eventHandlerTimeoutMs: reported and counted as a handler error
// - lifecycleHookTimeoutMs: the hook counts as failed (and is retried); it can't be cancelled in-process
// - maxMemoryMb: advisory only, plugins run in the API's process
export interface PluginResourceLimits {
  requestsPerMinute?: number;
  requestsPerMinutePerUser?: number;
  dbOperationsPerMinute?: number;
  requestTimeoutMs?: number;
  eventHandlerTimeoutMs?: number;
  lifecycleHookTimeoutMs?: number;
  maxDocumentBytes?: number;
  maxDocuments?: number;
  maxStorageBytes?: number;
  maxMemoryMb?: number;
}

// What a plugin gets when it doesn't declare a limit. Also the most it gets without a registry ceiling: going
// above these needs the core team's approval in the namespace registry.
export const DEFAULT_RESOURCE_LIMITS: Required<PluginResourceLimits> = {
  requestsPerMinute: 600,
  requestsPerMinutePerUser: 120,
  dbOperationsPerMinute: 1200,
  requestTimeoutMs: 10_000,
  eventHandlerTimeoutMs: 5_000,
  lifecycleHookTimeoutMs: 60_000,
  maxDocumentBytes: 64 * 1024,
  maxDocuments: 10_000,
  maxStorageBytes: 50 * 1024 * 1024,
  maxMemoryMb: 128,
};

// The plugin's own declaration of what it is and what it needs. Authored by the plugin, validated against
// the core team's namespace registry by the host at startup.
export interface PluginManifest {
  sdkApiVersion: number;
  // `<vendor>.<module>`, lowercase kebab-case segments, e.g. `acme.notes`
  namespace: string;
  version: string;
  displayName: string;
  description?: string;
  permissions: PluginPermission[];
  endpoints: PluginEndpointDeclaration[];
  // Namespaced collections the plugin stores data in (stored as `plugin_<vendor>_<module>_<name>`)
  collections?: string[];
  events?: PluginEventDeclarations;
  // The module lifecycle hooks the plugin registers (`ModuleLifecycleProxy`), e.g. `{ onEnabled: true }`
  lifecycle?: PluginLifecycleDeclarations;
  limits?: PluginResourceLimits;
  // The plugin's CASL subjects and which roles get which actions on them, e.g.
  // `{ Note: { organization: { member: ['read'] } } }`. Checked by `@RequireAbility` and by the SPA.
  abilities?: PluginAbilities;
  // Where the plugin's UI appears in the SPA's menus (its pages need no declaration)
  ui?: PluginUiDeclaration;
}
