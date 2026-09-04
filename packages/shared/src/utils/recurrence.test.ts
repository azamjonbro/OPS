import { describe, expect, it } from 'vitest';

import {
  buildRecurrenceRule,
  describeRecurrence,
  formatRecurrenceRule,
  nextOccurrence,
  parseRecurrenceRule,
  RecurrenceError,
} from './recurrence.js';
import { DEFAULT_TIMEZONE } from './timezone.js';

const TASHKENT = DEFAULT_TIMEZONE;

/** 10:00 on Monday 7 September 2026, Tashkent — 05:00 UTC. */
const anchor = new Date('2026-09-07T05:00:00Z');

const next = (rule: string, after: Date, timeZone = TASHKENT, occurrences = 0): string | null => {
  const result = nextOccurrence({
    rule: parseRecurrenceRule(rule),
    timeZone,
    anchor,
    after,
    occurrences,
  });

  return result ? result.toISOString() : null;
};

describe('parsing', () => {
  it('reads a standard rule', () => {
    expect(parseRecurrenceRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')).toEqual({
      frequency: 'WEEKLY',
      interval: 2,
      byWeekday: ['MO', 'WE'],
      byMonthDay: [],
      count: null,
      until: null,
    });
  });

  it('accepts the RRULE: prefix an iCalendar line carries', () => {
    expect(parseRecurrenceRule('RRULE:FREQ=DAILY').frequency).toBe('DAILY');
  });

  it('reads COUNT and UNTIL', () => {
    expect(parseRecurrenceRule('FREQ=DAILY;COUNT=3').count).toBe(3);
    expect(parseRecurrenceRule('FREQ=DAILY;UNTIL=20261001T050000Z').until?.toISOString()).toBe(
      '2026-10-01T05:00:00.000Z',
    );
  });

  it('refuses a rule it cannot honour rather than ignoring the part it missed', () => {
    expect(() => parseRecurrenceRule('FREQ=YEARLY')).toThrow(RecurrenceError);
    expect(() => parseRecurrenceRule('FREQ=WEEKLY;BYDAY=2MO')).toThrow(/BYDAY accepts/);
    expect(() => parseRecurrenceRule('FREQ=WEEKLY;BYSETPOS=1')).toThrow(/not a supported/);
    expect(() => parseRecurrenceRule('FREQ=DAILY;INTERVAL=0')).toThrow(/1 or more/);
    expect(() => parseRecurrenceRule('FREQ=DAILY;COUNT=2;UNTIL=20261001T050000Z')).toThrow(
      /COUNT or UNTIL/,
    );
    expect(() => parseRecurrenceRule('FREQ=DAILY;BYDAY=MO')).toThrow(/only supported on weekly/);
    expect(() => parseRecurrenceRule('FREQ=WEEKLY;BYMONTHDAY=1')).toThrow(
      /only supported on monthly/,
    );
    expect(() => parseRecurrenceRule('INTERVAL=2')).toThrow(/must state FREQ/);
    expect(() => parseRecurrenceRule('')).toThrow(/cannot be empty/);
  });

  it('round-trips to a canonical string', () => {
    expect(formatRecurrenceRule(parseRecurrenceRule('FREQ=WEEKLY;BYDAY=WE,MO;INTERVAL=1'))).toBe(
      'FREQ=WEEKLY;BYDAY=MO,WE',
    );
  });

  it('builds a rule from structured fields and validates it on the way', () => {
    expect(buildRecurrenceRule({ frequency: 'WEEKLY', byWeekday: ['MO'] })).toBe(
      'FREQ=WEEKLY;BYDAY=MO',
    );
    expect(buildRecurrenceRule({ frequency: 'MONTHLY', interval: 3, byMonthDay: [15] })).toBe(
      'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15',
    );
    expect(() => buildRecurrenceRule({ frequency: 'DAILY', byWeekday: ['MO'] })).toThrow(
      RecurrenceError,
    );
  });
});

