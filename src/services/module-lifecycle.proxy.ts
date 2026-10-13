import { ModuleLifecycleHandler } from '../types/lifecycle';

/**
 * Hooks for when an org admin turns the module on or off in their organization. Register them in
 * `onModuleInit()`, like event subscriptions; each needs `manifest.lifecycle.<hook>: true`.
 *
 * - `onEnabled`: scaffolding, and catching up on what happened while the module was off (events aren't
 *   delivered then). The module only becomes on (requests, events, UI) once it succeeds.
 * - `onDisabled`: light cleanup, like cancelling scheduled work. The module is already off for requests and
 *   events. Don't delete the organization's data: turning the module back on should find it.
 * - `onDataRemoved`: an org admin chose "Remove module data" while the module was off. Clean up anything the
 *   host can't (e.g. derived state); the host then deletes all your records in the organization, whatever
 *   this hook does, and the next `onEnabled` there is a `firstTime` one.
 * - `onUpgraded`: a new version is installed (the host noticed at startup). Runs in each organization where
 *   the module is on, which stays on meanwhile: migrate that organization's records so both the old and new
 *   shapes keep working until it's done. Organizations where it's off are told in their next `onEnabled`
 *   (`lastPluginVersion`).
 *
 * A hook runs once per change, in the organization (`PluginContext.tenant()`, everything confined to it) and
 * without an acting user, within `limits.lifecycleHookTimeoutMs`. A failing (or timed out) hook is retried
 * with a growing delay, or right away from the Modules page, until it succeeds: **make hooks idempotent**, as
 * they can run more than once. If the module is turned back before a hook ran, nothing runs.
 */
export abstract class ModuleLifecycleProxy {
  abstract onEnabled(handler: ModuleLifecycleHandler): void;
  abstract onDisabled(handler: ModuleLifecycleHandler): void;
  abstract onDataRemoved(handler: ModuleLifecycleHandler): void;
  abstract onUpgraded(handler: ModuleLifecycleHandler): void;
}
