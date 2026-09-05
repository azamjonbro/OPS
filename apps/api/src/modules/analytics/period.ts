import {
  addCalendarDays,
  dayNumber,
  startOfIsoWeek,
  toCalendarDay,
  type AnalyticsPeriod,
  type AnalyticsPeriodKey,
  type CalendarDay,
} from '@hadiya/shared';

import { ApiError } from '../../core/http/api-error.js';

/**
 * Turning "last month" into two dates, in the right zone.
 *
 * Every boundary here is a *wall-clock* boundary in the actor's own zone. That
 * is not a nicety: a shop in Tashkent closing at 22:00 has its whole evening
 * counted into the following day if the day is cut at UTC midnight, which is
 * five hours early. Yesterday's takings would be wrong every single day, and
 * nothing about the number would look wrong.
 *
 * The zone comes from the authenticated actor, never from an argument the model
 * wrote, so a question cannot be phrased in a way that shifts the books.
 */

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

/** `YYYY-MM-DD`, the form Billz's order search is queried with. */
export const formatCalendarDay = (day: CalendarDay): string =>
  `${pad(day.year, 4)}-${pad(day.month)}-${pad(day.day)}`;

const parseCalendarDay = (value: string): CalendarDay | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const day = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const rebuilt = new Date(Date.UTC(day.year, day.month - 1, day.day));

  // Rejects 31 February, which `Date` would silently roll into March.
  return rebuilt.getUTCMonth() + 1 === day.month && rebuilt.getUTCDate() === day.day ? day : null;
};

const startOfMonth = (day: CalendarDay): CalendarDay => ({ ...day, day: 1 });

const startOfQuarter = (day: CalendarDay): CalendarDay => ({
  year: day.year,
  month: Math.floor((day.month - 1) / 3) * 3 + 1,
  day: 1,
});

const addMonths = (day: CalendarDay, months: number): CalendarDay => {
  const zeroBased = day.year * 12 + (day.month - 1) + months;

  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1, day: 1 };
};

/** The day before a window starts — used to end the window that precedes it. */
const previousDay = (day: CalendarDay): CalendarDay => addCalendarDays(day, -1);

