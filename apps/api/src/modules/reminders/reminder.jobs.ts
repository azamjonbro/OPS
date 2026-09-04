import { registerJobHandler, PermanentJobError } from '../../core/scheduler/index.js';
import { createLogger } from '../../core/logger/logger.js';
import { deliverOccurrence, markDeliveryFailed, REMINDER_JOB_TYPE } from './reminder.service.js';

const log = createLogger('reminder-jobs');

/**
 * The one place a scheduled job becomes a reminder delivery.
 *
 * The handler is deliberately thin. It validates its payload, calls the
 * service, and decides only one thing the service cannot: whether this attempt
 * was the last. When it was, the reminder is marked `failed` with the reason
 * *before* the error is rethrown, so the scheduler's final "gave up" and the
 * reminder's own record of why agree with each other.
 *
 * Nothing about scheduling lives in the AI layer and nothing about reminders
 * lives in the scheduler; this file is the seam, and it is registered at
 * start-up rather than imported by either side.
 */
export const registerReminderJobs = (): void => {
  registerJobHandler(REMINDER_JOB_TYPE, async (payload, { job, now }) => {
    const reminderId = typeof payload.reminderId === 'string' ? payload.reminderId : null;
    const occurrenceAt =
      typeof payload.occurrenceAt === 'string' ? new Date(payload.occurrenceAt) : null;

    if (!reminderId || !occurrenceAt || Number.isNaN(occurrenceAt.getTime())) {
      // A retry would carry the same broken payload, so there is nothing to
      // wait for.
      throw new PermanentJobError('The reminder job payload is missing an id or an occurrence');
    }

    try {
      const result = await deliverOccurrence(reminderId, occurrenceAt, now);

      if (result.status === 'skipped') {
        log.debug({ reminderId, reason: result.reason }, 'reminder delivery skipped');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (job.attempts >= job.maxAttempts) {
        await markDeliveryFailed(reminderId, message);
      }

      throw error;
    }
  });
};
