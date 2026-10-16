import { Injectable } from '@nestjs/common';
import { SDK_API_VERSION } from '../constants';
import { JobHandler } from '../decorators/job-handler.decorator';
import { PluginModule } from '../decorators/plugin-module.decorator';
import {
  PluginQuotaExceededError,
  PluginUndeclaredJobError,
} from '../errors/sdk-errors';
import { DataProxy } from '../services/data.proxy';
import { JobsProxy } from '../services/jobs.proxy';
import { PluginContext } from '../services/plugin-context';
import type { PluginOrganization } from '../types/dto';
import type { PluginJob } from '../types/jobs';
import { createPluginTestHarness, type PluginTestHarness } from './index';

const orgA: PluginOrganization = {
  id: 'org-a',
  name: 'A',
  slug: 'a',
  description: null,
};
const orgB: PluginOrganization = {
  id: 'org-b',
  name: 'B',
  slug: 'b',
  description: null,
};
const now = new Date('2027-08-01T12:00:00.000Z');
const later = (ms: number) => new Date(now.getTime() + ms);

@Injectable()
class ReminderJobs {
  // What each run saw: [job, tenant, actor, attempt]
  runs: [string, string | null, string | null, number][] = [];
  failuresLeft = 0;

  constructor(
    private readonly context: PluginContext,
    private readonly data: DataProxy,
    private readonly jobs: JobsProxy,
  ) {}

  @JobHandler('remind')
  async remind(job: PluginJob<{ text: string }>): Promise<void> {
    this.runs.push([
      job.name,
      this.context.tenant()?.id ?? null,
      this.context.actor()?.id ?? null,
      job.attempt,
    ]);
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error('flaky');
    }
    await this.data.collection('reminders').insert({ text: job.payload.text });
    // A job can schedule the next one, in the same organization
    if (job.payload.text === 'chain') {
      await this.jobs.schedule('remind', { payload: { text: 'next' } });
    }
  }

  @JobHandler('sweep')
  sweep(job: PluginJob): void {
    this.runs.push([
      `sweep:${job.schedule}`,
      this.context.tenant()?.id ?? null,
      null,
      job.attempt,
    ]);
  }
}

@PluginModule({
  manifest: {
    sdkApiVersion: SDK_API_VERSION,
    namespace: 'acme.reminders',
    version: '1.0.0',
    displayName: 'Reminders',
    permissions: ['data:read', 'data:write'],
    endpoints: [],
    collections: ['reminders'],
    jobs: { remind: { maxAttempts: 2 }, sweep: {} },
    schedules: {
      nightly: { cron: '0 3 * * *', job: 'sweep', scope: 'organization' },
    },
    limits: { maxPendingJobs: 3 },
  },
  providers: [ReminderJobs],
})
class RemindersPlugin {}

describe('harness jobs', () => {
  let harness: PluginTestHarness;
  let jobs: ReminderJobs;

  beforeEach(async () => {
    harness = await createPluginTestHarness(RemindersPlugin, {
      actor: {
        id: 'a'.repeat(24),
        memberships: [{ organizationId: 'org-a', roles: ['member'] }],
      },
      tenant: orgA,
      organizations: [orgA, orgB],
    });
    jobs = harness.module.get(ReminderJobs);
  });
  afterEach(() => harness.close());

  const proxy = () => harness.module.get(JobsProxy);

  it('should run due jobs without an actor, in the organization they were scheduled in', async () => {
    await proxy().schedule('remind', {
      runAt: later(60_000),
      payload: { text: 'a' },
    });
    harness.context.setTenant(orgB);
    await proxy().schedule('remind', {
      runAt: later(30_000),
      payload: { text: 'b' },
    });

    expect(await harness.jobs.runDue(now)).toEqual([]);
    const results = await harness.jobs.runDue(later(60_000));
    expect(results.map((r) => r.status)).toEqual(['done', 'done']);
    expect(jobs.runs).toEqual([
      ['remind', 'org-b', null, 1],
      ['remind', 'org-a', null, 1],
    ]);
    // The "request" is untouched
    expect(harness.context.tenant()).toEqual(orgB);
    expect(harness.context.actor()?.id).toBe('a'.repeat(24));
    expect(
      [...harness.data.store.get('reminders')!.values()].map(
        (r) => (r as { organizationId: string }).organizationId,
      ),
    ).toEqual(['org-b', 'org-a']);
  });

  it('should deduplicate by key per organization, and cancel, reschedule and find by key', async () => {
    const first = await proxy().schedule('remind', {
      key: 'r:1',
      runAt: later(1000),
      payload: { text: 'a' },
    });
    expect(
      await proxy().schedule('remind', {
        key: 'r:1',
        payload: { text: 'again' },
      }),
    ).toEqual(first);
    harness.context.setTenant(orgB);
    expect(
      (await proxy().schedule('remind', { key: 'r:1', payload: { text: 'b' } }))
        .id,
    ).not.toBe(first.id);
    harness.context.setTenant(orgA);

    expect((await proxy().reschedule('r:1', later(5000)))?.runAt).toEqual(
      later(5000),
    );
    expect(await proxy().cancel('r:1')).toBe(true);
    expect(await proxy().cancel('r:1')).toBe(false);
    expect((await proxy().find('r:1'))?.status).toBe('canceled');
    expect(await proxy().find('r:2')).toBeNull();
  });

  it('should retry a failed run with backoff, then mark it failed', async () => {
    jobs.failuresLeft = 5;
    await proxy().schedule('remind', { payload: { text: 'a' } });

    expect(await harness.jobs.runDue(now)).toEqual([
      expect.objectContaining({ status: 'pending', error: 'flaky' }),
    ]);
    // Not before the 5 s backoff
    expect(await harness.jobs.runDue(later(4000))).toEqual([]);
    expect(await harness.jobs.runDue(later(5000))).toEqual([
      expect.objectContaining({ status: 'failed', error: 'flaky' }),
    ]);
    expect(jobs.runs.map((run) => run[3])).toEqual([1, 2]);
  });

  it('should run the jobs a job schedules, and occurrences of a schedule', async () => {
    await proxy().schedule('remind', { payload: { text: 'chain' } });
    expect((await harness.jobs.runDue(now)).length).toBe(2);
    expect(jobs.runs.map(([, tenant]) => tenant)).toEqual(['org-a', 'org-a']);

    expect(await harness.jobs.runSchedule('nightly', 'org-b', now)).toEqual(
      expect.objectContaining({ name: 'sweep', status: 'done' }),
    );
    expect(jobs.runs.at(-1)).toEqual(['sweep:nightly', 'org-b', null, 1]);
  });

  it('should cancel expired jobs instead of running them', async () => {
    await proxy().schedule('remind', {
      runAt: later(1000),
      expiresAt: later(2000),
      payload: { text: 'a' },
    });
    expect(await harness.jobs.runDue(later(3000))).toEqual([
      expect.objectContaining({ status: 'canceled' }),
    ]);
    expect(jobs.runs).toEqual([]);
  });

  it('should refuse undeclared jobs and more pending jobs than maxPendingJobs', async () => {
    await expect(proxy().schedule('other')).rejects.toThrow(
      PluginUndeclaredJobError,
    );
    for (let i = 0; i < 3; i++)
      await proxy().schedule('remind', { payload: { text: `${i}` } });
    await expect(
      proxy().schedule('remind', { payload: { text: 'x' } }),
    ).rejects.toThrow(PluginQuotaExceededError);
  });
});
