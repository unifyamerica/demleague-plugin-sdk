import { Module, Provider, Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { PLUGIN_DEFINITION_METADATA, SDK_IDENTITY } from '../constants';
import { PluginManifestError } from '../errors/sdk-errors';
import { validateManifest } from '../manifest/validate-manifest';
import { PluginManifest } from '../types/manifest';

export interface PluginModuleOptions {
  manifest: PluginManifest;
  controllers?: Type<unknown>[];
  providers?: Provider[];
  // ℹ️ There is deliberately no `imports`: a plugin gets platform capabilities through the SDK's service
  // proxies only, so it can't pull in another Nest module (and whatever global providers it registers).
}

export interface PluginDefinition {
  readonly manifest: Readonly<PluginManifest>;
  readonly controllers: Type<unknown>[];
  readonly providers: Provider[];
  readonly moduleName: string;
  // Which copy of the SDK decorated the module, see `SDK_IDENTITY`
  readonly sdk: symbol;
}

// App-wide enhancers would apply to every route of the API, not just the plugin's
const FORBIDDEN_PROVIDER_TOKENS: unknown[] = [
  APP_GUARD,
  APP_INTERCEPTOR,
  APP_FILTER,
  APP_PIPE,
];

const providerToken = (provider: Provider): unknown =>
  typeof provider === 'function' ? provider : provider.provide;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Declares a DemLeagueOS plugin. Use it instead of `@Module()`: it validates the manifest when the class is
 * defined and records it for the host, which mounts the plugin under `/plugins/<vendor>/<module>` and gives
 * it the service proxies its permissions allow.
 */
export function PluginModule(options: PluginModuleOptions): ClassDecorator {
  return (target) => {
    const problems = validateManifest(options.manifest);
    const providers = options.providers ?? [];

    for (const provider of providers) {
      if (FORBIDDEN_PROVIDER_TOKENS.includes(providerToken(provider))) {
        problems.push(
          'providers may not register app-wide guards, interceptors, filters or pipes (APP_*)',
        );
      }
    }

    if (problems.length > 0) {
      throw new PluginManifestError(target.name, problems);
    }

    const definition: PluginDefinition = Object.freeze({
      manifest: deepFreeze(structuredClone(options.manifest)),
      controllers: [...(options.controllers ?? [])],
      providers: [...providers],
      moduleName: target.name,
      sdk: SDK_IDENTITY,
    });

    Reflect.defineMetadata(PLUGIN_DEFINITION_METADATA, definition, target);
    Module({
      controllers: definition.controllers,
      providers: definition.providers,
    })(target);
  };
}

/** The definition `@PluginModule()` recorded on a class, `undefined` when it isn't a plugin module. */
export function getPluginDefinition(
  target: unknown,
): PluginDefinition | undefined {
  if (typeof target !== 'function') {
    return undefined;
  }
  return Reflect.getMetadata(PLUGIN_DEFINITION_METADATA, target) as
    PluginDefinition | undefined;
}
