import { Provider, Type } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { getExportedOperations } from '../decorators/exported-operation.decorator';
import {
  PluginActorForbiddenError,
  PluginCallFailedError,
  PluginCallUnavailableError,
  PluginSdkError,
  PluginUndeclaredCallError,
} from '../errors/sdk-errors';
import { ModuleCallsProxy } from '../services/module-calls.proxy';
import { actionGranted, effectiveOrganizationRoles } from '../types/abilities';
import { ANY_CONSUMER, copyCallPayload } from '../types/calls';
import { PluginActor, PluginOrganization } from '../types/dto';
import { JsonValue } from '../types/events';
import { TestPluginContext } from './in-memory-services';

// What a stubbed operation gets besides the input: who the call is made for, and where
export interface StubbedCallScope {
  actor: PluginActor;
  tenant: PluginOrganization;
}

export type StubbedOperation = (
  input: JsonValue,
  scope: StubbedCallScope,
) => unknown;

export interface RecordedCall {
  namespace: string;
  operation: string;
  input: JsonValue;
}

const failed = (provider: string, operation: string, error: unknown) =>
  error instanceof PluginSdkError
    ? error
    : new PluginCallFailedError(
        provider,
        operation,
        error instanceof Error ? error.message : String(error),
      );

// A result that isn't plain JSON is the provider's bug, not the caller's: like the host, a PluginCallFailedError
const copyResult = (
  result: unknown,
  provider: string,
  operation: string,
): JsonValue => {
  try {
    return copyCallPayload(result, `Result of ${provider} → ${operation}`);
  } catch (error) {
    throw new PluginCallFailedError(
      provider,
      operation,
      (error as Error).message,
    );
  }
};

/**
 * Stands in for the host's `ModuleCallsProxy` in a calling plugin's tests. Like the host it refuses calls not in
 * `manifest.calls` and calls without an acting user and organization, copies input and result as plain JSON, and
 * turns errors other than SDK errors (and results that aren't plain JSON) into `PluginCallFailedError`. Other modules are stubs: an operation without
 * one behaves like a module that isn't installed (`PluginCallUnavailableError`). It doesn't check the registry or
 * the provider's own rules (its abilities and limits); test those in the provider.
 */
export class InMemoryModuleCallsProxy extends ModuleCallsProxy {
  readonly calls: RecordedCall[] = [];
  private readonly stubs = new Map<string, StubbedOperation>();

  constructor(private readonly context: TestPluginContext) {
    super();
  }

  /** What `namespace` → `operation` does in this test (its result is copied like the host does). */
  stub(namespace: string, operation: string, handler: StubbedOperation): void {
    this.stubs.set(`${namespace} ${operation}`, handler);
  }

  /** Makes every operation of `namespace` unavailable again, like a module that isn't installed or turned on. */
  unstub(namespace: string): void {
    [...this.stubs.keys()]
      .filter((key) => key.startsWith(`${namespace} `))
      .forEach((key) => this.stubs.delete(key));
  }

  async call<TResult = JsonValue>(
    namespace: string,
    operation: string,
    input?: JsonValue,
  ): Promise<TResult> {
    if (
      !(this.context.manifest.calls?.[namespace]?.operations ?? []).includes(
        operation,
      )
    ) {
      throw new PluginUndeclaredCallError(
        this.context.namespace,
        namespace,
        operation,
      );
    }
    const actor = this.context.actor();
    const tenant = this.context.tenant();
    if (!actor || !tenant) {
      throw new PluginActorForbiddenError(
        'Module calls need an acting user and an organization',
      );
    }
    const copy = copyCallPayload(input, `Input of ${namespace} → ${operation}`);
    this.calls.push({ namespace, operation, input: copy });

    const handler = this.stubs.get(`${namespace} ${operation}`);
    if (!handler) {
      throw new PluginCallUnavailableError(
        namespace,
        'not installed (no stub in the test harness)',
      );
    }
    let result: unknown;
    try {
      result = await handler(structuredClone(copy), { actor, tenant });
    } catch (error) {
      throw failed(namespace, operation, error);
    }
    return copyResult(result, namespace, operation) as TResult;
  }
}

const providerClass = (
  provider: Provider,
): { token: unknown; type: Type<unknown> } | null => {
  if (typeof provider === 'function') {
    return { token: provider, type: provider };
  }
  if ('useClass' in provider && provider.useClass) {
    return { token: provider.provide, type: provider.useClass };
  }
  return null;
};

/**
 * Calls one of the plugin's exported operations the way the host does when `caller` calls it: it must be
 * exported to the caller, the acting user (in the harness's tenant) needs the export's ability according to the
 * manifest's grants, input and result are copied as plain JSON, `PluginContext.caller()` is the caller while it
 * runs, and errors other than SDK errors (and results that aren't plain JSON) become `PluginCallFailedError` (with
 * the original message).
 */
export async function invokeExportedOperation<TResult = JsonValue>(
  module: TestingModule,
  providers: Provider[],
  context: TestPluginContext,
  operation: string,
  input: JsonValue | undefined,
  caller: string,
): Promise<TResult> {
  const { manifest, namespace } = context;
  const declaration = manifest.exports?.[operation];
  if (!declaration) {
    throw new Error(`"${operation}" is not in manifest.exports`);
  }
  if (
    declaration.consumers !== ANY_CONSUMER &&
    !declaration.consumers.includes(caller)
  ) {
    throw new Error(
      `"${operation}" is not exported to ${caller}: the host would refuse to start`,
    );
  }

  const actor = context.actor();
  if (!actor || !context.tenant()) {
    throw new PluginActorForbiddenError(
      'Module calls need an acting user and an organization',
    );
  }
  if (declaration.ability) {
    const { action, subject } = declaration.ability;
    const grants = manifest.abilities?.[subject]?.organization ?? {};
    const roles = effectiveOrganizationRoles(
      actor.memberships.flatMap((membership) => membership.roles),
    );
    if (
      !roles.some((role) =>
        actionGranted(grants[role as keyof typeof grants], action),
      )
    ) {
      throw new PluginActorForbiddenError('Insufficient permissions');
    }
  }

  const implementation = providers.map(providerClass).flatMap((provider) =>
    provider
      ? getExportedOperations(provider.type)
          .filter((method) => method.operation === operation)
          .map((method) => ({ ...method, token: provider.token }))
      : [],
  )[0];
  if (!implementation) {
    throw new Error(
      `No @ExportedOperation('${operation}') method in the plugin's class providers`,
    );
  }
  const instance = module.get(implementation.token as Type<unknown>, {
    strict: false,
  }) as Record<string, (input: unknown, call: { caller: string }) => unknown>;

  const copy = copyCallPayload(input, `Input of ${namespace} → ${operation}`);
  const previousCaller = context.caller();
  context.setCaller(caller);
  let result: unknown;
  try {
    result = await instance[implementation.methodName](copy, { caller });
  } catch (error) {
    throw failed(namespace, operation, error);
  } finally {
    context.setCaller(previousCaller);
  }
  return copyResult(result, namespace, operation) as TResult;
}
