import type { PluginJobInfo, ScheduleJobOptions } from '../types/jobs';

/**
 * Schedules the plugin's jobs (declared in `manifest.jobs`, approved in the namespace registry) in the current
 * organization: the request's, or the one the job, event handler or lifecycle hook runs in (none without one).
 * The host runs each job once it's due, on one API instance, without an acting user, while the module is turned
 * on in that organization.
 *
 * Errors: `PluginUndeclaredJobError`, `PluginValidationError` (bad options, a payload that isn't plain JSON),
 * `PluginPayloadTooLargeError`, `PluginQuotaExceededError` (`jobsPerMinute`, `maxPendingJobs`).
 */
export abstract class JobsProxy {
  /** Adds a job, or returns the pending (or running) one with the same `key`. */
  abstract schedule(
    job: string,
    options?: ScheduleJobOptions,
  ): Promise<PluginJobInfo>;
  /** Cancels the pending job with this key; `false` if there's none. A running job finishes. */
  abstract cancel(key: string): Promise<boolean>;
  /** Moves the pending job with this key; `null` if there's none. */
  abstract reschedule(
    key: string,
    runAt: Date | string,
  ): Promise<PluginJobInfo | null>;
  /** The latest job with this key in the current organization, whatever its status; `null` if there's none. */
  abstract find(key: string): Promise<PluginJobInfo | null>;
}
