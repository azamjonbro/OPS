import {
  buildRecurrenceRule,
  describeRecurrence,
  formatInTimeZone,
  parseRecurrenceRule,
  PART_OF_DAY_NAMES,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_WEEKDAYS,
  REMINDER_MAX_LEAD_MINUTES,
  REMINDER_STATUSES,
  type PartOfDay,
  type RecurrenceFrequency,
  type RecurrenceWeekday,
  type ReminderStatus,
} from '@hadiya/shared';
import { z } from 'zod';

import type { ReminderDocument } from '../../reminders/reminder.model.js';
import * as reminderService from '../../reminders/reminder.service.js';
import type { RegisteredTool } from './tool-registry.js';

/**
 * The reminder tools the assistant is allowed to call.
 *
 * They are the only route from a conversation to a scheduled job, and each one
 * is narrow on purpose. The model describes *what* and *when*; it never chooses
 * a user, never writes a job, and never picks an hour on somebody's behalf. The
 * actor comes from the authenticated request, so a tool cannot be talked into
 * acting as another employee, and every call runs through the same service the
 * REST API uses — which is what makes "your reminders are yours" one rule
 * rather than two implementations of it.
 *
 * Times are stated as a wall clock in the user's own zone. That is the form a
 * person speaks in ("ertaga soat 10 da"), and converting it is the service's
 * job, not the model's: a model doing zone arithmetic silently gets it wrong
 * five hours at a time.
 */

const localDateTimeSchema = z
  .string()
  .trim()
  .min(10)
  .max(40)
  .describe(
    "The user's local date and time as YYYY-MM-DDTHH:mm, e.g. 2026-09-05T10:00. Never convert to UTC yourself.",
  );

const recurrenceSchema = z
  .object({
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    interval: z
      .number()
      .int()
      .min(1)
      .max(366)
      .default(1)
      .describe('Every N days/weeks/months. 2 with WEEKLY means every other week.'),
    byWeekday: z
      .array(z.enum(RECURRENCE_WEEKDAYS))
      .max(7)
      .optional()
      .describe('Weekly only. MO,TU,WE,TH,FR,SA,SU'),
    byMonthDay: z
      .array(z.number().int().min(1).max(31))
      .max(31)
      .optional()
      .describe('Monthly only. Days of the month.'),
    count: z.number().int().min(1).max(1_000).optional().describe('Stop after this many times'),
  })
  .describe('Leave this out for a one-off reminder');

type RecurrenceArgs = {
  frequency: RecurrenceFrequency;
  interval: number;
  byWeekday?: RecurrenceWeekday[];
  byMonthDay?: number[];
  count?: number;
};

const toRule = (recurrence: RecurrenceArgs | undefined): string | null =>
  recurrence
    ? buildRecurrenceRule({
        frequency: recurrence.frequency,
        interval: recurrence.interval,
        byWeekday: recurrence.byWeekday,
        byMonthDay: recurrence.byMonthDay,
        count: recurrence.count ?? null,
      })
    : null;

/** One line per reminder, in the user's own zone — the form the model reads. */
const describe = (reminder: ReminderDocument): string => {
  const when = formatInTimeZone(reminder.scheduledAt, reminder.timezone);
  const repeat = reminder.recurrenceRule
    ? ` (${describeRecurrence(parseRecurrenceRule(reminder.recurrenceRule))})`
    : '';

  return `${when} — ${reminder.title}${repeat} [${reminder.status}, id ${String(reminder._id)}]`;
};

const summarise = (reminder: ReminderDocument) => ({
  id: String(reminder._id),
  title: reminder.title,
  description: reminder.description,
  scheduledAt: reminder.scheduledAt.toISOString(),
  localScheduledAt: formatInTimeZone(reminder.scheduledAt, reminder.timezone),
  timezone: reminder.timezone,
  status: reminder.status,
  recurrenceRule: reminder.recurrenceRule,
});

export const createReminderTool: RegisteredTool = {
  name: 'create_reminder',
  description:
    'Schedule a reminder for the user. Use it whenever they ask to be reminded of something at a time, after a delay, or on a repeating schedule. Give the time as the user\'s own local wall clock — today\'s date and the user\'s time zone are in your instructions. If the time is vague ("this evening", "later"), still call this with partOfDay: the tool answers with a question when it cannot resolve it safely, and you should then ask the user rather than picking an hour yourself.',
  mutates: true,
  schema: z
    .object({
      title: z.string().trim().min(1).max(160).describe('What to remind them of, in their words'),
      description: z.string().trim().max(2_000).optional().describe('Any extra detail'),
      scheduledAt: localDateTimeSchema.optional(),
      inMinutes: z
        .number()
        .int()
        .min(1)
        .max(REMINDER_MAX_LEAD_MINUTES)
        .optional()
        .describe('For "in 2 hours" say 120. Use this instead of computing a clock time.'),
      partOfDay: z
        .enum(PART_OF_DAY_NAMES)
        .optional()
        .describe('Only when the user named a part of the day rather than a time'),
      date: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('The day partOfDay refers to. Defaults to today.'),
      recurrence: recurrenceSchema.optional(),
    })
    .refine(
      (value) =>
        value.scheduledAt !== undefined ||
        value.inMinutes !== undefined ||
        value.partOfDay !== undefined,
      'Give scheduledAt, inMinutes or partOfDay',
    ),
  execute: async (args, context) => {
    const input = args as {
      title: string;
      description?: string;
      scheduledAt?: string;
      inMinutes?: number;
      partOfDay?: PartOfDay;
      date?: string;
      recurrence?: RecurrenceArgs;
    };

    const result = await reminderService.createReminder(context.actor, {
      title: input.title,
      description: input.description ?? null,
      scheduledAt: input.scheduledAt,
      inMinutes: input.inMinutes,
      partOfDay: input.partOfDay,
      date: input.date,
      recurrenceRule: toRule(input.recurrence),
      conversationId: context.conversationId,
    });

    if (result.outcome === 'needs_clarification') {
      // Deliberately not an error: the model is being told to ask, and a failed
      // tool call would read as something having gone wrong.
      return {
        summary: `I need one more detail before I can set this: ${result.question}`,
        data: { needsClarification: true, question: result.question },
      };
    }

    return {
      summary: `Reminder set for ${formatInTimeZone(
        result.reminder.scheduledAt,
        result.reminder.timezone,
      )}: ${result.reminder.title}.`,
      data: summarise(result.reminder),
    };
  },
};

