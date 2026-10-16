import {
  PluginPayloadTooLargeError,
  PluginValidationError,
} from '../errors/sdk-errors';
import {
  copyJobPayload,
  isCronExpression,
  jobRetryDelayMs,
  MAX_JOB_PAYLOAD_BYTES,
  resolveScheduleOptions,
} from './jobs';

const now = new Date('2027-08-01T12:00:00.000Z');

describe('resolveScheduleOptions', () => {
  it('should run now without a time, and never in the past', () => {
    expect(resolveScheduleOptions({}, now)).toEqual({
      runAt: now,
      payload: null,
      key: null,
      expiresAt: null,
    });
    expect(
      resolveScheduleOptions({ runAt: '2020-01-01T00:00:00Z' }, now).runAt,
    ).toEqual(now);
  });

  it('should take a time, a delay, a key, an expiry and a copied payload', () => {
    const payload = { assemblyId: 'a1', rounds: [1, 2] };
    const resolved = resolveScheduleOptions(
      {
        delayMs: 60_000,
        payload,
        key: 'round-end:a1:q1-r2',
        expiresAt: '2027-08-02T00:00:00Z',
      },
      now,
    );
    expect(resolved).toEqual({
      runAt: new Date('2027-08-01T12:01:00.000Z'),
      payload,
      key: 'round-end:a1:q1-r2',
      expiresAt: new Date('2027-08-02T00:00:00.000Z'),
    });
    expect(resolved.payload).not.toBe(payload);
    expect(
      resolveScheduleOptions({ runAt: new Date('2027-08-01T13:00:00Z') }, now)
        .runAt,
    ).toEqual(new Date('2027-08-01T13:00:00Z'));
  });

  it.each([
    [{ runAt: now, delayMs: 5 }, 'either runAt or delayMs'],
    [{ delayMs: -1 }, 'delayMs'],
    [{ runAt: 'soon' }, 'runAt must be a valid date'],
    [{ runAt: '2029-01-01T00:00:00Z' }, 'at most a year ahead'],
    [{ key: 'has space' }, 'key must be'],
    [{ key: 'schedule:nightly' }, 'reserved'],
    [{ payload: { at: new Date() } }, 'plain JSON'],
  ])('should reject %j', (options, message) => {
    expect(() => resolveScheduleOptions(options as never, now)).toThrow(
      PluginValidationError,
    );
    expect(() => resolveScheduleOptions(options as never, now)).toThrow(
      message,
    );
  });

  it('should reject payloads over the limit', () => {
    expect(() =>
      copyJobPayload({ text: 'x'.repeat(MAX_JOB_PAYLOAD_BYTES) }),
    ).toThrow(PluginPayloadTooLargeError);
  });
});

describe('isCronExpression', () => {
  it.each(['0 3 * * *', '*/5 * * * *', '0 9-17/2 1,15 JAN-JUN MON-FRI'])(
    'should accept %s',
    (cron) => {
      expect(isCronExpression(cron)).toBe(true);
    },
  );

  it.each(['', '0 3 * *', '0 3 * * * *', '0 3 ? * *', 3])(
    'should reject %j',
    (cron) => {
      expect(isCronExpression(cron)).toBe(false);
    },
  );
});

describe('jobRetryDelayMs', () => {
  it('should double from 5 s up to an hour', () => {
    expect([1, 2, 3, 4].map(jobRetryDelayMs)).toEqual([
      5_000, 10_000, 20_000, 40_000,
    ]);
    expect(jobRetryDelayMs(20)).toBe(3_600_000);
  });
});
