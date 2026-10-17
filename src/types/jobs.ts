import {
  PluginPayloadTooLargeError,
  PluginValidationError,
} from '../errors/sdk-errors';
import { isPlainJson } from './calls';
import type { JsonValue } from './events';

// Scheduled jobs. A plugin declares its jobs (`manifest.jobs`, each implemented by one `@JobHandler()` method)
// and, optionally, recurring schedules for them (`manifest.schedules`); the core team approves both in the
// namespace registry. The plugin schedules one-off runs with `JobsProxy`. The host keeps every job in its
// database and runs it on exactly one API instance at a time, however many there are, retrying it if it fails.
//
// A job runs at least once: a crash mid-run means it runs again, so handlers must be idempotent (check the
// state they're about to change before changing it). It runs without an acting user, in the organization it
// was scheduled in, and only while the module is turned on there.

// Job and schedule names: lowercase kebab-case, e.g. `round-end`
export const JOB_NAME_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;

// A job's dedup key, chosen by the plugin, e.g. `round-end:64b…:q1-r2`
export const JOB_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/;
// Keys starting with this are the host's (recurring schedules' occurrences)
export const RESERVED_JOB_KEY_PREFIX = 'schedule:';

// The most JSON a job's payload may hold
export const MAX_JOB_PAYLOAD_BYTES = 32 * 1024;
// How far ahead a job may be scheduled
export const MAX_JOB_DELAY_MS = 366 * 24 * 60 * 60 * 1000;
// Runs per job, first one included, when a job doesn't say
export const DEFAULT_JOB_MAX_ATTEMPTS = 3;
export const MAX_JOB_MAX_ATTEMPTS = 10;

export const JobStatuses = {
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  CANCELED: 'canceled',
} as const;
export type JobStatus = (typeof JobStatuses)[keyof typeof JobStatuses];

export const ScheduleScopes = {
  // Once per organization the module is turned on in, running in it
  ORGANIZATION: 'organization',
  // Once for the whole platform, in no organization (needs the core team's explicit approval)
  GLOBAL: 'global',
} as const;
export type ScheduleScope =
  (typeof ScheduleScopes)[keyof typeof ScheduleScopes];

export interface PluginJobDeclaration {
  summary?: string;
  // How long one run may take (at most the plugin's `jobTimeoutMs` limit, which is also the default)
  timeoutMs?: number;
  // Runs before the job counts as failed, first one included (default 3, at most 10). Retries wait 5 s, 10 s,
  // 20 s… up to an hour.
  maxAttempts?: number;
}

// Job name → declaration, e.g. `{ 'round-end': { timeoutMs: 10_000 } }`
export type PluginJobs = Record<string, PluginJobDeclaration>;

export interface PluginScheduleDeclaration {
  summary?: string;
  // Five fields (minute hour day-of-month month day-of-week), e.g. `0 3 * * *` for 3 am daily
  cron: string;
  // IANA time zone the cron expression is read in (default `UTC`)
  timeZone?: string;
  // The job it runs (declared in `manifest.jobs`)
  job: string;
  scope: ScheduleScope;
}

// Schedule name → declaration, e.g. `{ 'nightly-cleanup': { cron: '0 3 * * *', job: 'cleanup', scope: 'organization' } }`
export type PluginSchedules = Record<string, PluginScheduleDeclaration>;

export interface ScheduleJobOptions {
  // When to run it (a Date or an ISO string); in the past or omitted with no `delayMs`: as soon as possible
  runAt?: Date | string;
  // …or in this many milliseconds
  delayMs?: number;
  // Plain JSON, at most MAX_JOB_PAYLOAD_BYTES, copied
  payload?: JsonValue;
  // Dedup key: while a job with this key is pending or running in this organization, scheduling it again
  // returns that job instead of adding one. Also how to cancel, reschedule or find it.
  key?: string;
  // Don't run it after this (e.g. while the module was turned off): it's canceled instead
  expiresAt?: Date | string;
}

// A job as the plugin sees it
export interface PluginJobInfo {
  id: string;
  name: string;
  key: string | null;
  status: JobStatus;
  runAt: Date;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
}

