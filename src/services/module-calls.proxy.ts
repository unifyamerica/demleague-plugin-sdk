import type { JsonValue } from '../types/events';

/**
 * Calls other modules' exported operations (declared in `manifest.calls`, approved in the namespace registry).
 * The call runs in the provider, for the current acting user and in the current organization: it needs both, so
 * it can't be made from public endpoints, event handlers or lifecycle hooks. Input and result are plain JSON,
 * copied both ways (at most MAX_CALL_PAYLOAD_BYTES each).
 *
 * Dependencies are soft: handle `PluginCallUnavailableError` (the module isn't installed or isn't turned on in
 * this organization). Other errors: `PluginUndeclaredCallError`, `PluginActorForbiddenError` (the user may not
 * use the operation), `PluginValidationError` and other SDK errors the provider threw, `PluginCallFailedError`
 * (it failed otherwise or timed out), `PluginCallDepthExceededError`, `PluginQuotaExceededError` (the
 * provider's `callsPerMinute`).
 */
export abstract class ModuleCallsProxy {
  abstract call<TResult = JsonValue>(
    namespace: string,
    operation: string,
    input?: JsonValue,
  ): Promise<TResult>;
}
