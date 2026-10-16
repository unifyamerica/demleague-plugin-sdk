// luxon, passed through to plugins (API and UI) so dates and time zones don't need a package of their own.
// One copy for everyone: the host bundles it with the SDK, and plugins keep the SDK external.
//
// ⚠️ `Settings` is deliberately left out: it's global, so a plugin changing `Settings.defaultZone` (or the
// default locale or clock) would change every other plugin's dates, and the SPA's. Pass `{ zone }` and
// `{ locale }` per call instead.
export {
  DateTime,
  Duration,
  Interval,
  Info,
  Zone,
  IANAZone,
  FixedOffsetZone,
} from 'luxon';
export type {
  DateObjectUnits,
  DateTimeFormatOptions,
  DateTimeJSOptions,
  DateTimeOptions,
  DurationLike,
  DurationLikeObject,
  DurationUnit,
  ToISOTimeOptions,
  WeekdayNumbers,
} from 'luxon';
