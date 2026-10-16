import type { Provider } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { getJobHandlers } from '../decorators/job-handler.decorator';
import {
  PluginQuotaExceededError,
  PluginUndeclaredJobError,
  PluginValidationError,
} from '../errors/sdk-errors';
import { JobsProxy } from '../services/jobs.proxy';
import type { PluginOrganization } from '../types/dto';
import type { JsonValue } from '../types/events';
import {
  DEFAULT_JOB_MAX_ATTEMPTS,
  jobRetryDelayMs,
  JobStatuses,
  resolveScheduleOptions,
  RESERVED_JOB_KEY_PREFIX,
  type JobStatus,
  type PluginJob,
  type PluginJobInfo,
  type ScheduleJobOptions,
} from '../types/jobs';
import { DEFAULT_RESOURCE_LIMITS } from '../types/manifest';
import type { TestPluginContext } from './in-memory-services';

// A job as the harness keeps it (`harness.jobs.jobs`)
export interface InMemoryJob {
  id: string;
  name: string;
  key: string | null;
  payload: JsonValue;
  runAt: Date;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  organizationId: string | null;
  expiresAt: Date | null;
  schedule: string | null;
  createdAt: Date;
}

// One run of `runDue()` / `run()`
export interface JobRunResult {
  id: string;
  name: string;
  key: string | null;
  // `done`, `pending` (it failed and will be retried), `failed` (no attempts left) or `canceled` (expired)
  status: JobStatus;
  error: string | null;
}

type JobMethod = (job: PluginJob) => unknown;

let nextId = 1;
const newId = () => (nextId++).toString(16).padStart(24, '0');

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const infoOf = (job: InMemoryJob): PluginJobInfo => ({
  id: job.id,
  name: job.name,
  key: job.key,
  status: job.status,
  runAt: new Date(job.runAt.getTime()),
  attempts: job.attempts,
  lastError: job.lastError,
  createdAt: new Date(job.createdAt.getTime()),
});

/**
 * The harness's `JobsProxy`: jobs are kept in memory and only run when the test says so (`runDue()`, `run()`,
 * `runSchedule()`), each without an acting user in the organization it was scheduled in, like the host. It checks
 * declared jobs, the options, the payload, dedup keys and `maxPendingJobs`, and retries a failed run (with the
 * host's backoff) until `maxAttempts`. It doesn't enforce `jobsPerMinute`, timeouts or concurrency, or the
 * module being turned on.
 */
export class InMemoryJobsProxy extends JobsProxy {
  // Every job, whatever its status
  readonly jobs: InMemoryJob[] = [];
  private handlers = new Map<string, JobMethod>();

  constructor(
    private readonly context: TestPluginContext,
    private readonly organizations: ReadonlyMap<string, PluginOrganization>,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
  }

  /** Finds the plugin's `@JobHandler()` methods (done by the harness once the module is compiled). */
  attach(module: TestingModule, providers: Provider[]): void {
    for (const provider of providers) {
      const [token, owner] =
        typeof provider === 'function'
          ? [provider, provider]
          : 'useClass' in provider && provider.useClass
            ? [provider.provide, provider.useClass]
            : [null, null];
      if (!owner) continue;
      for (const { job, methodName } of getJobHandlers(owner)) {
        const instance = module.get(token, { strict: false }) as Record<
          string,
          JobMethod
        >;
        this.handlers.set(job, (run) => instance[methodName](run));
      }
    }
  }

  private get tenantId(): string | null {
    return this.context.tenant()?.id ?? null;
  }

  private active(key: string): InMemoryJob | undefined {
    return this.jobs.find(
      (job) =>
        job.key === key &&
        job.organizationId === this.tenantId &&
        (job.status === JobStatuses.PENDING ||
          job.status === JobStatuses.RUNNING),
    );
  }

  schedule(
    name: string,
    options: ScheduleJobOptions = {},
  ): Promise<PluginJobInfo> {
    return Promise.resolve().then(() => {
      const declaration = this.context.manifest.jobs?.[name];
      if (!declaration) {
        throw new PluginUndeclaredJobError(this.context.namespace, name);
      }
      const resolved = resolveScheduleOptions(options, this.now());
      const existing = resolved.key ? this.active(resolved.key) : undefined;
      if (existing) {
        return infoOf(existing);
      }
      const maxPending =
        this.context.manifest.limits?.maxPendingJobs ??
        DEFAULT_RESOURCE_LIMITS.maxPendingJobs;
      if (
        this.jobs.filter((job) => job.status === JobStatuses.PENDING).length >=
        maxPending
      ) {
        throw new PluginQuotaExceededError(
          this.context.namespace,
          'maxPendingJobs',
          maxPending,
        );
      }
      const job: InMemoryJob = {
        id: newId(),
        name,
        key: resolved.key,
        payload: resolved.payload,
        runAt: resolved.runAt,
        status: JobStatuses.PENDING,
        attempts: 0,
        maxAttempts: declaration.maxAttempts ?? DEFAULT_JOB_MAX_ATTEMPTS,
        lastError: null,
        organizationId: this.tenantId,
        expiresAt: resolved.expiresAt,
        schedule: null,
        createdAt: this.now(),
      };
      this.jobs.push(job);
      return infoOf(job);
    });
  }

