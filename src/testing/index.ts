import { DynamicModule, Type } from '@nestjs/common';
import { Test, TestingModule, TestingModuleBuilder } from '@nestjs/testing';
import { SDK_IDENTITY } from '../constants';
import { getPluginDefinition } from '../decorators/plugin-module.decorator';
import { DataProxy } from '../services/data.proxy';
import { ModuleCallsProxy } from '../services/module-calls.proxy';
import { EventBusProxy } from '../services/event-bus.proxy';
import { ModuleLifecycleProxy } from '../services/module-lifecycle.proxy';
import { PluginContext } from '../services/plugin-context';
import { PluginLogger } from '../services/plugin-logger';
import { UsersProxy } from '../services/users.proxy';
import { PluginActor, PluginOrganization, PluginUser } from '../types/dto';
import { JsonValue } from '../types/events';
import { PluginPermission } from '../types/permissions';
import {
  InMemoryDataProxy,
  InMemoryModuleLifecycleProxy,
  InMemoryUsersProxy,
  RecordingEventBusProxy,
  RecordingPluginLogger,
  TestPluginContext,
} from './in-memory-services';
import {
  InMemoryModuleCallsProxy,
  invokeExportedOperation,
} from './module-calls';

export * from './in-memory-services';
export { InMemoryModuleCallsProxy } from './module-calls';
export type {
  RecordedCall,
  StubbedCallScope,
  StubbedOperation,
} from './module-calls';
export { matchesFilter } from './match-filter';

export interface PluginTestingOptions {
  // The acting user, `null` (the default) for a public endpoint / event handler. Like the host, `actor()` only
  // returns their membership in `tenant` (none without one).
  actor?: PluginActor | null;
  // The organization the request acts in (its `X-Tenant`), `null` (the default) for none
  tenant?: PluginOrganization | null;
  users?: PluginUser[];
  // The organizations `events.deliver()` and `lifecycle` run in, by id (a bare one for an id not listed)
  organizations?: PluginOrganization[];
  // Overrides the manifest's permissions, e.g. to test what happens without one
  permissions?: PluginPermission[];
}

export interface PluginTestHarness {
  module: TestingModule;
  context: TestPluginContext;
  users: InMemoryUsersProxy;
  data: InMemoryDataProxy;
  events: RecordingEventBusProxy;
  lifecycle: InMemoryModuleLifecycleProxy;
  logger: RecordingPluginLogger;
  // Other modules' operations, as stubs (`calls.stub(namespace, operation, handler)`)
  calls: InMemoryModuleCallsProxy;
  /**
   * Calls one of this plugin's exported operations as module `caller` would, with the host's checks (exported to
   * the caller, the acting user's ability, plain JSON both ways). Needs an actor and a tenant.
   */
  invokeExport<TResult = JsonValue>(
    operation: string,
    input: JsonValue | undefined,
    options: { caller: string },
  ): Promise<TResult>;
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
      {
        provide: ModuleCallsProxy,
        useValue: new InMemoryModuleCallsProxy(context),
      },
    ],
    exports: [
      ModuleCallsProxy,
      PluginContext,
      UsersProxy,
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
  const context = module.get(PluginContext) as TestPluginContext;
  const providers = getPluginDefinition(pluginModule)!.providers;

  return {
    module,
    context,
    users: module.get(UsersProxy) as InMemoryUsersProxy,
    data: module.get(DataProxy) as InMemoryDataProxy,
    events: module.get(EventBusProxy) as RecordingEventBusProxy,
    lifecycle: module.get(ModuleLifecycleProxy) as InMemoryModuleLifecycleProxy,
    logger: module.get(PluginLogger) as RecordingPluginLogger,
    calls: module.get(ModuleCallsProxy) as InMemoryModuleCallsProxy,
    invokeExport: <TResult = JsonValue>(
      operation: string,
      input: JsonValue | undefined,
      { caller }: { caller: string },
    ) =>
      invokeExportedOperation<TResult>(
        module,
        providers,
        context,
        operation,
        input,
        caller,
      ),
    close: () => module.close(),
  };
}
