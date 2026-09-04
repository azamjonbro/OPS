import { describe, expect, it } from 'vitest';

import {
  addCalendarDays,
  DEFAULT_TIMEZONE,
  formatInTimeZone,
  getTimeZoneOffsetMs,
  isRealCalendarDay,
  isValidTimeZone,
  MS_PER_HOUR,
  parseLocalDateTime,
  parseWallTime,
  startOfIsoWeek,
  toZonedParts,
  weekdayOf,
  zonedPartsToInstant,
} from './timezone.js';

describe('zone validation', () => {
  it('accepts a real IANA zone and refuses anything else', () => {
    expect(isValidTimeZone(DEFAULT_TIMEZONE)).toBe(true);
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Asia/Tashkant')).toBe(false);
    expect(isValidTimeZone('GMT+5')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('offsets', () => {
  it('reads a fixed offset zone', () => {
    // Tashkent is UTC+5 all year; it has not observed daylight saving since 1991.
    const winter = getTimeZoneOffsetMs(new Date('2026-01-15T00:00:00Z'), DEFAULT_TIMEZONE);
    const summer = getTimeZoneOffsetMs(new Date('2026-07-15T00:00:00Z'), DEFAULT_TIMEZONE);

    expect(winter).toBe(5 * MS_PER_HOUR);
    expect(summer).toBe(5 * MS_PER_HOUR);
  });

  it('follows a daylight-saving change', () => {
    const winter = getTimeZoneOffsetMs(new Date('2026-01-15T12:00:00Z'), 'Europe/Berlin');
    const summer = getTimeZoneOffsetMs(new Date('2026-07-15T12:00:00Z'), 'Europe/Berlin');

    expect(winter).toBe(1 * MS_PER_HOUR);
    expect(summer).toBe(2 * MS_PER_HOUR);
  });
});

describe('wall clock to instant', () => {
  it('reads a local time as the instant it names, not as UTC', () => {
    const instant = zonedPartsToInstant(
      { year: 2026, month: 9, day: 5, hour: 10, minute: 0, second: 0 },
      DEFAULT_TIMEZONE,
    );

    // 10:00 in Tashkent is 05:00 UTC — the whole point of storing both.
    expect(instant.toISOString()).toBe('2026-09-05T05:00:00.000Z');
  });

  it('round-trips through the zone it was built in', () => {
    const parts = { year: 2026, month: 3, day: 1, hour: 23, minute: 45, second: 0 };
    const instant = zonedPartsToInstant(parts, 'America/New_York');

    expect(toZonedParts(instant, 'America/New_York')).toMatchObject(parts);
  });

  it('keeps a wall-clock hour across a daylight-saving change', () => {
    const before = zonedPartsToInstant(
      { year: 2026, month: 3, day: 1, hour: 9, minute: 0, second: 0 },
      'Europe/Berlin',
    );
    const after = zonedPartsToInstant(
      { year: 2026, month: 4, day: 1, hour: 9, minute: 0, second: 0 },
      'Europe/Berlin',
    );

    // Both read 09:00 locally even though the UTC hour differs by one.
    expect(before.toISOString()).toBe('2026-03-01T08:00:00.000Z');
    expect(after.toISOString()).toBe('2026-04-01T07:00:00.000Z');
  });

  it('resolves a clock time that the spring-forward jump skipped', () => {
    // Berlin jumps 02:00 -> 03:00 on 29 March 2026, so 02:30 never happens.
    const instant = zonedPartsToInstant(
      { year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0 },
      'Europe/Berlin',
    );

    // It resolves just past the jump rather than throwing or landing a day out.
    expect(toZonedParts(instant, 'Europe/Berlin')).toMatchObject({
      year: 2026,
      month: 3,
      day: 29,
      hour: 3,
      minute: 30,
    });
  });
});

describe('calendar arithmetic', () => {
  it('counts ISO weekdays with Monday first', () => {
    expect(weekdayOf({ year: 2026, month: 9, day: 7 })).toBe(1);
    expect(weekdayOf({ year: 2026, month: 9, day: 13 })).toBe(7);
  });

  it('walks days across a month and a year boundary', () => {
    expect(addCalendarDays({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 1,
    });
    expect(addCalendarDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
  });

  it('finds the Monday of a week', () => {
    expect(startOfIsoWeek({ year: 2026, month: 9, day: 13 })).toEqual({
      year: 2026,
      month: 9,
      day: 7,
    });
  });

  it('rejects a day that does not exist', () => {
    expect(isRealCalendarDay({ year: 2026, month: 2, day: 29 })).toBe(false);
    expect(isRealCalendarDay({ year: 2028, month: 2, day: 29 })).toBe(true);
  });
});

describe('parsing', () => {
  it('reads a local date and time', () => {
    expect(parseLocalDateTime('2026-09-05T10:30')).toEqual({
      day: { year: 2026, month: 9, day: 5 },
      time: { hour: 10, minute: 30, second: 0 },
    });
  });

  it('reports a bare date as having no time, rather than defaulting to midnight', () => {
    expect(parseLocalDateTime('2026-09-05')).toEqual({
      day: { year: 2026, month: 9, day: 5 },
      time: null,
    });
  });

  it('refuses an impossible date or time', () => {
    expect(parseLocalDateTime('2026-02-30T10:00')).toBeNull();
    expect(parseLocalDateTime('2026-09-05T25:00')).toBeNull();
    expect(parseLocalDateTime('tomorrow at ten')).toBeNull();
  });

  it('reads a stored preference time', () => {
    expect(parseWallTime('19:00')).toEqual({ hour: 19, minute: 0, second: 0 });
    expect(parseWallTime('9:05')).toEqual({ hour: 9, minute: 5, second: 0 });
    expect(parseWallTime('evening')).toBeNull();
  });
});

describe('display', () => {
  it('shows the instant as its owner set it, with the offset', () => {
    expect(formatInTimeZone(new Date('2026-09-05T05:00:00Z'), DEFAULT_TIMEZONE)).toBe(
      '2026-09-05 10:00 (+05:00)',
    );
  });

  it('shows a negative offset', () => {
    expect(formatInTimeZone(new Date('2026-01-15T17:00:00Z'), 'America/New_York')).toBe(
      '2026-01-15 12:00 (-05:00)',
    );
  });
});
