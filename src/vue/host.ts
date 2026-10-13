import type { PluginHost } from './types';

// ℹ️ One per SPA: the host bundles a single copy of this module (plugins keep the SDK external), so plugins
// and the host see the same instance.
let installed: PluginHost | null = null;

/** Called once by the SPA at startup, before any plugin page renders. Plugins never call it. */
export function installPluginHost(host: PluginHost): void {
  if (installed) {
    throw new Error('The DemLeagueOS plugin host is already installed');
  }
  installed = host;
}

export function getPluginHost(): PluginHost {
  if (!installed) {
    throw new Error(
      'The DemLeagueOS plugin host is not installed: plugin UI code only runs inside the SPA (use @unifyamerica/demleague-plugin-sdk/vue/testing in tests)',
    );
  }
  return installed;
}

// For `./vue/testing` only
export function replacePluginHost(host: PluginHost | null): void {
  installed = host;
}
