/**
 * Wall-clock arithmetic for named IANA time zones.
 *
 * Every instant Hadiya stores is UTC, which is the only representation that
 * cannot be misread. What a person means, though, is a wall clock: "tomorrow at
 * ten" is ten o'clock in Tashkent, not ten o'clock UTC, and the two differ by
 * five hours — and by a different amount again in a zone that observes daylight
 * saving. So the conversion has to happen somewhere, once, correctly.
 *
 * `Intl.DateTimeFormat` already carries the full IANA database, including every
 * historical and future offset change, so these helpers use it as the source of
 * truth rather than adding a dependency that ships its own copy.
 */

/** Used when a user has expressed no preference; Hadiya's home market. */
export const DEFAULT_TIMEZONE = 'Asia/Tashkent';

export interface ZonedParts {
  year: number;
  /** 1–12, not the zero-based month `Date` uses. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** ISO-8601 weekday: 1 is Monday, 7 is Sunday. */
  weekday: number;
}

/** The date half of a wall clock, with no time attached. */
export type CalendarDay = Pick<ZonedParts, 'year' | 'month' | 'day'>;

/** The time half. */
export type WallTime = Pick<ZonedParts, 'hour' | 'minute' | 'second'>;

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/**
 * Building a formatter is expensive enough to matter: the scheduler converts
 * thousands of candidate days while searching for the next occurrence.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatterCache.get(timeZone);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  formatterCache.set(timeZone, formatter);

  return formatter;
};

/**
 * Whether the runtime recognises the zone. Anything unknown must be rejected at
 * the edge: a typo silently falling back to UTC would fire every reminder at
 * the wrong hour, and nothing about the stored record would look wrong.
 */
export const isValidTimeZone = (timeZone: string): boolean => {
  if (timeZone.trim().length === 0) {
    return false;
  }

  try {
    // Throws `RangeError` for a zone the ICU data does not know.
    new Intl.DateTimeFormat('en-US', { timeZone });

    return true;
  } catch {
    return false;
  }
};

/**
 * `Date.UTC` treats years 0–99 as 1900-relative, so the year is set separately.
 */
const utcMsFromParts = (parts: CalendarDay & Partial<WallTime>): number => {
  const date = new Date(0);

  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, 0);

  return date.getTime();
};

/** Reads the wall clock as a number, by pretending the local reading is UTC. */
const wallClockMs = (instant: Date, timeZone: string): number => {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value ?? '0';

    return Number.parseInt(value, 10);
  };

  return utcMsFromParts({
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // Some ICU builds still report midnight as hour 24 rather than 0.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  });
};

/**
 * How far the zone is ahead of UTC at that instant, daylight saving included.
 * Positive east of Greenwich.
 */
export const getTimeZoneOffsetMs = (instant: Date, timeZone: string): number =>
  wallClockMs(instant, timeZone) - instant.getTime();

/** What the clock on the wall reads in `timeZone` at that instant. */
export const toZonedParts = (instant: Date, timeZone: string): ZonedParts => {
  const wall = new Date(wallClockMs(instant, timeZone));

  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
    second: wall.getUTCSeconds(),
    // `getUTCDay()` is Sunday-first; ISO counts Monday as 1.
    weekday: wall.getUTCDay() === 0 ? 7 : wall.getUTCDay(),
  };
};

/**
 * Turns a wall clock back into the instant it names.
 *
 * The offset depends on the instant, and the instant is what we are solving
 * for, so the first pass guesses with the offset in force at the same clock
 * reading in UTC and the second corrects it. Two passes settle every real zone:
 * offset changes are at most a few hours, far less than the day the first guess
 * is accurate to.
 *
 * Around a daylight-saving jump the answer is still defined but not always the
 * literal reading. A clock time that never happened (the hour skipped in
 * spring) resolves to the instant just after the jump, and one that happens
 * twice (autumn) resolves to the first. Both are deliberate: a reminder set for
 * a missing hour should still fire that morning.
 */
export const zonedPartsToInstant = (
  parts: CalendarDay & Partial<WallTime>,
  timeZone: string,
): Date => {
  const wall = utcMsFromParts(parts);
  const firstGuess = wall - getTimeZoneOffsetMs(new Date(wall), timeZone);

  return new Date(wall - getTimeZoneOffsetMs(new Date(firstGuess), timeZone));
};

export const toCalendarDay = (instant: Date, timeZone: string): CalendarDay => {
  const { year, month, day } = toZonedParts(instant, timeZone);

  return { year, month, day };
};

