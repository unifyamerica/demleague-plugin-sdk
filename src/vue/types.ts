import type { Component, ComputedRef } from 'vue';
import type { PluginAbilityAction } from '../types/abilities';
import type { PluginOrganization } from '../types/dto';
import type { PluginManifest } from '../types/manifest';

// 👉 What a plugin declares

// A page component, preferably lazy (`() => import('./pages/NotesPage.vue')`) so it's only downloaded when opened
export type PluginPageComponent =
  Component | (() => Promise<Component | { default: Component }>);

// An ability on one of the plugin's own subjects (declared in `manifest.abilities`), checked in the current
// organization
export interface PluginPageAbility {
  action: PluginAbilityAction;
  subject: string;
}

export interface PluginRouteDefinition {
  // Relative to the plugin's base path `/apps/<vendor>/<module>`: `''` for its home page, `':id'`, `'settings'`
  path: string;
  // Unique within the plugin, e.g. `list`. The host prefixes it with the namespace.
  name: string;
  component: PluginPageComponent;
  // Who may open the page (and see menu entries to it). Omitted: any logged in user. Children inherit it.
  ability?: PluginPageAbility;
  // Key of the plugin's own messages for the document title
  titleKey?: string;
  children?: PluginRouteDefinition[];
}

/**
 * A menu entry: a link to one of the plugin's pages (`to`), or a group of links (`children`), e.g.
 * `{ labelKey: 'nav.notes', icon: 'pi pi-book', children: [{ labelKey: 'nav.all', to: 'list' }, …] }`.
 * One or the other, not both.
 */
export interface PluginMenuItem {
  // Key of the plugin's own messages
  labelKey: string;
  // PrimeIcons class, e.g. `pi pi-book`
  icon: string;
  // Name of one of the plugin's routes. The entry is only shown to users who may open it.
  to?: string;
  // A group's links (one level, at least one). The group is only shown while one of them is.
  children?: PluginSubMenuItem[];
}

// A link in a menu group
export interface PluginSubMenuItem {
  labelKey: string;
  // Optional for links in a group
  icon?: string;
  // Name of one of the plugin's routes. The link is only shown to users who may open it.
  to: string;
}

// Locale → the plugin's messages, e.g. `{ en: { nav: { notes: 'Notes' } } }`
export type PluginMessages = Record<string, Record<string, unknown>>;

export interface PluginUiOptions {
  routes: PluginRouteDefinition[];
  // Needs the `main-menu` slot in `manifest.ui.slots` (approved in the namespace registry)
  mainMenu?: PluginMenuItem[];
  // Needs the `profile-menu` slot
  profileMenu?: PluginMenuItem[];
  i18n?: PluginMessages;
}

// What a plugin's `./ui` entry default exports, built with `createPluginUi(manifest).define(...)`
export interface PluginUiDefinition extends PluginUiOptions {
  readonly namespace: string;
  readonly manifest: Readonly<PluginManifest>;
}

// 👉 What the host gives plugins (through `createPluginUi()`, never directly)

export interface PluginCurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  timezone: string | null;
  // Active memberships only
  memberships: { organizationId: string; roles: string[] }[];
}

export interface PluginRequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
}

// HTTP client for the plugin's own endpoints. Paths are relative to `/plugins/<vendor>/<module>`. Requests carry
// the user's session and the current organization (`X-Tenant`); errors reject with an `Error` whose message
// is user-presentable (or an i18n key the host's toasts translate).
export interface PluginApi {
  get<T = unknown>(path: string, options?: PluginRequestOptions): Promise<T>;
  post<T = unknown>(
    path: string,
    body?: unknown,
    options?: PluginRequestOptions,
  ): Promise<T>;
  put<T = unknown>(
    path: string,
    body?: unknown,
    options?: PluginRequestOptions,
  ): Promise<T>;
  patch<T = unknown>(
    path: string,
    body?: unknown,
    options?: PluginRequestOptions,
  ): Promise<T>;
  delete<T = unknown>(path: string, options?: PluginRequestOptions): Promise<T>;
}

// A location among the plugin's own routes, by their unprefixed name
export interface PluginRouteLocation {
  name: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
}

export interface PluginCurrentRoute {
  // The plugin's own (unprefixed) route name, null on another plugin's or a core page
  name: string | null;
  params: Readonly<Record<string, string>>;
  query: Readonly<Record<string, string>>;
}

export interface PluginConfirmOptions {
  message: string;
  title?: string;
  confirmText?: string;
  cancelText?: string;
  severity?: 'primary' | 'secondary' | 'success' | 'info' | 'warn' | 'danger';
}

export interface PluginToast {
  success(detail?: string): void;
  info(detail: string): void;
  warn(detail: string): void;
  // A message, or a caught error (e.g. from `useApi()`)
  error(detailOrError?: unknown): void;
}

// Translation parameters, e.g. `t('greeting', { name })`
export type PluginMessageParams = Record<string, unknown>;

/**
 * Implemented by the DemLeagueOS SPA, which installs it once at startup (`installPluginHost`). Every method
 * takes the calling plugin's namespace, so each plugin only reaches its own endpoints, routes, subjects and
 * messages. Reactive values are read-only.
 */
export interface PluginHost {
  api(namespace: string): PluginApi;
  currentUser: ComputedRef<PluginCurrentUser | null>;
  // The organization the user is working in (the header switcher, mirrored in the `?org=` query)
  currentOrganization: ComputedRef<PluginOrganization | null>;
  // `can('read', 'Note')` on one of the plugin's subjects, in the current organization. Reactive.
  can(namespace: string, action: PluginAbilityAction, subject: string): boolean;
  t(namespace: string, key: string, params?: PluginMessageParams): string;
  route(namespace: string): ComputedRef<PluginCurrentRoute>;
  // A `RouterLink` `to` for one of the plugin's routes (keeps the current organization)
  location(namespace: string, to: PluginRouteLocation): PluginRouteLocation;
  push(namespace: string, to: PluginRouteLocation): Promise<void>;
  toast: PluginToast;
  confirm(options: PluginConfirmOptions | string): Promise<boolean>;
}
