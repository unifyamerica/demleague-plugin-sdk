import { defineStore as piniaDefineStore } from 'pinia';
import type { ComputedRef } from 'vue';
import { validateManifest } from '../manifest/validate-manifest';
import type { PluginAbilityAction } from '../types/abilities';
import type { PluginOrganization } from '../types/dto';
import type { PluginManifest } from '../types/manifest';
import { PluginUiSlots, type PluginUiSlot } from '../types/ui';
import { getPluginHost } from './host';
import type {
  PluginApi,
  PluginConfirmOptions,
  PluginCurrentRoute,
  PluginCurrentUser,
  PluginMenuItem,
  PluginMessageParams,
  PluginRouteDefinition,
  PluginRouteLocation,
  PluginToast,
  PluginUiDefinition,
  PluginUiOptions,
} from './types';

const ROUTE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

const collectRoutes = (
  routes: PluginRouteDefinition[],
): PluginRouteDefinition[] =>
  routes.flatMap((route) => [route, ...collectRoutes(route.children ?? [])]);

/** The problems with a plugin's UI options against its manifest, empty when valid. */
export function validatePluginUi(
  manifest: Readonly<PluginManifest>,
  options: PluginUiOptions,
): string[] {
  const problems = validateManifest(manifest as PluginManifest);
  const routes = collectRoutes(options.routes ?? []);
  const names = new Set<string>();
  const subjects = Object.keys(manifest.abilities ?? {});

  for (const route of routes) {
    if (!ROUTE_NAME_PATTERN.test(route.name ?? '')) {
      problems.push(`route "${route.name}" must be named in kebab-case`);
    } else if (names.has(route.name)) {
      problems.push(`route "${route.name}" is declared more than once`);
    }
    names.add(route.name);
    if (route.ability && !subjects.includes(route.ability.subject)) {
      problems.push(
        `route "${route.name}" requires an ability on "${route.ability.subject}", which manifest.abilities doesn't declare`,
      );
    }
  }

  const menus: [PluginUiSlot, PluginMenuItem[] | undefined][] = [
    [PluginUiSlots.MAIN_MENU, options.mainMenu],
    [PluginUiSlots.PROFILE_MENU, options.profileMenu],
  ];
  for (const [slot, items] of menus) {
    if (!items?.length) {
      continue;
    }
    if (!(manifest.ui?.slots ?? []).includes(slot)) {
      problems.push(`menu items for "${slot}" need it in manifest.ui.slots`);
    }
    for (const item of items) {
      const where = `${slot} item "${item.labelKey}"`;
      const children = item.children as unknown[] | undefined;
      if (children === undefined) {
        if (item.to === undefined) {
          problems.push(`${where} needs a route (\`to\`) or \`children\``);
        } else if (!names.has(item.to)) {
          problems.push(`${where} targets unknown route "${item.to}"`);
        }
        continue;
      }
      if (item.to !== undefined) {
        problems.push(
          `${where} is a group (\`children\`), so it can't also link to a route`,
        );
      }
      if (!Array.isArray(children) || children.length === 0) {
        problems.push(`${where} needs at least one child`);
        continue;
      }
      for (const child of item.children ?? []) {
        if ((child as PluginMenuItem).children !== undefined) {
          problems.push(
            `${where}: child "${child.labelKey}" can't have children (one level only)`,
          );
        }
        if (!names.has(child.to)) {
          problems.push(
            `${where}: child "${child.labelKey}" targets unknown route "${child.to}"`,
          );
        }
      }
    }
  }

  return problems;
}

/**
 * Everything a plugin's UI gets from the platform, bound to the plugin's namespace. Create it once (e.g. in
 * `src/ui/plugin.ts`) and use its composables in components and stores:
 *
 * ```ts
 * export const notes = createPluginUi(ACME_NOTES_MANIFEST);
 * export const { useApi, useI18n, useAbility } = notes;
 * ```
 *
 * The composables need the SPA's host, so they only work at runtime (inside `setup()`, a store, an event
 * handler), not when a module is first evaluated.
 */
export function createPluginUi(manifest: Readonly<PluginManifest>) {
  const namespace = manifest.namespace;
  const host = getPluginHost;

  return {
    namespace,
    manifest,

    /** The plugin's UI: its pages and menu entries. Default export the result from the `./ui` entry. */
    define(options: PluginUiOptions): PluginUiDefinition {
      const problems = validatePluginUi(manifest, options);
      if (problems.length > 0) {
        throw new Error(
          `Invalid UI for plugin ${namespace}:\n  - ${problems.join('\n  - ')}`,
        );
      }
      return Object.freeze({ ...options, namespace, manifest });
    },

    /** HTTP client for the plugin's own endpoints (`/plugins/<vendor>/<module>/...`). */
    useApi(): PluginApi {
      return host().api(namespace);
    },

    useCurrentUser(): ComputedRef<PluginCurrentUser | null> {
      return host().currentUser;
    },

    /** The organization the user works in. Pages are re-created when it changes. */
    useCurrentOrganization(): ComputedRef<PluginOrganization | null> {
      return host().currentOrganization;
    },

    /** `can('update', 'Note')` on the plugin's own subjects, in the current organization (UX only). */
    useAbility() {
      return {
        can: (action: PluginAbilityAction, subject: string): boolean =>
          host().can(namespace, action, subject),
      };
    },

    /** `t()` for the plugin's own messages (`i18n` of the UI definition). */
    useI18n() {
      return {
        t: (key: string, params?: PluginMessageParams): string =>
          host().t(namespace, key, params),
      };
    },

    /** The current route and navigation among the plugin's own routes, by their unprefixed names. */
    useRouter() {
      return {
        route: host().route(namespace) as ComputedRef<PluginCurrentRoute>,
        to: (to: PluginRouteLocation): PluginRouteLocation =>
          host().location(namespace, to),
        push: (to: PluginRouteLocation): Promise<void> =>
          host().push(namespace, to),
      };
    },

    useToast(): PluginToast {
      return host().toast;
    },

    useConfirm() {
      return (options: PluginConfirmOptions | string): Promise<boolean> =>
        host().confirm(options);
    },

    /** A Pinia setup store, with its id prefixed by the namespace so it can't clash with another's. */
    defineStore<Id extends string, SS extends object>(id: Id, setup: () => SS) {
      return piniaDefineStore(`${namespace}/${id}` as const, setup);
    },
  };
}

export type PluginUi = ReturnType<typeof createPluginUi>;
