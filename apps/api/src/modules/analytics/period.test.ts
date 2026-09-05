import { describe, expect, it } from 'vitest';

import { ApiError } from '../../core/http/api-error.js';
import { daysInPeriod, previousPeriod, resolvePeriod, samePeriodLastYear } from './period.js';

/**
 * Boundaries, in the zone the shop actually lives in.
 *
 * The timezone cases below are the ones that would otherwise be wrong every
 * single day without anything looking wrong: Tashkent runs five hours ahead of
 * UTC, so an evening sale falls on the following UTC day. A report cut at UTC
 * midnight would move every late sale into tomorrow, for ever.
 */
const TASHKENT = 'Asia/Tashkent';

describe('resolving a period in the actor’s zone', () => {
  it('reads today from the local wall clock, not from UTC', () => {
    // 20:30 UTC on the 5th is 01:30 on the 6th in Tashkent: already tomorrow.
    const now = new Date('2026-09-05T20:30:00Z');
    const period = resolvePeriod({ key: 'today', timezone: TASHKENT, now });

    expect(period.from).toBe('2026-09-06');
    expect(period.to).toBe('2026-09-06');
    expect(period.days).toBe(1);
  });

  it('reads the same instant as the previous day in UTC', () => {
    const now = new Date('2026-09-05T20:30:00Z');

    expect(resolvePeriod({ key: 'today', timezone: 'UTC', now }).from).toBe('2026-09-05');
  });

  it('resolves yesterday against the local day', () => {
    const now = new Date('2026-09-06T04:00:00Z');
    const period = resolvePeriod({ key: 'yesterday', timezone: TASHKENT, now });

    expect(period.from).toBe('2026-09-05');
    expect(period.to).toBe('2026-09-05');
  });

  it('starts the week on Monday and ends it today', () => {
    // 2026-09-06 is a Sunday; the ISO week began on Monday the 31st of August.
    const now = new Date('2026-09-06T09:00:00Z');
    const period = resolvePeriod({ key: 'this_week', timezone: TASHKENT, now });

    expect(period.from).toBe('2026-08-31');
    expect(period.to).toBe('2026-09-06');
    expect(period.days).toBe(7);
  });

  it('returns the whole of last week, not a partial one', () => {
    const now = new Date('2026-09-06T09:00:00Z');
    const period = resolvePeriod({ key: 'last_week', timezone: TASHKENT, now });

    expect(period.from).toBe('2026-08-24');
    expect(period.to).toBe('2026-08-30');
    expect(period.days).toBe(7);
  });

  it('ends this month today rather than at the end of the calendar month', () => {
    const now = new Date('2026-09-06T09:00:00Z');
    const period = resolvePeriod({ key: 'this_month', timezone: TASHKENT, now });

    expect(period.from).toBe('2026-09-01');
    expect(period.to).toBe('2026-09-06');
    expect(period.days).toBe(6);
  });

  it('returns a complete previous month', () => {
    const now = new Date('2026-09-06T09:00:00Z');
    const period = resolvePeriod({ key: 'last_month', timezone: TASHKENT, now });

    expect(period.from).toBe('2026-08-01');
    expect(period.to).toBe('2026-08-31');
    expect(period.days).toBe(31);
  });

  it('handles the quarter boundaries', () => {
    const now = new Date('2026-09-06T09:00:00Z');

    expect(resolvePeriod({ key: 'this_quarter', timezone: TASHKENT, now }).from).toBe('2026-07-01');

    const last = resolvePeriod({ key: 'last_quarter', timezone: TASHKENT, now });

    expect(last.from).toBe('2026-04-01');
    expect(last.to).toBe('2026-06-30');
  });

  it('handles the year boundaries', () => {
    const now = new Date('2026-09-06T09:00:00Z');

    expect(resolvePeriod({ key: 'this_year', timezone: TASHKENT, now }).from).toBe('2026-01-01');

    const last = resolvePeriod({ key: 'last_year', timezone: TASHKENT, now });

    expect(last.from).toBe('2025-01-01');
    expect(last.to).toBe('2025-12-31');
  });

  it('accepts a custom range', () => {
    const period = resolvePeriod({
      key: 'custom',
      timezone: TASHKENT,
      from: '2026-03-01',
      to: '2026-03-10',
    });

    expect(period.days).toBe(10);
  });

  it('refuses a custom range with no dates', () => {
    expect(() => resolvePeriod({ key: 'custom', timezone: TASHKENT })).toThrow(ApiError);
  });

  it('refuses a range that ends before it starts', () => {
    expect(() =>
      resolvePeriod({ key: 'custom', timezone: TASHKENT, from: '2026-03-10', to: '2026-03-01' }),
    ).toThrow(/ends before it starts/i);
  });

  it('refuses a date that does not exist', () => {
    expect(() =>
      resolvePeriod({ key: 'custom', timezone: TASHKENT, from: '2026-02-31', to: '2026-03-01' }),
    ).toThrow(ApiError);
  });
});

describe('the comparison window', () => {
  it('matches the length of a partial period rather than the calendar unit', () => {
    const now = new Date('2026-09-08T09:00:00Z');
    const period = resolvePeriod({ key: 'this_month', timezone: TASHKENT, now });
    const comparison = previousPeriod(period);

    // Eight days into September, the honest comparison is 24–31 August, not
    // the whole of August: a partial month measured against a complete one
    // always looks like collapse.
    expect(period.days).toBe(8);
    expect(comparison.days).toBe(8);
    expect(comparison.from).toBe('2026-08-24');
    expect(comparison.to).toBe('2026-08-31');
  });

  it('is simply the day before, for a single day', () => {
    const now = new Date('2026-09-06T09:00:00Z');
    const comparison = previousPeriod(resolvePeriod({ key: 'today', timezone: TASHKENT, now }));

    expect(comparison.from).toBe('2026-09-05');
    expect(comparison.to).toBe('2026-09-05');
  });

  it('offers the same window a year earlier for a seasonal comparison', () => {
    const now = new Date('2026-09-06T09:00:00Z');
    const lastYear = samePeriodLastYear(
      resolvePeriod({ key: 'this_month', timezone: TASHKENT, now }),
    );

    expect(lastYear.from).toBe('2025-09-01');
    expect(lastYear.to).toBe('2025-09-06');
  });
});

describe('enumerating a period', () => {
  it('lists every day, so an empty one can still appear in a series', () => {
    const period = resolvePeriod({
      key: 'custom',
      timezone: TASHKENT,
      from: '2026-02-27',
      to: '2026-03-02',
    });

    expect(daysInPeriod(period)).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });
});