  cancel(key: string): Promise<boolean> {
    const job = this.active(key);
    if (job?.status !== JobStatuses.PENDING) return Promise.resolve(false);
    job.status = JobStatuses.CANCELED;
    return Promise.resolve(true);
  }

  reschedule(key: string, runAt: Date | string): Promise<PluginJobInfo | null> {
    return Promise.resolve().then(() => {
      const job = this.active(key);
      if (job?.status !== JobStatuses.PENDING) return null;
      job.runAt = resolveScheduleOptions({ runAt }, this.now()).runAt;
      return infoOf(job);
    });
  }

  find(key: string): Promise<PluginJobInfo | null> {
    const found = this.jobs
      .filter((job) => job.key === key && job.organizationId === this.tenantId)
      .at(-1);
    return Promise.resolve(found ? infoOf(found) : null);
  }

  /** The pending jobs, soonest first. */
  pending(): InMemoryJob[] {
    return this.jobs
      .filter((job) => job.status === JobStatuses.PENDING)
      .sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
  }

  /**
   * Runs every pending job due at `at` (default: now), soonest first, including ones those runs schedule if they're
   * due too. A failed run is retried later (`jobRetryDelayMs` after `at`) until its `maxAttempts`, so call it again
   * with a later `at` to run the retries.
   */
  async runDue(at: Date = this.now()): Promise<JobRunResult[]> {
    const results: JobRunResult[] = [];
    for (;;) {
      const due = this.pending().find((job) => job.runAt <= at);
      if (!due) return results;
      results.push(await this.execute(due, at));
    }
  }

  /** Runs the job with this key (in the current organization) or id now, whenever it's due. */
  async run(keyOrId: string, at: Date = this.now()): Promise<JobRunResult> {
    const job =
      this.jobs.find(
        (candidate) =>
          candidate.id === keyOrId && candidate.status === JobStatuses.PENDING,
      ) ?? this.active(keyOrId);
    if (job?.status !== JobStatuses.PENDING) {
      throw new Error(`No pending job "${keyOrId}"`);
    }
    return this.execute(job, at);
  }

  /** Runs one occurrence of a recurring schedule now, in `organizationId` (`null` for a global one). */
  async runSchedule(
    schedule: string,
    organizationId: string | null = null,
    at: Date = this.now(),
  ): Promise<JobRunResult> {
    const declaration = this.context.manifest.schedules?.[schedule];
    if (!declaration) {
      throw new PluginValidationError(
        `No schedule "${schedule}" in manifest.schedules`,
      );
    }
    const job: InMemoryJob = {
      id: newId(),
      name: declaration.job,
      key: `${RESERVED_JOB_KEY_PREFIX}${schedule}`,
      payload: null,
      runAt: at,
      status: JobStatuses.PENDING,
      attempts: 0,
      maxAttempts:
        this.context.manifest.jobs?.[declaration.job]?.maxAttempts ??
        DEFAULT_JOB_MAX_ATTEMPTS,
      lastError: null,
      organizationId,
      expiresAt: null,
      schedule,
      createdAt: at,
    };
    this.jobs.push(job);
    return this.execute(job, at);
  }

  private async execute(job: InMemoryJob, at: Date): Promise<JobRunResult> {
    const result = (error: string | null): JobRunResult => ({
      id: job.id,
      name: job.name,
      key: job.key,
      status: job.status,
      error,
    });
    if (job.expiresAt && job.expiresAt < at) {
      job.status = JobStatuses.CANCELED;
      return result(null);
    }
    const handler = this.handlers.get(job.name);
    job.status = JobStatuses.RUNNING;
    job.attempts += 1;
    const tenant = job.organizationId
      ? (this.organizations.get(job.organizationId) ?? {
          id: job.organizationId,
          name: '',
          slug: '',
          description: null,
        })
      : null;
    try {
      if (!handler) {
        throw new Error(
          `No @JobHandler('${job.name}') method in the plugin's providers`,
        );
      }
      const run: PluginJob = Object.freeze({
        id: job.id,
        name: job.name,
        key: job.key,
        payload: Object.freeze(structuredClone(job.payload)),
        scheduledFor: job.runAt.toISOString(),
        attempt: job.attempts,
        schedule: job.schedule,
      });
      await this.context.runAsSystem(tenant, () =>
        Promise.resolve().then(() => handler(run)),
      );
      job.status = JobStatuses.DONE;
      job.lastError = null;
      return result(null);
    } catch (error) {
      job.lastError = errorMessage(error);
      if (job.attempts < job.maxAttempts) {
        job.status = JobStatuses.PENDING;
        job.runAt = new Date(at.getTime() + jobRetryDelayMs(job.attempts));
      } else {
        job.status = JobStatuses.FAILED;
      }
      return result(job.lastError);
    }
  }
}
