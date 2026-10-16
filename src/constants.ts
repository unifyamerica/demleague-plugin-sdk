// Bumped only on a breaking change to the plugin contract. A plugin built against another API version is
// refused at startup instead of failing in some subtle way at runtime.
export const SDK_API_VERSION = 1;

// Unique per copy of the SDK (deliberately NOT `Symbol.for`). The host compares it with its own copy, so a
// plugin that bundled a second copy of the SDK (a regular dependency instead of a peer dependency) is
// refused at startup: its abstract service classes would be different DI tokens and nothing would inject.
export const SDK_IDENTITY: unique symbol = Symbol(
  '@unifyamerica/demleague-plugin-sdk',
);

// Metadata keys are plain strings so they can be read even across duplicate SDK copies (to report them)
export const PLUGIN_DEFINITION_METADATA = 'demleague:plugin:definition';
export const PLUGIN_REQUIRED_ABILITY_METADATA =
  'demleague:plugin:required-ability';
export const PLUGIN_EXPORTED_OPERATION_METADATA =
  'demleague:plugin:exported-operation';

// Where the host puts the acting user (a `PluginActor`, never the raw user document) on the request
export const PLUGIN_ACTOR_REQUEST_KEY = 'pluginActor';
