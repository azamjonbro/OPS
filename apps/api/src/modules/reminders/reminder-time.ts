import {
  DEFAULT_TIMEZONE,
  formatInTimeZone,
  isValidTimeZone,
  parseLocalDateTime,
  parseWallTime,
  partOfDayMemoryKey,
  toCalendarDay,
  PART_OF_DAY_NAMES,
  REMINDER_MAX_LEAD_MINUTES,
  REMINDER_MAX_LEAD_DAYS,
  REMINDER_PAST_TOLERANCE_MS,
  zonedPartsToInstant,
  type AuthenticatedUser,
  type PartOfDay,
} from '@hadiya/shared';

import * as memoryService from '../memory/memory.service.js';

/**
 * Turning what somebody said into an instant.
 *
 * This is the part of a reminder system that quietly goes wrong. "Ertaga soat
 * 10 da" is a wall clock in the speaker's own zone, five hours away from the
 * same digits in UTC; "bugun kechqurun" is not a time at all until somebody
 * says what evening means to them. So the resolver does two things and refuses
 * to do a third: it converts a stated wall clock in a known zone, it looks up a
 * named part of the day in what the person has already told us, and it declines
 * to guess. An unresolvable time comes back as a question, not as a default —
 * a reminder that fires at the wrong hour is worse than one that was never set,
 * because the person believed it was handled.
 */

export type TimeResolution =
  | { ok: true; instant: Date; timezone: string }
  /** The request was understood but under-specified; ask this and try again. */
  | { ok: false; kind: 'ambiguous'; question: string }
  /** The request cannot be honoured as stated. */
  | { ok: false; kind: 'invalid'; message: string };

export interface TimeRequest {
  /**
   * A wall clock in the user's zone (`2026-09-05T10:00`), or an absolute
   * instant when it carries a zone designator (`...Z`, `+05:00`).
   */
  scheduledAt?: string | undefined;
  /** Relative offset: "in two hours". */
  inMinutes?: number | undefined;
  /** A named part of the day, resolved from what the user has told us. */
  partOfDay?: PartOfDay | undefined;
  /** `YYYY-MM-DD` the part of the day belongs to; defaults to today. */
  date?: string | undefined;
  /** Overrides the user's own zone, for a reminder set in another one. */
  timezone?: string | undefined;
}

/** An ISO-8601 string that names its own offset, rather than a bare wall clock. */
const ABSOLUTE_INSTANT = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export const resolveTimezone = (
  actor: AuthenticatedUser,
  requested?: string | null,
): { ok: true; timezone: string } | { ok: false; message: string } => {
  const candidate = requested?.trim();

  if (candidate) {
    return isValidTimeZone(candidate)
      ? { ok: true, timezone: candidate }
      : {
          ok: false,
          message: `"${candidate}" is not a time zone I know. Use an IANA name such as Asia/Tashkent.`,
        };
  }

  // A stored zone can only have come through this same validation, but an
  // account seeded before the field existed would still fall through to the
  // default rather than scheduling against a name nothing can resolve.
  return {
    ok: true,
    timezone: actor.timezone && isValidTimeZone(actor.timezone) ? actor.timezone : DEFAULT_TIMEZONE,
  };
};

/**
 * What this person means by "evening".
 *
 * The answer lives in their memory (Phase 5), set either by them or by the
 * assistant with their confirmation. Nothing is assumed on their behalf: an
 * unanswered "evening" is a question, not 18:00.
 */
export const resolvePartOfDay = async (
  actor: AuthenticatedUser,
  part: PartOfDay,
): Promise<{ hour: number; minute: number; second: number } | null> => {
  const memory = await memoryService.findByKey(actor, 'preference', partOfDayMemoryKey(part));

  if (!memory || memory.status !== 'active') {
    return null;
  }

  return parseWallTime(memory.value);
};

const askForATime = (part: PartOfDay): TimeResolution => ({
  ok: false,
  kind: 'ambiguous',
  question: `What time counts as ${part} for you? Give me an exact time such as 19:00, and I can also remember it for next time.`,
});

/**
 * Resolves one request, or explains why it cannot be.
 *
 * `now` is injected rather than read from the clock so the behaviour is
 * testable at a fixed instant.
 */
