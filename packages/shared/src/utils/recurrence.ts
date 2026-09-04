import {
  addCalendarDays,
  dayNumber,
  isRealCalendarDay,
  monthsBetween,
  startOfIsoWeek,
  toCalendarDay,
  toZonedParts,
  weekdayOf,
  zonedPartsToInstant,
  type CalendarDay,
} from './timezone.js';

/**
 * Repeating schedules, expressed as RFC 5545 recurrence rules.
 *
 * The format is the calendar standard — the same string an `.ics` file carries,
 * `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO` — rather than a shape invented here. That
 * matters beyond tidiness: a stored rule stays meaningful to anything that
 * speaks iCalendar, and the semantics of INTERVAL, BYDAY, COUNT and UNTIL are
 * already defined and argued over by somebody else.
 *
 * Only the subset Hadiya offers is accepted (daily, weekly and monthly repeats)
 * and anything outside it is rejected rather than half-understood: a rule that
 * parses but is evaluated wrongly would fire reminders on the wrong days
 * forever, and nothing about the stored record would look broken.
 *
 * Occurrences are computed against a named time zone, so a weekly reminder
 * stays at nine in the morning across a daylight-saving change instead of
 * drifting by an hour.
 */

export const RECURRENCE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;

export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** RFC 5545 weekday codes, Monday first. */
export const RECURRENCE_WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

export type RecurrenceWeekday = (typeof RECURRENCE_WEEKDAYS)[number];

/** Guards against a rule that repeats so often it becomes a denial of service. */
export const MAX_RECURRENCE_INTERVAL = 366;

/**
 * How far ahead a search will look for the next matching day. Four years
 * covers the worst supported case — a yearly-in-effect monthly rule landing on
 * 29 February — and bounds the loop for any rule that can never match again.
 */
const MAX_SEARCH_DAYS = 366 * 4;

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  /** Every `interval` days, weeks or months. At least 1. */
  interval: number;
  /** Weekly only. Empty means "the anchor's own weekday". */
  byWeekday: RecurrenceWeekday[];
  /** Monthly only. Empty means "the anchor's own day of the month". */
  byMonthDay: number[];
  /** Stop after this many occurrences in total, or `null` for no limit. */
  count: number | null;
  /** Stop after this instant, or `null` for no end. */
  until: Date | null;
}

export class RecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurrenceError';
  }
}

const WEEKDAY_NUMBERS: Record<RecurrenceWeekday, number> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 7,
};

const WEEKDAY_LABELS: Record<RecurrenceWeekday, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};

const isFrequency = (value: string): value is RecurrenceFrequency =>
  (RECURRENCE_FREQUENCIES as readonly string[]).includes(value);

const isWeekday = (value: string): value is RecurrenceWeekday =>
  (RECURRENCE_WEEKDAYS as readonly string[]).includes(value);

/** RFC 5545 basic-format UTC timestamp: `20260301T090000Z`. */
const UNTIL_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

const parseUntil = (value: string): Date => {
  const match = UNTIL_PATTERN.exec(value.trim());

  if (!match) {
    throw new RecurrenceError(
      `UNTIL must be a UTC timestamp in the form 20260301T090000Z, not "${value}"`,
    );
  }

  const [, year, month, day, hour, minute, second] = match;
  const instant = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );

  if (Number.isNaN(instant.getTime())) {
    throw new RecurrenceError(`UNTIL is not a real date: "${value}"`);
  }

  return instant;
};