/** Midnight at the start of that instant's local day. */
export const startOfDayInTimeZone = (instant: Date, timeZone: string): Date =>
  zonedPartsToInstant({ ...toCalendarDay(instant, timeZone), hour: 0, minute: 0, second: 0 }, timeZone);

/**
 * Calendar days are compared as counts, never as instants: two wall-clock days
 * are not always exactly 24 hours apart, but they are always one day apart.
 */
export const dayNumber = (day: CalendarDay): number => Math.round(utcMsFromParts(day) / MS_PER_DAY);

export const addCalendarDays = (day: CalendarDay, days: number): CalendarDay => {
  const shifted = new Date(utcMsFromParts(day) + days * MS_PER_DAY);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
};

/** ISO weekday of a calendar day: 1 Monday … 7 Sunday. */
export const weekdayOf = (day: CalendarDay): number => {
  const weekday = new Date(utcMsFromParts(day)).getUTCDay();

  return weekday === 0 ? 7 : weekday;
};

/** Whole months between two calendar days, ignoring the day of the month. */
export const monthsBetween = (from: CalendarDay, to: CalendarDay): number =>
  (to.year - from.year) * 12 + (to.month - from.month);

/** Monday, per RFC 5545's default week start. */
export const startOfIsoWeek = (day: CalendarDay): CalendarDay =>
  addCalendarDays(day, -(weekdayOf(day) - 1));

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

/** `YYYY-MM-DD` as read in the given zone. */
export const formatIsoDateInTimeZone = (instant: Date, timeZone: string): string => {
  const { year, month, day } = toZonedParts(instant, timeZone);

  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
};

/** `HH:mm` as read in the given zone. */
export const formatIsoTimeInTimeZone = (instant: Date, timeZone: string): string => {
  const { hour, minute } = toZonedParts(instant, timeZone);

  return `${pad(hour)}:${pad(minute)}`;
};

/**
 * `YYYY-MM-DD HH:mm (+05:00)` — the form used wherever a person has to be able
 * to check the conversion, including the confirmation the assistant reads back.
 */
export const formatInTimeZone = (instant: Date, timeZone: string): string => {
  const offsetMinutes = Math.round(getTimeZoneOffsetMs(instant, timeZone) / MS_PER_MINUTE);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);

  return `${formatIsoDateInTimeZone(instant, timeZone)} ${formatIsoTimeInTimeZone(
    instant,
    timeZone,
  )} (${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)})`;
};

/** Rejects 31 February, which `Date` would silently roll into March. */
export const isRealCalendarDay = (day: CalendarDay): boolean => {
  const rebuilt = new Date(utcMsFromParts(day));

  return (
    rebuilt.getUTCFullYear() === day.year &&
    rebuilt.getUTCMonth() + 1 === day.month &&
    rebuilt.getUTCDate() === day.day
  );
};

export const isRealWallTime = (time: WallTime): boolean =>
  time.hour >= 0 &&
  time.hour <= 23 &&
  time.minute >= 0 &&
  time.minute <= 59 &&
  time.second >= 0 &&
  time.second <= 59;

/** `YYYY-MM-DDTHH:mm[:ss]`, with no zone designator — a wall clock, not an instant. */
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ParsedLocalDateTime {
  day: CalendarDay;
  /** `null` when the text named a date but no time of day. */
  time: WallTime | null;
}

/**
 * Reads a wall-clock string. A bare date is reported as having no time rather
 * than being defaulted to midnight — the caller has to decide whether an
 * unstated hour is a reason to ask, and silently choosing 00:00 would turn
 * "remind me on Friday" into a reminder nobody is awake for.
 */
export const parseLocalDateTime = (value: string): ParsedLocalDateTime | null => {
  const text = value.trim();
  const withTime = LOCAL_DATE_TIME_PATTERN.exec(text);

  if (withTime) {
    const [, year, month, day, hour, minute, second] = withTime;
    const parsed = {
      day: { year: Number(year), month: Number(month), day: Number(day) },
      time: { hour: Number(hour), minute: Number(minute), second: Number(second ?? 0) },
    };

    return isRealCalendarDay(parsed.day) && isRealWallTime(parsed.time) ? parsed : null;
  }

  const dateOnly = LOCAL_DATE_PATTERN.exec(text);

  if (!dateOnly) {
    return null;
  }

  const [, year, month, day] = dateOnly;
  const parsed = { year: Number(year), month: Number(month), day: Number(day) };

  return isRealCalendarDay(parsed) ? { day: parsed, time: null } : null;
};

/** `HH:mm` or `HH:mm:ss`, as a stored preference such as an "evening" time. */
export const parseWallTime = (value: string): WallTime | null => {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const time = {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3] ?? 0),
  };

  return isRealWallTime(time) ? time : null;
};
