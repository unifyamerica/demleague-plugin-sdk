// A module's lifecycle in an organization: an org admin turns it on or off on the Modules page, and the host
// runs the matching hook in that organization. See `ModuleLifecycleProxy`.

export const ModuleLifecycleHooks = {
  ON_ENABLED: 'onEnabled',
  ON_DISABLED: 'onDisabled',
  // An org admin removed the module's data in the organization (only while it's off). Runs before the host
  // deletes the plugin's records there.
  ON_DATA_REMOVED: 'onDataRemoved',
  // A new version of the plugin is installed: runs in each organization where the module is on
  ON_UPGRADED: 'onUpgraded',
} as const;
export type ModuleLifecycleHook =
  (typeof ModuleLifecycleHooks)[keyof typeof ModuleLifecycleHooks];

// Which hooks the plugin has (`manifest.lifecycle`). The host waits for a declared `onEnabled` before the
// module is on in the organization.
export type PluginLifecycleDeclarations = Partial<
  Record<ModuleLifecycleHook, boolean>
>;

export interface ModuleLifecycleEvent {
  // The organization the module was turned on or off in (also `PluginContext.tenant()` while the hook runs)
  organizationId: string;
  // `onEnabled` only: the module was never on in this organization before
  firstTime: boolean;
  // When the module last finished being turned on / off here (ISO), to catch up on what happened meanwhile.
  // In `onEnabled`, `lastDisabledAt` is when it went off; in `onDisabled`, `lastEnabledAt` is when it went on.
  lastEnabledAt: string | null;
  lastDisabledAt: string | null;
  // The plugin's version now, and the one that last ran in this organization (`null` if unknown). In
  // `onUpgraded`, `lastPluginVersion` is the version being upgraded from; in `onEnabled`, a different one
  // means the plugin was upgraded while the module was off here.
  pluginVersion: string;
  lastPluginVersion: string | null;
  // 1 on the first try, then 2, 3… on retries after a failure
  attempt: number;
}

export type ModuleLifecycleHandler = (
  event: ModuleLifecycleEvent,
) => void | Promise<void>;
