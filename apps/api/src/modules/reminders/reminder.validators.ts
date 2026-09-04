import {
  NOTIFICATION_CHANNELS,
  objectIdSchema,
  paginationQuerySchema,
  PART_OF_DAY_NAMES,
  REMINDER_DESCRIPTION_MAX_LENGTH,
  REMINDER_MAX_LEAD_MINUTES,
  REMINDER_STATUSES,
  REMINDER_TITLE_MAX_LENGTH,
} from '@hadiya/shared';
import { z } from 'zod';

/**
 * A wall clock (`2026-09-05T10:00`) or an absolute instant (`...Z`). Which one
 * it is decides whether the user's zone is applied, so the distinction is kept
 * all the way to the resolver rather than being flattened here.
 */
const scheduledAtSchema = z
  .string()
  .trim()
  .min(10)
  .max(40)
  .describe('Local date and time, e.g. 2026-09-05T10:00');

const timezoneSchema = z.string().trim().min(3).max(64);

const channelsSchema = z.array(z.enum(NOTIFICATION_CHANNELS)).min(1).max(3);

/**
 * A recurrence rule, checked here only for shape; the service parses it for
 * meaning, so there is one authority on what a rule may say.
 */
const recurrenceRuleSchema = z.string().trim().min(5).max(200);

const timeFields = {
  scheduledAt: scheduledAtSchema.optional(),
  inMinutes: z.number().int().min(1).max(REMINDER_MAX_LEAD_MINUTES).optional(),
  partOfDay: z.enum(PART_OF_DAY_NAMES).optional(),
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  timezone: timezoneSchema.optional(),
};

export const createReminderSchema = z
  .object({
    title: z.string().trim().min(1).max(REMINDER_TITLE_MAX_LENGTH),
    description: z.string().trim().max(REMINDER_DESCRIPTION_MAX_LENGTH).nullish(),
    recurrenceRule: recurrenceRuleSchema.nullish(),
    channels: channelsSchema.optional(),
    conversationId: objectIdSchema.nullish(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    ...timeFields,
  })
  .refine(
    (value) =>
      value.scheduledAt !== undefined ||
      value.inMinutes !== undefined ||
      value.partOfDay !== undefined,
    'Give a time: scheduledAt, inMinutes or partOfDay',
  );

export const updateReminderSchema = z.object({
  title: z.string().trim().min(1).max(REMINDER_TITLE_MAX_LENGTH).optional(),
  description: z.string().trim().max(REMINDER_DESCRIPTION_MAX_LENGTH).nullish(),
  recurrenceRule: recurrenceRuleSchema.nullish(),
  channels: channelsSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  ...timeFields,
});

export const listRemindersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(REMINDER_STATUSES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().min(1).max(80).optional(),
});

export const reminderIdParamSchema = z.object({ id: objectIdSchema });