const formatUntil = (instant: Date): string =>
  `${instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;

const parsePositiveInteger = (name: string, value: string): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new RecurrenceError(`${name} must be a whole number of 1 or more, not "${value}"`);
  }

  return parsed;
};

/**
 * Reads a rule string. Unknown parts are refused rather than ignored, so a rule
 * this code cannot honour is never stored as if it could be.
 */
export const parseRecurrenceRule = (input: string): RecurrenceRule => {
  const text = input.trim().replace(/^RRULE:/i, '');

  if (text.length === 0) {
    throw new RecurrenceError('A recurrence rule cannot be empty');
  }

  const rule: RecurrenceRule = {
    frequency: 'DAILY',
    interval: 1,
    byWeekday: [],
    byMonthDay: [],
    count: null,
    until: null,
  };

  let hasFrequency = false;

  for (const part of text.split(';')) {
    if (part.trim().length === 0) {
      continue;
    }

    const separator = part.indexOf('=');

    if (separator === -1) {
      throw new RecurrenceError(`"${part}" is not a NAME=VALUE pair`);
    }

    const name = part.slice(0, separator).trim().toUpperCase();
    const value = part.slice(separator + 1).trim();

    switch (name) {
      case 'FREQ': {
        const frequency = value.toUpperCase();

        if (!isFrequency(frequency)) {
          throw new RecurrenceError(
            `FREQ must be one of ${RECURRENCE_FREQUENCIES.join(', ')}, not "${value}"`,
          );
        }

        rule.frequency = frequency;
        hasFrequency = true;
        break;
      }

      case 'INTERVAL': {
        const interval = parsePositiveInteger('INTERVAL', value);

        if (interval > MAX_RECURRENCE_INTERVAL) {
          throw new RecurrenceError(`INTERVAL may not exceed ${MAX_RECURRENCE_INTERVAL}`);
        }

        rule.interval = interval;
        break;
      }

      case 'BYDAY': {
        const days = value
          .toUpperCase()
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);

        for (const day of days) {
          if (!isWeekday(day)) {
            // Ordinal forms such as `2MO` ("the second Monday") are part of the
            // standard but not of this subset, and are refused by name.
            throw new RecurrenceError(
              `BYDAY accepts ${RECURRENCE_WEEKDAYS.join(', ')}, not "${day}"`,
            );
          }

          if (!rule.byWeekday.includes(day)) {
            rule.byWeekday.push(day);
          }
        }

        break;
      }

      case 'BYMONTHDAY': {
        for (const entry of value.split(',')) {
          const dayOfMonth = Number(entry.trim());

          if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
            // Negative offsets ("-1", the last day) are standard but outside
            // this subset.
            throw new RecurrenceError(`BYMONTHDAY must be a day from 1 to 31, not "${entry}"`);
          }

          if (!rule.byMonthDay.includes(dayOfMonth)) {
            rule.byMonthDay.push(dayOfMonth);
          }
        }

        break;
      }

      case 'COUNT':
        rule.count = parsePositiveInteger('COUNT', value);
        break;

      case 'UNTIL':
        rule.until = parseUntil(value);
        break;

      case 'WKST':
        // The week always starts on Monday here; accepting any other value
        // would change what INTERVAL means for weekly rules.
        if (value.toUpperCase() !== 'MO') {
          throw new RecurrenceError('WKST must be MO');
        }

        break;

      default:
        throw new RecurrenceError(`"${name}" is not a supported recurrence part`);
    }
  }

  if (!hasFrequency) {
    throw new RecurrenceError('A recurrence rule must state FREQ');
  }

  if (rule.count !== null && rule.until !== null) {
    // RFC 5545 forbids both; keeping the rule out of that state means a
    // schedule always has exactly one way of ending.
    throw new RecurrenceError('A recurrence rule may set COUNT or UNTIL, not both');
  }

  if (rule.byWeekday.length > 0 && rule.frequency !== 'WEEKLY') {
    throw new RecurrenceError('BYDAY is only supported on weekly rules');
  }

  if (rule.byMonthDay.length > 0 && rule.frequency !== 'MONTHLY') {
    throw new RecurrenceError('BYMONTHDAY is only supported on monthly rules');
  }

  return rule;
};

/** The canonical string for a rule, which is what gets stored. */
export const formatRecurrenceRule = (rule: RecurrenceRule): string => {
  const parts = [`FREQ=${rule.frequency}`];

  if (rule.interval > 1) {
    parts.push(`INTERVAL=${rule.interval}`);
  }

  if (rule.byWeekday.length > 0) {
    const ordered = [...rule.byWeekday].sort(
      (left, right) => WEEKDAY_NUMBERS[left] - WEEKDAY_NUMBERS[right],
    );

    parts.push(`BYDAY=${ordered.join(',')}`);
  }

  if (rule.byMonthDay.length > 0) {
    parts.push(`BYMONTHDAY=${[...rule.byMonthDay].sort((left, right) => left - right).join(',')}`);
  }

  if (rule.count !== null) {
    parts.push(`COUNT=${rule.count}`);
  }

  if (rule.until !== null) {
    parts.push(`UNTIL=${formatUntil(rule.until)}`);
  }

  return parts.join(';');
};

export interface RecurrenceInput {
  frequency: RecurrenceFrequency;
  interval?: number | undefined;
  byWeekday?: readonly RecurrenceWeekday[] | undefined;
  byMonthDay?: readonly number[] | undefined;
  count?: number | null | undefined;
  until?: Date | null | undefined;
}

/**
 * Builds a rule string from structured fields. The assistant describes a
 * schedule this way rather than writing RRULE text, so a model that has never
 * read RFC 5545 cannot produce a rule that is subtly wrong.
 */
export const buildRecurrenceRule = (input: RecurrenceInput): string => {
  const parts = [`FREQ=${input.frequency}`];

  if (input.interval !== undefined && input.interval !== 1) {
    parts.push(`INTERVAL=${input.interval}`);
  }

  if (input.byWeekday && input.byWeekday.length > 0) {
    parts.push(`BYDAY=${input.byWeekday.join(',')}`);
  }

  if (input.byMonthDay && input.byMonthDay.length > 0) {
    parts.push(`BYMONTHDAY=${input.byMonthDay.join(',')}`);
  }

  if (input.count !== undefined && input.count !== null) {
    parts.push(`COUNT=${input.count}`);
  }

  if (input.until) {
    parts.push(`UNTIL=${formatUntil(input.until)}`);
  }

  // Round-tripped through the parser so an invalid combination is caught here,
  // where the caller can be told, rather than at delivery time.
  return formatRecurrenceRule(parseRecurrenceRule(parts.join(';')));
};

/** Whether one calendar day satisfies the rule, relative to the first one. */
const dayMatches = (rule: RecurrenceRule, anchorDay: CalendarDay, day: CalendarDay): boolean => {
  switch (rule.frequency) {
    case 'DAILY': {
      const elapsed = dayNumber(day) - dayNumber(anchorDay);

      return elapsed >= 0 && elapsed % rule.interval === 0;
    }

    case 'WEEKLY': {
      const wanted =
        rule.byWeekday.length > 0
          ? rule.byWeekday.map((code) => WEEKDAY_NUMBERS[code])
          : [weekdayOf(anchorDay)];

      if (!wanted.includes(weekdayOf(day))) {
        return false;
      }

      // Intervals count whole weeks from the anchor's week, so "every other
      // Monday" stays in phase regardless of which day the search starts on.
      const weeks = Math.round(
        (dayNumber(startOfIsoWeek(day)) - dayNumber(startOfIsoWeek(anchorDay))) / 7,
      );

      return weeks >= 0 && weeks % rule.interval === 0;
    }

    case 'MONTHLY': {
      const wanted = rule.byMonthDay.length > 0 ? rule.byMonthDay : [anchorDay.day];

      if (!wanted.includes(day.day)) {
        return false;
      }

      const months = monthsBetween(anchorDay, day);

      return months >= 0 && months % rule.interval === 0;
    }

    default:
      return false;
  }
};

export interface NextOccurrenceInput {
  rule: RecurrenceRule;
  /** IANA zone the wall-clock time is anchored to. */
  timeZone: string;
  /** The first occurrence: it fixes both the time of day and the interval phase. */
  anchor: Date;
  /** The result is strictly after this instant. */
  after: Date;
  /** Occurrences already delivered, checked against COUNT. */
  occurrences?: number;
}

/**
 * The next instant a rule fires after a given point, or `null` when the
 * schedule has ended.
 *
 * The search walks calendar days in the user's own zone and rebuilds the
 * anchor's wall-clock time on each candidate, rather than adding a fixed number
 * of milliseconds. That is the whole point: adding "seven days" across a
 * daylight-saving change moves a nine o'clock reminder to eight or ten, while
 * rebuilding 09:00 on the matching day keeps it at nine.
 *
 * A monthly rule on the 31st simply skips months that have no 31st, because
 * only real calendar days are ever considered.
 */
export const nextOccurrence = (input: NextOccurrenceInput): Date | null => {
  const { rule, timeZone, anchor, after } = input;
  const occurrences = input.occurrences ?? 0;

  if (rule.count !== null && occurrences >= rule.count) {
    return null;
  }

  if (rule.until && after.getTime() >= rule.until.getTime()) {
    return null;
  }

  const anchorParts = toZonedParts(anchor, timeZone);
  const anchorDay = { year: anchorParts.year, month: anchorParts.month, day: anchorParts.day };
  const searchStart = toCalendarDay(after, timeZone);

  for (let offset = 0; offset < MAX_SEARCH_DAYS; offset += 1) {
    const day = addCalendarDays(searchStart, offset);

    if (!isRealCalendarDay(day) || !dayMatches(rule, anchorDay, day)) {
      continue;
    }

    const instant = zonedPartsToInstant(
      {
        ...day,
        hour: anchorParts.hour,
        minute: anchorParts.minute,
        second: anchorParts.second,
      },
      timeZone,
    );

    // The first matching day can still be today, at an hour already past.
    if (instant.getTime() <= after.getTime()) {
      continue;
    }

    if (rule.until && instant.getTime() > rule.until.getTime()) {
      return null;
    }

    return instant;
  }

  return null;
};

/** A plain-language description, for a list a person reads. */
export const describeRecurrence = (rule: RecurrenceRule): string => {
  const every = rule.interval === 1 ? 'Every' : `Every ${rule.interval}`;
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month' }[rule.frequency];
  const base = rule.interval === 1 ? `${every} ${unit}` : `${every} ${unit}s`;

  const detail =
    rule.byWeekday.length > 0
      ? ` on ${rule.byWeekday.map((code) => WEEKDAY_LABELS[code]).join(', ')}`
      : rule.byMonthDay.length > 0
        ? ` on day ${rule.byMonthDay.join(', ')}`
        : '';

  const ending = rule.count
    ? `, ${rule.count} time${rule.count === 1 ? '' : 's'}`
    : rule.until
      ? `, until ${rule.until.toISOString().slice(0, 10)}`
      : '';

  return `${base}${detail}${ending}`;
};
