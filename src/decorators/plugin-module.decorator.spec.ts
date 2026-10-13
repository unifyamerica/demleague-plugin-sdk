import { Controller, Get, Injectable } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SDK_API_VERSION, SDK_IDENTITY } from '../constants';
import { PluginManifestError } from '../errors/sdk-errors';
import { PluginManifest } from '../types/manifest';
import { getPluginDefinition, PluginModule } from './plugin-module.decorator';

const manifest: PluginManifest = {
  sdkApiVersion: SDK_API_VERSION,
  namespace: 'acme.widgets',
  version: '0.1.0',
  displayName: 'Widgets',
  permissions: [],
  endpoints: [{ method: 'GET', path: '/widgets' }],
};

@Controller('widgets')
class WidgetsController {
  @Get()
  list() {
    return [];
  }
}

@Injectable()
class WidgetsService {}

describe('@PluginModule()', () => {
  it('should record a frozen definition and register the Nest module metadata', () => {
    @PluginModule({
      manifest,
      controllers: [WidgetsController],
      providers: [WidgetsService],
    })
    class WidgetsPlugin {}

    const definition = getPluginDefinition(WidgetsPlugin)!;

    expect(definition.manifest).toEqual(manifest);
    expect(definition.manifest).not.toBe(manifest);
    expect(Object.isFrozen(definition.manifest.endpoints[0])).toBe(true);
    expect(definition.moduleName).toBe('WidgetsPlugin');
    expect(definition.sdk).toBe(SDK_IDENTITY);
    expect(Reflect.getMetadata('controllers', WidgetsPlugin)).toEqual([
      WidgetsController,
    ]);
    expect(Reflect.getMetadata('providers', WidgetsPlugin)).toEqual([
      WidgetsService,
    ]);
  });

  it('should throw on an invalid manifest when the class is defined', () => {
    expect(() => {
      @PluginModule({ manifest: { ...manifest, namespace: 'nope' } })
      class BrokenPlugin {}
      return BrokenPlugin;
    }).toThrow(PluginManifestError);
  });

  it('should refuse app-wide enhancers', () => {
    expect(() => {
      @PluginModule({
        manifest,
        providers: [{ provide: APP_GUARD, useClass: WidgetsService }],
      })
      class SneakyPlugin {}
      return SneakyPlugin;
    }).toThrow(/APP_\*/);
  });

  it('should return undefined for a class that is not a plugin', () => {
    expect(getPluginDefinition(WidgetsService)).toBeUndefined();
    expect(getPluginDefinition('nope')).toBeUndefined();
  });
});
