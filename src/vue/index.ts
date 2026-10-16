// `@unifyamerica/demleague-plugin-sdk/vue`: the only platform package a plugin's SPA UI may import (besides `vue`,
// `primevue` and `primeicons`). Like the root entry, everything exported here is part of the contract.

export { createPluginUi, validatePluginUi } from './create-plugin-ui';
export type { PluginUi } from './create-plugin-ui';
export { installPluginHost } from './host';
export type * from './types';
export { storeToRefs } from 'pinia';
export { sanitizeHtml, vSafeHtml } from './safe-html';
export * from '../luxon';

// The manifest contract, so UI code needs a single SDK import
export * from '../manifest';
export type { PluginOrganization } from '../types/dto';