export const listRemindersTool: RegisteredTool = {
  name: 'list_reminders',
  description:
    "The user's own reminders, soonest first. Use it when they ask what they have coming up, or to find the reminder they want changed or cancelled.",
  mutates: false,
  schema: z.object({
    status: z.enum(REMINDER_STATUSES).optional().describe('Defaults to everything still scheduled'),
    search: z.string().trim().min(1).max(80).optional().describe('Matches the title or the detail'),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  execute: async (args, context) => {
    const { status, search, limit } = args as {
      status?: ReminderStatus;
      search?: string;
      limit: number;
    };

    const { items, pagination } = await reminderService.listReminders(context.actor, {
      page: 1,
      pageSize: limit,
      status: status ?? 'scheduled',
      ...(search ? { search } : {}),
    });

    if (items.length === 0) {
      return {
        summary: search
          ? `No ${status ?? 'scheduled'} reminders match "${search}".`
          : `There are no ${status ?? 'scheduled'} reminders.`,
        data: { items: [], total: 0 },
      };
    }

    return {
      summary: `${pagination.total} reminder(s): ${items.map(describe).join(' | ')}`,
      data: { items: items.map(summarise), total: pagination.total },
    };
  },
};

export const getReminderTool: RegisteredTool = {
  name: 'get_reminder',
  description:
    'Look up one reminder by its id, for when you need its full detail before changing or confirming it.',
  mutates: false,
  schema: z.object({
    reminderId: z.string().trim().length(24).describe('From list_reminders'),
  }),
  execute: async (args, context) => {
    const { reminderId } = args as { reminderId: string };
    const reminder = await reminderService.getReminder(context.actor, reminderId);

    return { summary: describe(reminder), data: summarise(reminder) };
  },
};

export const updateReminderTool: RegisteredTool = {
  name: 'update_reminder',
  description:
    'Change an existing reminder: its wording, its time, or how often it repeats. Only send the fields that change. Moving the time reschedules it, so the old time will not also fire.',
  mutates: true,
  schema: z.object({
    reminderId: z.string().trim().length(24).describe('From list_reminders'),
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2_000).optional(),
    scheduledAt: localDateTimeSchema.optional(),
    inMinutes: z.number().int().min(1).max(REMINDER_MAX_LEAD_MINUTES).optional(),
    partOfDay: z.enum(PART_OF_DAY_NAMES).optional(),
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    recurrence: recurrenceSchema.optional(),
    /** Explicitly clearing a schedule is distinct from leaving it alone. */
    stopRepeating: z
      .boolean()
      .optional()
      .describe('True turns a repeating reminder into a one-off'),
  }),
  execute: async (args, context) => {
    const input = args as {
      reminderId: string;
      title?: string;
      description?: string;
      scheduledAt?: string;
      inMinutes?: number;
      partOfDay?: PartOfDay;
      date?: string;
      recurrence?: RecurrenceArgs;
      stopRepeating?: boolean;
    };

    const recurrenceRule = input.stopRepeating ? null : toRule(input.recurrence);

    const result = await reminderService.updateReminder(context.actor, input.reminderId, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.scheduledAt !== undefined ? { scheduledAt: input.scheduledAt } : {}),
      ...(input.inMinutes !== undefined ? { inMinutes: input.inMinutes } : {}),
      ...(input.partOfDay !== undefined ? { partOfDay: input.partOfDay } : {}),
      ...(input.date !== undefined ? { date: input.date } : {}),
      ...(input.stopRepeating || input.recurrence ? { recurrenceRule } : {}),
    });

    if (result.outcome === 'needs_clarification') {
      return {
        summary: `I need one more detail before I can change this: ${result.question}`,
        data: { needsClarification: true, question: result.question },
      };
    }

    return { summary: `Updated. ${describe(result.reminder)}`, data: summarise(result.reminder) };
  },
};

export const cancelReminderTool: RegisteredTool = {
  name: 'cancel_reminder',
  description:
    'Cancel a reminder so it never fires. Use it when the user says they no longer need one. It stops immediately, including any future repeats.',
  mutates: true,
  schema: z.object({
    reminderId: z.string().trim().length(24).describe('From list_reminders'),
  }),
  execute: async (args, context) => {
    const { reminderId } = args as { reminderId: string };
    const reminder = await reminderService.cancelReminder(context.actor, reminderId);

    return {
      summary: `Cancelled: ${reminder.title}.`,
      data: summarise(reminder),
    };
  },
};

export const REMINDER_TOOLS: readonly RegisteredTool[] = [
  createReminderTool,
  listRemindersTool,
  getReminderTool,
  updateReminderTool,
  cancelReminderTool,
];
