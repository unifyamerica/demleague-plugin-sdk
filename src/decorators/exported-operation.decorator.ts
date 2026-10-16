import { PLUGIN_EXPORTED_OPERATION_METADATA } from '../constants';
import { OPERATION_NAME_PATTERN } from '../types/calls';

export interface ExportedOperationMethod {
  operation: string;
  methodName: string;
}

/**
 * Implements one of the operations the plugin exports to other modules (`manifest.exports`). Put it on a method
 * of a class provider listed in `@PluginModule({ providers })`; the method gets a copy of the caller's input and
 * a `PluginCallInfo`, and returns plain JSON (or a promise of it):
 *
 *   @ExportedOperation('notes.list')
 *   list(input: ListInput, call: PluginCallInfo): Promise<NoteSummary[]> { … }
 *
 * The host refuses to start a plugin whose exported operations and `@ExportedOperation()` methods don't match
 * exactly (each operation implemented once).
 */
export function ExportedOperation(operation: string): MethodDecorator {
  if (!OPERATION_NAME_PATTERN.test(operation)) {
    throw new Error(
      `@ExportedOperation("${operation}"): operation names are lowercase kebab-case segments separated by dots, e.g. "notes.list"`,
    );
  }
  return (_target, _propertyKey, descriptor) => {
    Reflect.defineMetadata(
      PLUGIN_EXPORTED_OPERATION_METADATA,
      operation,
      descriptor.value as object,
    );
    return descriptor;
  };
}

/** The `@ExportedOperation()` methods of a class (including inherited ones), in declaration order. */
export function getExportedOperations(
  target: abstract new (...args: never[]) => unknown,
): ExportedOperationMethod[] {
  const found: ExportedOperationMethod[] = [];
  const seen = new Set<string>();
  for (
    let prototype = target.prototype as object | null;
    prototype && prototype !== Object.prototype;
    prototype = Object.getPrototypeOf(prototype) as object | null
  ) {
    for (const methodName of Object.getOwnPropertyNames(prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
      if (
        seen.has(methodName) ||
        methodName === 'constructor' ||
        typeof descriptor?.value !== 'function'
      ) {
        continue;
      }
      seen.add(methodName);
      const operation = Reflect.getMetadata(
        PLUGIN_EXPORTED_OPERATION_METADATA,
        descriptor.value as object,
      ) as string | undefined;
      if (operation) {
        found.push({ operation, methodName });
      }
    }
  }
  return found;
}
