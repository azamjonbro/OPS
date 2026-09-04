import type { ReminderStatus, ReminderView } from '@hadiya/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { toErrorMessage } from '@/services/api-error';
import {
  reminderService,
  type CreateReminderPayload,
  type UpdateReminderPayload,
} from '@/services/reminder.service';

/**
 * Reminder state for the UI.
 *
 * The store keeps what the API returned and nothing derived from a local clock:
 * `localScheduledAt` and the plain-language recurrence both come from the
 * server, which knows the account's zone. A browser in another zone therefore
 * shows the reminder as its owner set it, not as the laptop reads it.
 */
export const useRemindersStore = defineStore('reminders', () => {
  const reminders = ref<ReminderView[]>([]);
  const isLoading = ref(false);
  const isSaving = ref(false);
  const error = ref<string | null>(null);

  const upcoming = computed(() =>
    reminders.value.filter((reminder) => reminder.status === 'scheduled'),
  );

  const hasUpcoming = computed(() => upcoming.value.length > 0);

  const run = async <TResult>(
    flag: { value: boolean },
    action: () => Promise<TResult>,
  ): Promise<TResult | null> => {
    flag.value = true;
    error.value = null;

    try {
      return await action();
    } catch (caught) {
      error.value = toErrorMessage(caught);

      return null;
    } finally {
      flag.value = false;
    }
  };

  const load = async (status: ReminderStatus = 'scheduled'): Promise<void> => {
    const result = await run(isLoading, () => reminderService.list({ status, pageSize: 20 }));

    if (result) {
      reminders.value = result.items;
    }
  };

  const create = async (payload: CreateReminderPayload): Promise<ReminderView | null> => {
    const created = await run(isSaving, () => reminderService.create(payload));

    if (created) {
      // Re-read rather than splicing it in, so the list stays in the order the
      // API sorts by (soonest first) without the client re-implementing it.
      await load();
    }

    return created;
  };

  const update = async (
    id: string,
    payload: UpdateReminderPayload,
  ): Promise<ReminderView | null> => {
    const updated = await run(isSaving, () => reminderService.update(id, payload));

    if (updated) {
      await load();
    }

    return updated;
  };

  const cancel = async (id: string): Promise<void> => {
    const cancelled = await run(isSaving, () => reminderService.cancel(id));

    if (cancelled) {
      reminders.value = reminders.value.filter((reminder) => reminder.id !== id);
    }
  };

  const reset = (): void => {
    reminders.value = [];
    error.value = null;
  };

  return {
    reminders,
    upcoming,
    hasUpcoming,
    isLoading,
    isSaving,
    error,
    load,
    create,
    update,
    cancel,
    reset,
  };
});
