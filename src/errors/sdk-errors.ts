// Errors the host throws back at plugins. Each carries the HTTP status the host responds with when one
// escapes a plugin endpoint, so plugins can let them propagate.
export abstract class PluginSdkError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class PluginPermissionDeniedError extends PluginSdkError {
  readonly code = 'PLUGIN_PERMISSION_DENIED';
  readonly status = 403;

  constructor(namespace: string, permission: string) {
    super(`Plugin "${namespace}" does not have the "${permission}" permission`);
  }
}

// The acting user isn't allowed to do this (the plugin may be, but not on this user's behalf)
export class PluginActorForbiddenError extends PluginSdkError {
  readonly code = 'PLUGIN_ACTOR_FORBIDDEN';
  readonly status = 403;
}

export class PluginQuotaExceededError extends PluginSdkError {
  readonly code = 'PLUGIN_QUOTA_EXCEEDED';
  readonly status = 429;

  constructor(namespace: string, limit: string, max: number) {
    super(`Plugin "${namespace}" exceeded its ${limit} limit (${max})`);
  }
}

// The plugin's stored data reached its maxDocuments or maxStorageBytes limit. Removing documents frees space.
export class PluginStorageQuotaExceededError extends PluginSdkError {
  readonly code = 'PLUGIN_STORAGE_QUOTA_EXCEEDED';
  readonly status = 507;

  constructor(namespace: string, limit: string, max: number) {
    super(`Plugin "${namespace}" reached its ${limit} limit (${max})`);
  }
}

export class PluginPayloadTooLargeError extends PluginSdkError {
  readonly code = 'PLUGIN_PAYLOAD_TOO_LARGE';
  readonly status = 413;
}

export class PluginUndeclaredEventError extends PluginSdkError {
  readonly code = 'PLUGIN_UNDECLARED_EVENT';
  readonly status = 500;

  constructor(namespace: string, kind: 'emit' | 'subscribe', event: string) {
    super(
      `Plugin "${namespace}" did not declare that it ${kind === 'emit' ? 'emits' : 'subscribes to'} "${event}"`,
    );
  }
}

export class PluginUndeclaredLifecycleHookError extends PluginSdkError {
  readonly code = 'PLUGIN_UNDECLARED_LIFECYCLE_HOOK';
  readonly status = 500;

  constructor(namespace: string, hook: string) {
    super(
      `Plugin "${namespace}" did not declare the lifecycle hook "${hook}" (manifest.lifecycle.${hook})`,
    );
  }
}

export class PluginUndeclaredCollectionError extends PluginSdkError {
  readonly code = 'PLUGIN_UNDECLARED_COLLECTION';
  readonly status = 500;

  constructor(namespace: string, collection: string) {
    super(
      `Plugin "${namespace}" did not declare the collection "${collection}"`,
    );
  }
}

export class PluginValidationError extends PluginSdkError {
  readonly code = 'PLUGIN_VALIDATION_ERROR';
  readonly status = 400;
}

export class PluginManifestError extends PluginSdkError {
  readonly code = 'PLUGIN_MANIFEST_INVALID';
  readonly status = 500;

  constructor(
    readonly pluginName: string,
    readonly problems: string[],
  ) {
    super(
      `Invalid plugin manifest for ${pluginName}:\n  - ${problems.join('\n  - ')}`,
    );
  }
}
