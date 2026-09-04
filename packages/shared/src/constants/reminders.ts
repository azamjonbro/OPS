/**
 * A reminder's lifecycle.
 *
 * `scheduled` is the only state the scheduler acts on. `sent` is terminal for a
 * one-off; a repeating reminder goes back to `scheduled` with its next
 * occurrence instead, so a single record carries the whole series. `failed`
 * means delivery was retried to exhaustion and gave up — it is kept, rather
 * than deleted, because a reminder that never arrived is exactly the thing a
 * person needs to be able to see.
 */
export const REMINDER_STATUSES = ['scheduled', 'sent', 'cancelled', 'failed'] as const;

export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

/** States that still have a future: everything the scheduler will look at. */
export const ACTIVE_REMINDER_STATUSES: readonly ReminderStatus[] = ['scheduled'];

export const REMINDER_TITLE_MAX_LENGTH = 160;
export const REMINDER_DESCRIPTION_MAX_LENGTH = 2_000;

/**
 * How far ahead a reminder may be set. A bound exists so a mistyped year cannot
 * park a job in the queue for a century.
 */
export const REMINDER_MAX_LEAD_DAYS = 366 * 3;

/** Relative reminders ("in two hours") are capped by the same horizon. */
export const REMINDER_MAX_LEAD_MINUTES = REMINDER_MAX_LEAD_DAYS * 24 * 60;

/**
 * A reminder may be created for a moment that has just passed — a few seconds
 * of clock skew, or the time it took to type the sentence — and it fires at
 * once. Anything older than this is a mistake worth reporting.
 */
export const REMINDER_PAST_TOLERANCE_MS = 60_000;

/** Attempts before a delivery is declared failed, the first one included. */
export const REMINDER_DELIVERY_MAX_ATTEMPTS = 3;

/**
 * Named parts of the day the assistant may be asked about ("bugun kechqurun").
 * None of them has an inherent hour: each is resolved from a stored preference,
 * and where there is none the user is asked rather than guessed at.
 */
export const PART_OF_DAY_NAMES = ['morning', 'afternoon', 'evening', 'night'] as const;

export type PartOfDay = (typeof PART_OF_DAY_NAMES)[number];

/** Memory key holding a person's own hour for a part of the day. */
export const partOfDayMemoryKey = (part: PartOfDay): string => `${part}_reminder_time`;

/** Memory key holding a person's IANA time zone, when they have stated one. */
export const TIMEZONE_MEMORY_KEY = 'timezone';
