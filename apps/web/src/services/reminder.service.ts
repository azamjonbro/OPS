import type {
  NotificationChannel,
  PaginatedResult,
  RecurrenceFrequency,
  RecurrenceWeekday,
  ReminderStatus,
  ReminderView,
} from '@hadiya/shared';

import { api } from './http';

/**
 * The reminder endpoints.
 *
 * Times are sent as the user's own wall clock (`2026-09-05T10:00`) and never as
 * UTC: the API holds the zone the account is set to, and converting in the
 * browser would mean two places deciding what "ten o'clock" is.
 */
export interface CreateReminderPayload {
  title: string;
  description?: string | null;
  /** Local wall clock, `YYYY-MM-DDTHH:mm`. */
  scheduledAt?: string;
  /** Relative alternative to `scheduledAt`. */
  inMinutes?: number;
  /** RFC 5545 rule, e.g. `FREQ=WEEKLY;BYDAY=MO`. */
  recurrenceRule?: string | null;
  channels?: NotificationChannel[];
  timezone?: string;
}

export type UpdateReminderPayload = Partial<CreateReminderPayload>;

export interface ListRemindersParams {
  page?: number;
  pageSize?: number;
  status?: ReminderStatus;
  search?: string;
}

/** Builds a rule string for the simple repeats the UI offers. */
export const buildSimpleRecurrence = (
  frequency: RecurrenceFrequency,
  byWeekday?: RecurrenceWeekday[],
): string =>
  frequency === 'WEEKLY' && byWeekday && byWeekday.length > 0
    ? `FREQ=WEEKLY;BYDAY=${byWeekday.join(',')}`
    : `FREQ=${frequency}`;

export const reminderService = {
  list: (params: ListRemindersParams = {}): Promise<PaginatedResult<ReminderView>> =>
    api.get<PaginatedResult<ReminderView>>('/v1/reminders', { params }),

  get: (id: string): Promise<ReminderView> => api.get<ReminderView>(`/v1/reminders/${id}`),

  create: (payload: CreateReminderPayload): Promise<ReminderView> =>
    api.post<ReminderView>('/v1/reminders', payload),

  update: (id: string, payload: UpdateReminderPayload): Promise<ReminderView> =>
    api.patch<ReminderView>(`/v1/reminders/${id}`, payload),

  cancel: (id: string): Promise<ReminderView> =>
    api.post<ReminderView>(`/v1/reminders/${id}/cancel`),
};
