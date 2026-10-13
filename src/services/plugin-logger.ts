/** Logging tagged with the plugin's namespace. Use it instead of `console`. */
export abstract class PluginLogger {
  abstract debug(message: unknown): void;
  abstract info(message: unknown): void;
  abstract warning(message: unknown): void;
  abstract error(message: unknown): void;
}