export const resolveReminderTime = async (
  actor: AuthenticatedUser,
  request: TimeRequest,
  now: Date = new Date(),
): Promise<TimeResolution> => {
  const zone = resolveTimezone(actor, request.timezone);

  if (!zone.ok) {
    return { ok: false, kind: 'invalid', message: zone.message };
  }

  const { timezone } = zone;
  const instant = await resolveInstant(actor, request, timezone, now);

  if (!instant.ok) {
    return instant;
  }

  return checkHorizon(instant.instant, timezone, now);
};

const resolveInstant = async (
  actor: AuthenticatedUser,
  request: TimeRequest,
  timezone: string,
  now: Date,
): Promise<TimeResolution> => {
  if (request.inMinutes !== undefined) {
    if (!Number.isFinite(request.inMinutes) || request.inMinutes <= 0) {
      return { ok: false, kind: 'invalid', message: 'A relative reminder must be in the future.' };
    }

    if (request.inMinutes > REMINDER_MAX_LEAD_MINUTES) {
      return {
        ok: false,
        kind: 'invalid',
        message: `A reminder cannot be set more than ${REMINDER_MAX_LEAD_DAYS} days ahead.`,
      };
    }

    return { ok: true, instant: new Date(now.getTime() + request.inMinutes * 60_000), timezone };
  }

  if (request.partOfDay) {
    const time = await resolvePartOfDay(actor, request.partOfDay);

    if (!time) {
      return askForATime(request.partOfDay);
    }

    const day = request.date ? parseLocalDateTime(request.date) : null;

    if (request.date && (!day || day.time !== null)) {
      return { ok: false, kind: 'invalid', message: `"${request.date}" is not a date I can read.` };
    }

    // No date given means today, read in the user's own zone rather than the
    // server's — the two are not always the same day.
    const target = day?.day ?? toCalendarDay(now, timezone);

    return { ok: true, instant: zonedPartsToInstant({ ...target, ...time }, timezone), timezone };
  }

  if (!request.scheduledAt) {
    return {
      ok: false,
      kind: 'ambiguous',
      question: 'When should I remind you? Give me a date and a time, or say how long from now.',
    };
  }

  const text = request.scheduledAt.trim();

  if (ABSOLUTE_INSTANT.test(text)) {
    // Already an instant; the zone is only used for display from here on.
    const parsed = new Date(text);

    return Number.isNaN(parsed.getTime())
      ? { ok: false, kind: 'invalid', message: `"${text}" is not a timestamp I can read.` }
      : { ok: true, instant: parsed, timezone };
  }

  const local = parseLocalDateTime(text);

  if (!local) {
    return {
      ok: false,
      kind: 'invalid',
      message: `"${text}" is not a date and time I can read. Use YYYY-MM-DDTHH:mm.`,
    };
  }

  if (local.time === null) {
    // A date with no hour. Midnight would be a guess, and the wrong one.
    return {
      ok: false,
      kind: 'ambiguous',
      question: `What time on ${text} should I remind you? Give me an exact time, such as 10:00.`,
    };
  }

  return {
    ok: true,
    instant: zonedPartsToInstant({ ...local.day, ...local.time }, timezone),
    timezone,
  };
};

const checkHorizon = (instant: Date, timezone: string, now: Date): TimeResolution => {
  const millisecondsAhead = instant.getTime() - now.getTime();

  if (millisecondsAhead < -REMINDER_PAST_TOLERANCE_MS) {
    return {
      ok: false,
      kind: 'invalid',
      message: `${formatInTimeZone(instant, timezone)} is in the past.`,
    };
  }

  if (millisecondsAhead > REMINDER_MAX_LEAD_DAYS * 86_400_000) {
    return {
      ok: false,
      kind: 'invalid',
      message: `A reminder cannot be set more than ${REMINDER_MAX_LEAD_DAYS} days ahead.`,
    };
  }

  return { ok: true, instant, timezone };
};

/** The names the assistant may use for a part of the day. */
export const isPartOfDay = (value: string): value is PartOfDay =>
  (PART_OF_DAY_NAMES as readonly string[]).includes(value);
