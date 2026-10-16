import { Injectable } from '@nestjs/common';
import { SDK_API_VERSION } from '../constants';
import { ExportedOperation } from '../decorators/exported-operation.decorator';
import { PluginModule } from '../decorators/plugin-module.decorator';
import {
  PluginActorForbiddenError,
  PluginCallFailedError,
  PluginCallUnavailableError,
  PluginUndeclaredCallError,
  PluginValidationError,
} from '../errors/sdk-errors';
import { DataProxy } from '../services/data.proxy';
import { ModuleCallsProxy } from '../services/module-calls.proxy';
import { PluginContext } from '../services/plugin-context';
import type { PluginCallInfo } from '../types/calls';
import type { PluginActor } from '../types/dto';
import { createPluginTestHarness, PluginTestHarness } from './index';

const ORG = { id: 'org1', name: 'Org', slug: 'org', description: null };
const member: PluginActor = {
  id: 'u1',
  memberships: [{ organizationId: 'org1', roles: ['member'] }],
};
const admin: PluginActor = {
  id: 'u2',
  memberships: [{ organizationId: 'org1', roles: ['org_admin'] }],
};

@Injectable()
class ItemsExports {
  constructor(
    private readonly data: DataProxy,
    private readonly context: PluginContext,
  ) {}

  @ExportedOperation('items.add')
  async add(input: { name: string }, call: PluginCallInfo) {
    if (!input?.name) {
      throw new PluginValidationError('name is required');
    }
    const item = await this.data
      .collection<{ name: string }>('items')
      .insert({ name: input.name });
    return { id: item.id, caller: call.caller, seen: this.context.caller() };
  }

  @ExportedOperation('items.purge')
  purge() {
    throw new Error('boom');
  }

  @ExportedOperation('items.when')
  when() {
    return new Date();
  }
}

@PluginModule({
  manifest: {
    sdkApiVersion: SDK_API_VERSION,
    namespace: 'acme.items',
    version: '1.0.0',
    displayName: 'Items',
    permissions: ['data:read', 'data:write'],
    endpoints: [],
    collections: ['items'],
    abilities: {
      Item: {
        organization: { member: ['create'], org_admin: ['delete'] },
      },
    },
    exports: {
      'items.add': {
        ability: { action: 'create', subject: 'Item' },
        consumers: ['acme.crm'],
      },
      'items.purge': {
        ability: { action: 'delete', subject: 'Item' },
        consumers: '*',
      },
      'items.when': { consumers: '*' },
    },
  },
  providers: [ItemsExports],
})
class ItemsPlugin {}

@Injectable()
class CrmService {
  constructor(readonly calls: ModuleCallsProxy) {}
}

@PluginModule({
  manifest: {
    sdkApiVersion: SDK_API_VERSION,
    namespace: 'acme.crm',
    version: '1.0.0',
    displayName: 'CRM',
    permissions: [],
    endpoints: [],
    calls: { 'acme.items': { operations: ['items.add'] } },
  },
  providers: [CrmService],
})
class CrmPlugin {}

describe('module calls in the test harness', () => {
  describe('invokeExport (provider side)', () => {
    let harness: PluginTestHarness;

    afterEach(() => harness.close());

    it('runs the operation for the caller, with copies and PluginContext.caller()', async () => {
      harness = await createPluginTestHarness(ItemsPlugin, {
        actor: member,
        tenant: ORG,
      });

      const result = await harness.invokeExport<{
        id: string;
        caller: string;
        seen: string;
      }>('items.add', { name: 'A' }, { caller: 'acme.crm' });

      expect(result).toMatchObject({ caller: 'acme.crm', seen: 'acme.crm' });
      expect(harness.data.store.get('items')?.size).toBe(1);
      expect(harness.context.caller()).toBeNull();
    });

    it("refuses a caller it isn't exported to and users without the ability", async () => {
      harness = await createPluginTestHarness(ItemsPlugin, {
        actor: member,
        tenant: ORG,
      });

      await expect(
        harness.invokeExport('items.add', { name: 'A' }, { caller: 'beta.x' }),
      ).rejects.toThrow('not exported to beta.x');
      await expect(
        harness.invokeExport('items.purge', null, { caller: 'beta.x' }),
      ).rejects.toThrow(PluginActorForbiddenError);
    });

    it('lets SDK errors through and wraps others', async () => {
      harness = await createPluginTestHarness(ItemsPlugin, {
        actor: admin,
        tenant: ORG,
      });

      await expect(
        harness.invokeExport('items.add', {}, { caller: 'acme.crm' }),
      ).rejects.toThrow(PluginValidationError);
      await expect(
        harness.invokeExport('items.purge', null, { caller: 'beta.x' }),
      ).rejects.toThrow(PluginCallFailedError);
      await expect(
        harness.invokeExport('items.when', null, { caller: 'beta.x' }),
      ).rejects.toThrow(PluginCallFailedError);
    });

    it('needs an acting user and an organization', async () => {
      harness = await createPluginTestHarness(ItemsPlugin, { tenant: ORG });

      await expect(
        harness.invokeExport('items.when', null, { caller: 'beta.x' }),
      ).rejects.toThrow(PluginActorForbiddenError);
    });
  });

  describe('calls (caller side)', () => {
    let harness: PluginTestHarness;
    let crm: CrmService;

    beforeEach(async () => {
      harness = await createPluginTestHarness(CrmPlugin, {
        actor: member,
        tenant: ORG,
      });
      crm = harness.module.get(CrmService);
    });

    afterEach(() => harness.close());

    it('runs stubs with a copy of the input and records the call', async () => {
      const input = { name: 'A' };
      harness.calls.stub('acme.items', 'items.add', (received, scope) => {
        (received as { name: string }).name = 'changed';
        return { id: 'i1', by: scope.actor.id, in: scope.tenant.id };
      });

      await expect(
        crm.calls.call('acme.items', 'items.add', input),
      ).resolves.toEqual({ id: 'i1', by: 'u1', in: 'org1' });
      expect(input.name).toBe('A');
      expect(harness.calls.calls).toEqual([
        {
          namespace: 'acme.items',
          operation: 'items.add',
          input: { name: 'A' },
        },
      ]);
    });

    it('treats a module without stubs as unavailable', async () => {
      await expect(
        crm.calls.call('acme.items', 'items.add', { name: 'A' }),
      ).rejects.toThrow(PluginCallUnavailableError);
    });

    it('refuses undeclared calls and wraps non-SDK errors', async () => {
      harness.calls.stub('acme.items', 'items.add', () => {
        throw new Error('boom');
      });

      await expect(crm.calls.call('acme.items', 'items.purge')).rejects.toThrow(
        PluginUndeclaredCallError,
      );
      await expect(
        crm.calls.call('acme.items', 'items.add', { name: 'A' }),
      ).rejects.toThrow(PluginCallFailedError);
    });

    it('needs an acting user', async () => {
      harness.calls.stub('acme.items', 'items.add', () => null);
      harness.context.setActor(null);

      await expect(
        crm.calls.call('acme.items', 'items.add', { name: 'A' }),
      ).rejects.toThrow(PluginActorForbiddenError);
    });
  });
});