// What a `@JobHandler()` method receives
export interface PluginJob<TPayload extends JsonValue = JsonValue> {
  id: string;
  name: string;
  key: string | null;
  // A copy of what was scheduled (`null` for none), frozen
  payload: Readonly<TPayload>;
  // When it was due (ISO); a run can be late, e.g. while the module was turned off
  scheduledFor: string;
  // 1 for the first run, 2 for the first retry…
  attempt: number;
  // The recurring schedule it's an occurrence of, if any
  schedule: string | null;
}

export type PluginJobHandler<TPayload extends JsonValue = JsonValue> = (
  job: PluginJob<TPayload>,
) => void | Promise<void>;

// The five fields of a cron expression: numbers, ranges, steps, lists, `*`, and month / weekday names. The host
// checks the expression fully when it loads the plugin.
const CRON_FIELD =
  /^(\*|[0-9A-Za-z]+(-[0-9A-Za-z]+)?)(\/[0-9]+)?(,(\*|[0-9A-Za-z]+(-[0-9A-Za-z]+)?)(\/[0-9]+)?)*$/;
export const isCronExpression = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().split(/\s+/).length === 5 &&
  value
    .trim()
    .split(/\s+/)
    .every((field) => CRON_FIELD.test(field));

export const isTimeZone = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

/** How long a failed run waits before the next attempt: 5 s, 10 s, 20 s… up to an hour. */
export const jobRetryDelayMs = (attempts: number): number =>
  Math.min(5_000 * 2 ** Math.max(attempts - 1, 0), 60 * 60_000);

export interface ResolvedScheduleOptions {
  runAt: Date;
  payload: JsonValue;
  key: string | null;
  expiresAt: Date | null;
}

const toDate = (value: Date | string, what: string): Date => {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new PluginValidationError(`${what} must be a valid date`);
  }
  return date;
};

/**
 * `JobsProxy.schedule()`'s options checked and normalized (the host and the test harness both use this): when it
 * runs (`now` if not given or in the past), a copy of the payload, the key and the expiry.
 */
export function resolveScheduleOptions(
  options: ScheduleJobOptions = {},
  now: Date,
): ResolvedScheduleOptions {
  if (options.runAt !== undefined && options.delayMs !== undefined) {
    throw new PluginValidationError('Give either runAt or delayMs, not both');
  }
  if (
    options.delayMs !== undefined &&
    (typeof options.delayMs !== 'number' ||
      !Number.isFinite(options.delayMs) ||
      options.delayMs < 0)
  ) {
    throw new PluginValidationError(
      'delayMs must be a number of milliseconds, 0 or more',
    );
  }
  let runAt =
    options.runAt !== undefined
      ? toDate(options.runAt, 'runAt')
      : new Date(now.getTime() + (options.delayMs ?? 0));
  if (runAt < now) runAt = new Date(now.getTime());
  if (runAt.getTime() - now.getTime() > MAX_JOB_DELAY_MS) {
    throw new PluginValidationError(
      'A job can be scheduled at most a year ahead',
    );
  }

  const key = options.key ?? null;
  if (key !== null) {
    if (typeof key !== 'string' || !JOB_KEY_PATTERN.test(key)) {
      throw new PluginValidationError(
        'key must be 1–200 letters, digits, ":", ".", "_" or "-", starting with a letter or digit',
      );
    }
    if (key.startsWith(RESERVED_JOB_KEY_PREFIX)) {
      throw new PluginValidationError(
        `Keys starting with "${RESERVED_JOB_KEY_PREFIX}" are reserved`,
      );
    }
  }
  const expiresAt =
    options.expiresAt === undefined
      ? null
      : toDate(options.expiresAt, 'expiresAt');
  return { runAt, payload: copyJobPayload(options.payload), key, expiresAt };
}

/** A copy of a job's payload: plain JSON (`undefined` → `null`), at most MAX_JOB_PAYLOAD_BYTES. */
export function copyJobPayload(value: unknown): JsonValue {
  if (value === undefined) return null;
  if (!isPlainJson(value)) {
    throw new PluginValidationError(
      'A job payload must be plain JSON (no dates, class instances, functions or undefined values)',
    );
  }
  const json = JSON.stringify(value);
  const size = new TextEncoder().encode(json).length;
  if (size > MAX_JOB_PAYLOAD_BYTES) {
    throw new PluginPayloadTooLargeError(
      `A job payload is ${size} bytes, the limit is ${MAX_JOB_PAYLOAD_BYTES}`,
    );
  }
  return JSON.parse(json) as JsonValue;
}
