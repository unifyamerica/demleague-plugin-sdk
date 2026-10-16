// ℹ️ The public surface of the SDK, and so the whole contract with plugin authors. Anything not exported here
// is not part of the contract, so be deliberate about what is added (and see the versioning rules in the README).

export {
  SDK_API_VERSION,
  SDK_IDENTITY,
  PLUGIN_DEFINITION_METADATA,
  PLUGIN_REQUIRED_ABILITY_METADATA,
  PLUGIN_EXPORTED_OPERATION_METADATA,
  PLUGIN_ACTOR_REQUEST_KEY,
} from './constants';

export * from './types/permissions';
export * from './types/manifest';
export * from './types/abilities';
export * from './types/ui';
export * from './types/events';
export * from './types/dto';
export * from './types/lifecycle';
export * from './types/calls';

export {
  PluginModule,
  getPluginDefinition,
} from './decorators/plugin-module.decorator';
export type {
  PluginModuleOptions,
  PluginDefinition,
} from './decorators/plugin-module.decorator';
export { CurrentActor } from './decorators/current-actor.decorator';
export { RequireAbility } from './decorators/require-ability.decorator';
export {
  ExportedOperation,
  getExportedOperations,
} from './decorators/exported-operation.decorator';
export type { ExportedOperationMethod } from './decorators/exported-operation.decorator';
export { CORE_ABILITY_SUBJECTS } from './decorators/require-ability.decorator';
export type {
  RequiredAbility,
  CoreAbilityAction,
  CoreAbilitySubject,
} from './decorators/require-ability.decorator';

export { UsersProxy } from './services/users.proxy';
export type { PluginMembersQuery } from './services/users.proxy';
export { DataProxy } from './services/data.proxy';
export type { PluginCollection } from './services/data.proxy';
export { EventBusProxy } from './services/event-bus.proxy';
export { ModuleLifecycleProxy } from './services/module-lifecycle.proxy';
export { ModuleCallsProxy } from './services/module-calls.proxy';
export { PluginContext } from './services/plugin-context';
export { PluginLogger } from './services/plugin-logger';

export * from './errors/sdk-errors';
export {
  validateManifest,
  validateAbilityGrants,
  normalizeEndpointPath,
  NAMESPACE_PATTERN,
  RESERVED_VENDORS,
} from './manifest/validate-manifest';
export {
  assertSafeFilter,
  assertSafeDocument,
  normalizeQuery,
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  FILTER_COMPARISON_OPERATORS,
  FILTER_LOGICAL_OPERATORS,
} from './query/filter';
export type {
  PluginFilter,
  PluginQuery,
  FieldCondition,
  FilterScalar,
} from './query/filter';
