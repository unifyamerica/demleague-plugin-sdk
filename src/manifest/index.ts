// `@unifyamerica/demleague-plugin-sdk/manifest`: the manifest contract without NestJS, so a plugin's manifest can be
// imported by its SPA UI (`./vue`) as well as by its server code. Everything here is also exported from the
// package root.

export { SDK_API_VERSION } from '../constants';
export * from '../types/abilities';
export * from '../types/calls';
export * from '../types/events';
export * from '../types/lifecycle';
export * from '../types/manifest';
export * from '../types/permissions';
export * from '../types/ui';
export {
  validateManifest,
  validateAbilityGrants,
  normalizeEndpointPath,
  NAMESPACE_PATTERN,
  RESERVED_VENDORS,
} from './validate-manifest';
