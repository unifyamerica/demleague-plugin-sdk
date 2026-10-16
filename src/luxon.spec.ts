import * as sdk from './index';
import { DateTime, Duration, IANAZone } from './luxon';

describe('luxon pass-through', () => {
  it('should convert a wall-clock time in a time zone to UTC', () => {
    const startsAt = DateTime.fromISO('2027-08-01T19:00', {
      zone: 'America/New_York',
    });
    expect(startsAt.toUTC().toISO()).toBe('2027-08-01T23:00:00.000Z');
    expect(IANAZone.isValidZone('America/Chicago')).toBe(true);
    expect(Duration.fromObject({ seconds: 90 }).as('minutes')).toBe(1.5);
  });

  it('should be part of the root entry, without the global Settings', () => {
    expect(sdk.DateTime).toBe(DateTime);
    expect('Settings' in sdk).toBe(false);
  });
});