describe('daily rules', () => {
  it('fires at the same wall-clock time the next day', () => {
    expect(next('FREQ=DAILY', anchor)).toBe('2026-09-08T05:00:00.000Z');
  });

  it('honours an interval', () => {
    expect(next('FREQ=DAILY;INTERVAL=3', anchor)).toBe('2026-09-10T05:00:00.000Z');
  });

  it('stays in phase when the search resumes from a day that does not match', () => {
    // Two days after the anchor is not an occurrence of an every-three-days rule.
    expect(next('FREQ=DAILY;INTERVAL=3', new Date('2026-09-09T05:00:00Z'))).toBe(
      '2026-09-10T05:00:00.000Z',
    );
  });
});

describe('weekly rules', () => {
  it('repeats on the anchor weekday when none is named', () => {
    expect(next('FREQ=WEEKLY', anchor)).toBe('2026-09-14T05:00:00.000Z');
  });

  it('fires on each named weekday', () => {
    const rule = 'FREQ=WEEKLY;BYDAY=MO,TH';

    // Monday the 7th -> Thursday the 10th -> Monday the 14th.
    expect(next(rule, anchor)).toBe('2026-09-10T05:00:00.000Z');
    expect(next(rule, new Date('2026-09-10T05:00:00Z'))).toBe('2026-09-14T05:00:00.000Z');
  });

  it('keeps an every-other-week rule in the anchor week phase', () => {
    const rule = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO';

    expect(next(rule, anchor)).toBe('2026-09-21T05:00:00.000Z');
    // Asking from inside the skipped week still lands on the same Monday.
    expect(next(rule, new Date('2026-09-15T05:00:00Z'))).toBe('2026-09-21T05:00:00.000Z');
  });
});

describe('monthly rules', () => {
  it('repeats on the anchor day of the month', () => {
    expect(next('FREQ=MONTHLY', anchor)).toBe('2026-10-07T05:00:00.000Z');
  });

  it('skips a month that has no such day rather than rolling into the next one', () => {
    const lastDay = new Date('2026-01-31T05:00:00Z');
    const result = nextOccurrence({
      rule: parseRecurrenceRule('FREQ=MONTHLY'),
      timeZone: TASHKENT,
      anchor: lastDay,
      after: lastDay,
    });

    // February has no 31st, so the next occurrence is in March — never 3 March.
    expect(result?.toISOString()).toBe('2026-03-31T05:00:00.000Z');
  });

  it('honours BYMONTHDAY', () => {
    expect(next('FREQ=MONTHLY;BYMONTHDAY=1,15', anchor)).toBe('2026-09-15T05:00:00.000Z');
  });
});

describe('endings', () => {
  it('stops once COUNT occurrences have happened', () => {
    expect(next('FREQ=DAILY;COUNT=3', anchor, TASHKENT, 2)).toBe('2026-09-08T05:00:00.000Z');
    expect(next('FREQ=DAILY;COUNT=3', anchor, TASHKENT, 3)).toBeNull();
  });

  it('stops after UNTIL', () => {
    const rule = 'FREQ=DAILY;UNTIL=20260908T060000Z';

    expect(next(rule, anchor)).toBe('2026-09-08T05:00:00.000Z');
    expect(next(rule, new Date('2026-09-08T05:00:00Z'))).toBeNull();
  });
});

describe('daylight saving', () => {
  it('holds a weekly reminder at the same local hour across the spring change', () => {
    // 09:00 Berlin on Monday 23 March 2026, a week before the clocks go forward.
    const berlinAnchor = new Date('2026-03-23T08:00:00Z');
    const result = nextOccurrence({
      rule: parseRecurrenceRule('FREQ=WEEKLY;BYDAY=MO'),
      timeZone: 'Europe/Berlin',
      anchor: berlinAnchor,
      after: berlinAnchor,
    });

    // Still 09:00 locally, which is now 07:00 UTC rather than 08:00. Adding
    // seven fixed days would have produced 10:00 local.
    expect(result?.toISOString()).toBe('2026-03-30T07:00:00.000Z');
  });
});

describe('descriptions', () => {
  it('renders a rule in plain language', () => {
    expect(describeRecurrence(parseRecurrenceRule('FREQ=WEEKLY;BYDAY=MO'))).toBe(
      'Every week on Monday',
    );
    expect(describeRecurrence(parseRecurrenceRule('FREQ=DAILY;INTERVAL=2'))).toBe('Every 2 days');
    expect(describeRecurrence(parseRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=1;COUNT=4'))).toBe(
      'Every month on day 1, 4 times',
    );
  });
});