export interface ResolvedRange {
  start: CalendarDay;
  end: CalendarDay;
  label: string;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const labelFor = (key: AnalyticsPeriodKey, start: CalendarDay, end: CalendarDay): string => {
  if (key === 'custom') {
    return formatCalendarDay(start) === formatCalendarDay(end)
      ? formatCalendarDay(start)
      : `${formatCalendarDay(start)} → ${formatCalendarDay(end)}`;
  }

  if (key === 'this_month' || key === 'last_month') {
    return `${MONTH_NAMES[start.month - 1]} ${start.year}`;
  }

  if (key === 'this_year' || key === 'last_year') {
    return String(start.year);
  }

  return key.replace(/_/g, ' ');
};

/**
 * Resolves a period key against "now" as the actor's clock reads it.
 *
 * `today` is the current local day; every "this ..." window ends today rather
 * than at the end of the calendar unit, because a person asking about this
 * month on the 8th means the eight days that have happened. Comparing that to a
 * whole previous month would be comparing eight days to thirty-one, which is
 * the single easiest way to make an analytics feature lie — so `previousPeriod`
 * below matches the length rather than the calendar unit.
 */
export const resolvePeriod = (options: {
  key: AnalyticsPeriodKey;
  timezone: string;
  now?: Date;
  from?: string | undefined;
  to?: string | undefined;
}): AnalyticsPeriod => {
  const now = options.now ?? new Date();
  const today = toCalendarDay(now, options.timezone);

  const range = ((): ResolvedRange => {
    switch (options.key) {
      case 'today':
        return { start: today, end: today, label: 'today' };

      case 'yesterday': {
        const day = previousDay(today);

        return { start: day, end: day, label: 'yesterday' };
      }

      case 'this_week':
        return { start: startOfIsoWeek(today), end: today, label: 'this week' };

      case 'last_week': {
        const start = addCalendarDays(startOfIsoWeek(today), -7);

        return { start, end: addCalendarDays(start, 6), label: 'last week' };
      }

      case 'this_month':
        return { start: startOfMonth(today), end: today, label: 'this month' };

      case 'last_month': {
        const start = addMonths(startOfMonth(today), -1);

        return { start, end: previousDay(startOfMonth(today)), label: 'last month' };
      }

      case 'this_quarter':
        return { start: startOfQuarter(today), end: today, label: 'this quarter' };

      case 'last_quarter': {
        const currentQuarter = startOfQuarter(today);
        const start = addMonths(currentQuarter, -3);

        return { start, end: previousDay(currentQuarter), label: 'last quarter' };
      }

      case 'this_year':
        return { start: { year: today.year, month: 1, day: 1 }, end: today, label: 'this year' };

      case 'last_year':
        return {
          start: { year: today.year - 1, month: 1, day: 1 },
          end: { year: today.year - 1, month: 12, day: 31 },
          label: 'last year',
        };

      case 'custom': {
        const start = options.from ? parseCalendarDay(options.from) : null;
        const end = options.to ? parseCalendarDay(options.to) : null;

        if (!start || !end) {
          throw ApiError.badRequest(
            'A custom period needs a valid from and to date, as YYYY-MM-DD.',
          );
        }

        if (dayNumber(end) < dayNumber(start)) {
          throw ApiError.badRequest('The custom period ends before it starts.');
        }

        return { start, end, label: '' };
      }
    }
  })();

  const days = dayNumber(range.end) - dayNumber(range.start) + 1;

  return {
    key: options.key,
    from: formatCalendarDay(range.start),
    to: formatCalendarDay(range.end),
    timezone: options.timezone,
    days,
    label: range.label || labelFor(options.key, range.start, range.end),
  };
};

/**
 * The window immediately before this one, of the same length.
 *
 * Length rather than calendar unit, deliberately. Eight days into September,
 * "this month vs last month" compares 1–8 September with 1–8 August, not with
 * the whole of August: a partial month measured against a complete one always
 * looks like collapse, and an analytics layer that reports that every month is
 * an analytics layer nobody reads twice.
 *
 * For a period that has already ended — `last_month`, `yesterday` — the two are
 * the same thing anyway, because the window is already complete.
 */
export const previousPeriod = (period: AnalyticsPeriod): AnalyticsPeriod => {
  const start = parseCalendarDay(period.from);
  const end = parseCalendarDay(period.to);

  if (!start || !end) {
    throw ApiError.badRequest('That period could not be read.');
  }

  const previousEnd = previousDay(start);
  const previousStart = addCalendarDays(previousEnd, -(period.days - 1));

  return {
    key: 'custom',
    from: formatCalendarDay(previousStart),
    to: formatCalendarDay(previousEnd),
    timezone: period.timezone,
    days: period.days,
    label: `the ${period.days} day(s) before ${period.label}`,
  };
};

/** The same window one year earlier, for a seasonal comparison. */
export const samePeriodLastYear = (period: AnalyticsPeriod): AnalyticsPeriod => {
  const start = parseCalendarDay(period.from);
  const end = parseCalendarDay(period.to);

  if (!start || !end) {
    throw ApiError.badRequest('That period could not be read.');
  }

  return {
    key: 'custom',
    from: formatCalendarDay({ ...start, year: start.year - 1 }),
    to: formatCalendarDay({ ...end, year: end.year - 1 }),
    timezone: period.timezone,
    days: period.days,
    label: `${period.label}, last year`,
  };
};

/** Every calendar day in a window, so a series can include the empty ones. */
export const daysInPeriod = (period: AnalyticsPeriod): string[] => {
  const start = parseCalendarDay(period.from);

  if (!start) {
    return [];
  }

  return Array.from({ length: period.days }, (_unused, index) =>
    formatCalendarDay(addCalendarDays(start, index)),
  );
};
