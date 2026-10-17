import { PLUGIN_JOB_HANDLER_METADATA } from '../constants';
import { JOB_NAME_PATTERN } from '../types/jobs';

export interface JobHandlerMethod {
  job: string;
  methodName: string;
}

/**
 * Runs one of the plugin's jobs (`manifest.jobs`). Put it on a method of a class provider listed in
 * `@PluginModule({ providers })`; the method gets the `PluginJob` and returns nothing (or a promise). Throwing
 * fails the run, which is retried up to the job's `maxAttempts`:
 *
 *   @JobHandler('round-end')
 *   async roundEnd(job: PluginJob<{ assemblyId: string }>): Promise<void> { … }
 *
 * The host refuses to start a plugin whose jobs and `@JobHandler()` methods don't match exactly (each job handled
 * once).
 */
export function JobHandler(job: string): MethodDecorator {
  if (!JOB_NAME_PATTERN.test(job)) {
    throw new Error(
      `@JobHandler("${job}"): job names are lowercase kebab-case, e.g. "round-end"`,
    );
  }
  return (_target, _propertyKey, descriptor) => {
    Reflect.defineMetadata(
      PLUGIN_JOB_HANDLER_METADATA,
      job,
      descriptor.value as object,
    );
    return descriptor;
  };
}

/** The `@JobHandler()` methods of a class (including inherited ones), in declaration order. */
export function getJobHandlers(
  target: abstract new (...args: never[]) => unknown,
): JobHandlerMethod[] {
  const found: JobHandlerMethod[] = [];
  const seen = new Set<string>();
  for (
    let prototype = target.prototype as object | null;
    prototype && prototype !== Object.prototype;
    prototype = Object.getPrototypeOf(prototype) as object | null
  ) {
    for (const methodName of Object.getOwnPropertyNames(prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
      if (
        seen.has(methodName) ||
        methodName === 'constructor' ||
        typeof descriptor?.value !== 'function'
      ) {
        continue;
      }
      seen.add(methodName);
      const job = Reflect.getMetadata(
        PLUGIN_JOB_HANDLER_METADATA,
        descriptor.value as object,
      ) as string | undefined;
      if (job) {
        found.push({ job, methodName });
      }
    }
  }
  return found;
}
