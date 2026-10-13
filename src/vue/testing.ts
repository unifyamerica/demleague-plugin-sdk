import { computed, ref } from 'vue';
import type { PluginAbilityAction } from '../types/abilities';
import type { PluginOrganization } from '../types/dto';
import { replacePluginHost } from './host';
import type {
  PluginApi,
  PluginConfirmOptions,
  PluginCurrentRoute,
  PluginCurrentUser,
  PluginHost,
  PluginRouteLocation,
} from './types';

// `@unifyamerica/demleague-plugin-sdk/vue/testing`: a stand-in for the SPA's host in a plugin's UI tests

export interface TestPluginHostOptions {
  // Responses by `METHOD path`, e.g. `{ 'GET /notes': { items: [] } }`; a function gets the body and params
  responses?: Record<string, unknown>;
  user?: PluginCurrentUser | null;
  organization?: PluginOrganization | null;
  // `<action> <Subject>` the user may do, e.g. `['read Note']`; `'*'` for everything. Default: everything.
  abilities?: string[];
  // The answer to every confirmation dialog
  confirm?: boolean;
}

export interface TestPluginHost extends PluginHost {
  requests: {
    method: string;
    path: string;
    body?: unknown;
    params?: unknown;
  }[];
  toasts: { severity: string; detail: unknown }[];
  navigations: PluginRouteLocation[];
  user: ReturnType<typeof ref<PluginCurrentUser | null>>;
  organization: ReturnType<typeof ref<PluginOrganization | null>>;
  currentRoute: ReturnType<typeof ref<PluginCurrentRoute>>;
}

/**
 * Installs a fake host (replacing any other) and returns it. Messages translate to their key, API calls are
 * answered from `responses` (missing ones reject) and recorded, as are toasts and navigations.
 */
export function installTestPluginHost(
  options: TestPluginHostOptions = {},
): TestPluginHost {
  const requests: TestPluginHost['requests'] = [];
  const toasts: TestPluginHost['toasts'] = [];
  const navigations: PluginRouteLocation[] = [];
  const user = ref<PluginCurrentUser | null>(options.user ?? null);
  const organization = ref<PluginOrganization | null>(
    options.organization ?? null,
  );
  const currentRoute = ref<PluginCurrentRoute>({
    name: null,
    params: {},
    query: {},
  });
  const abilities = options.abilities ?? ['*'];

  const respond =
    (method: string) =>
    async (path: string, ...args: unknown[]): Promise<any> => {
      const hasBody = method !== 'GET' && method !== 'DELETE';
      const body = hasBody ? args[0] : undefined;
      const params = (hasBody ? args[1] : args[0]) as
        { params?: unknown } | undefined;
      requests.push({ method, path, body, params: params?.params });
      const key = `${method} ${path}`;
      if (!(key in (options.responses ?? {}))) {
        throw new Error(`No test response for ${key}`);
      }
      const response = options.responses![key];
      return typeof response === 'function'
        ? response(body, params?.params)
        : structuredClone(response);
    };

  const api: PluginApi = {
    get: respond('GET'),
    post: respond('POST'),
    put: respond('PUT'),
    patch: respond('PATCH'),
    delete: respond('DELETE'),
  };

  const host: TestPluginHost = {
    requests,
    toasts,
    navigations,
    user,
    organization,
    currentRoute,
    api: () => api,
    currentUser: computed(() => user.value ?? null),
    currentOrganization: computed(() => organization.value ?? null),
    can: (_namespace: string, action: PluginAbilityAction, subject: string) =>
      abilities.includes('*') || abilities.includes(`${action} ${subject}`),
    t: (_namespace: string, key: string) => key,
    route: () => computed(() => currentRoute.value!),
    location: (_namespace: string, to: PluginRouteLocation) => to,
    push: async (_namespace: string, to: PluginRouteLocation) => {
      navigations.push(to);
    },
    toast: {
      success: (detail) => toasts.push({ severity: 'success', detail }),
      info: (detail) => toasts.push({ severity: 'info', detail }),
      warn: (detail) => toasts.push({ severity: 'warn', detail }),
      error: (detail) =>
        toasts.push({
          severity: 'error',
          detail: detail instanceof Error ? detail.message : detail,
        }),
    },
    confirm: async (_options: PluginConfirmOptions | string) =>
      options.confirm ?? true,
  };

  replacePluginHost(host);
  return host;
}

/** Removes the fake host, e.g. in `afterEach`. */
export function uninstallTestPluginHost(): void {
  replacePluginHost(null);
}
