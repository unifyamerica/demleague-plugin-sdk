import { DynamicModule, Type } from '@nestjs/common';
import { Test, TestingModule, TestingModuleBuilder } from '@nestjs/testing';
import { SDK_IDENTITY } from '../constants';
import { getPluginDefinition } from '../decorators/plugin-module.decorator';
import { DataProxy } from '../services/data.proxy';
import { EventBusProxy } from '../services/event-bus.proxy';
import { ModuleLifecycleProxy } from '../services/module-lifecycle.proxy';
import { OrganizationsProxy } from '../services/organizations.proxy';
import { PluginContext } from '../services/plugin-context';
import { PluginLogger } from '../services/plugin-logger';
import { UsersProxy } from '../services/users.proxy';
import { PluginActor, PluginOrganization, PluginUser } from '../types/dto';
import { PluginPermission } from '../types/permissions';
import {
  InMemoryDataProxy,
  InMemoryModuleLifecycleProxy,
  InMemoryOrganizationsProxy,
  InMemoryUsersProxy,
  RecordingEventBusProxy,
  RecordingPluginLogger,
  TestPluginContext,
} from './in-memory-services';

export * from './in-memory-services';
export { matchesFilter } from './match-filter';

export interface PluginTestingOptions {
  // The acting user, `null` (the default) for a public endpoint / event handler. Like the host, `actor()` only
  // returns their membership in `tenant` (none without one).
  actor?: PluginActor | null;
  // The organization the request acts in (its `X-Tenant`), `null` (the default) for none
  tenant?: PluginOrganization | null;
  users?: PluginUser[];
  organizations?: PluginOrganization[];
  // Overrides the manifest's permissions, e.g. to test what happens without one
  permissions?: PluginPermission[];
}

export interface PluginTestHarness {
  module: TestingModule;
  context: TestPluginContext;
  users: InMemoryUsersProxy;
  organizations: InMemoryOrganizationsProxy;
  data: InMemoryDataProxy;
  events: RecordingEventBusProxy;
  lifecycle: InMemoryModuleLifecycleProxy;
  logger: RecordingPluginLogger;
  close(): Promise<void>;
}

function testRuntimeModule(
  pluginModule: Type<unknown>,
  options: PluginTestingOptions,
): DynamicModule {
  const definition = getPluginDefinition(pluginModule);
  if (!definition) {
    throw new Error(
      `${pluginModule.name} is not decorated with @PluginModule()`,
    );
  }
  if (definition.sdk !== SDK_IDENTITY) {
    throw new Error(
      `${pluginModule.name} was built with another copy of @unifyamerica/demleague-plugin-sdk; make it a peerDependency`,
    );
  }

  const context = new TestPluginContext(
    definition.manifest,
    new Set(options.permissions ?? definition.manifest.permissions),
    options.actor ?? null,
  );
  context.setTenant(options.tenant ?? null);
  const data = new InMemoryDataProxy(context);
  const organizations = new Map(
    (options.organizations ?? []).map((organization) => [
      organization.id,
      organization,
    ]),
  );

  class PluginTestRuntimeModule {}

  return {
    module: PluginTestRuntimeModule,
    providers: [
      { provide: PluginContext, useValue: context },
      {
        provide: UsersProxy,
        useValue: new InMemoryUsersProxy(context, options.users),
      },
      {
        provide: OrganizationsProxy,
        useValue: new InMemoryOrganizationsProxy(
          context,
          options.organizations,
        ),
      },
      { provide: DataProxy, useValue: data },
      {
        provide: EventBusProxy,
        useValue: new RecordingEventBusProxy(context, organizations),
      },
      {
        provide: ModuleLifecycleProxy,
        useValue: new InMemoryModuleLifecycleProxy(
          context,
          organizations,
          data,
        ),
      },
      { provide: PluginLogger, useValue: new RecordingPluginLogger() },
    ],
    exports: [
      PluginContext,
      UsersProxy,
      OrganizationsProxy,
      DataProxy,
      EventBusProxy,
      ModuleLifecycleProxy,
      PluginLogger,
    ],
  };
}

/**
 * A testing module for a plugin, wired the way the host wires it but with the in-memory proxies. Use it when
 * you need to override providers; otherwise `createPluginTestHarness()` is simpler.
 */
export function createPluginTestingModule(
  pluginModule: Type<unknown>,
  options: PluginTestingOptions = {},
): TestingModuleBuilder {
  return Test.createTestingModule({
    imports: [
      {
        module: pluginModule,
        imports: [testRuntimeModule(pluginModule, options)],
      },
    ],
  });
}

/** Compiles and initialises the plugin (so `onModuleInit` subscriptions run) with in-memory proxies. */
export async function createPluginTestHarness(
  pluginModule: Type<unknown>,
  options: PluginTestingOptions = {},
): Promise<PluginTestHarness> {
  const module = await createPluginTestingModule(
    pluginModule,
    options,
  ).compile();
  await module.init();

  return {
    module,
    context: module.get(PluginContext) as TestPluginContext,
    users: module.get(UsersProxy) as InMemoryUsersProxy,
    organizations: module.get(OrganizationsProxy) as InMemoryOrganizationsProxy,
    data: module.get(DataProxy) as InMemoryDataProxy,
    events: module.get(EventBusProxy) as RecordingEventBusProxy,
    lifecycle: module.get(ModuleLifecycleProxy) as InMemoryModuleLifecycleProxy,
    logger: module.get(PluginLogger) as RecordingPluginLogger,
    close: () => module.close(),
  };
}
