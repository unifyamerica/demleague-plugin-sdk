// Where in the SPA's own chrome a plugin's UI may appear. Pages (routes under `/apps/<vendor>/<module>`) need
// no slot; adding entries to the app's menus does, and each slot is approved in the namespace registry.
export const PluginUiSlots = {
  MAIN_MENU: 'main-menu',
  PROFILE_MENU: 'profile-menu',
} as const;
export type PluginUiSlot = (typeof PluginUiSlots)[keyof typeof PluginUiSlots];

export const isPluginUiSlot = (value: unknown): value is PluginUiSlot =>
  typeof value === 'string' &&
  (Object.values(PluginUiSlots) as string[]).includes(value);

export interface PluginUiDeclaration {
  slots?: PluginUiSlot[];
}
