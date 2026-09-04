<script setup lang="ts">
import { reactive, ref } from 'vue';

import NotificationList from '@/components/notifications/NotificationList.vue';
import UpcomingReminders from '@/components/reminders/UpcomingReminders.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import { buildSimpleRecurrence } from '@/services/reminder.service';
import { useRemindersStore } from '@/stores/reminders';

/**
 * Reminders and the inbox, side by side.
 *
 * The form sends a local wall clock exactly as typed — `2026-09-05T10:00` — and
 * lets the API apply the account's zone. A browser converting to UTC first
 * would be a second opinion about what "ten o'clock" means, and the two would
 * disagree the moment somebody travelled.
 */
const reminders = useRemindersStore();

const form = reactive({ title: '', description: '', scheduledAt: '', repeat: 'none' });
const created = ref<string | null>(null);

const submit = async (): Promise<void> => {
  created.value = null;

  const reminder = await reminders.create({
    title: form.title,
    ...(form.description ? { description: form.description } : {}),
    scheduledAt: form.scheduledAt,
    ...(form.repeat === 'none'
      ? {}
      : {
          recurrenceRule: buildSimpleRecurrence(form.repeat as 'DAILY' | 'WEEKLY' | 'MONTHLY'),
        }),
  });

  if (reminder) {
    created.value = `Set for ${reminder.localScheduledAt}.`;
    form.title = '';
    form.description = '';
    form.scheduledAt = '';
    form.repeat = 'none';
  }
};

const fieldClasses =
  'h-10 w-full rounded-lg px-3 text-sm text-ink-900 ring-1 ring-inset ring-border-subtle focus:outline-none focus:ring-2 focus:ring-brand-600';
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-6">
    <div>
      <h2 class="text-xl font-semibold text-ink-900">Reminders</h2>
      <p class="mt-1 text-sm text-ink-500">
        Set one here, or just ask the assistant — “ertaga soat 10 da Billz qarzlarni tekshirishni
        eslat”.
      </p>
    </div>

    <BaseCard title="New reminder" description="Times are read in your account’s time zone">
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Title</span>
            <input
              v-model="form.title"
              required
              maxlength="160"
              :class="fieldClasses"
              placeholder="Billz qarzlarni tekshirish"
            />
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium uppercase tracking-wide text-ink-500">When</span>
            <input
              v-model="form.scheduledAt"
              type="datetime-local"
              required
              :class="fieldClasses"
            />
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Detail</span>
            <input
              v-model="form.description"
              maxlength="2000"
              :class="fieldClasses"
              placeholder="Optional"
            />
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Repeat</span>
            <select v-model="form.repeat" :class="fieldClasses">
              <option value="none">Once</option>
              <option value="DAILY">Every day</option>
              <option value="WEEKLY">Every week</option>
              <option value="MONTHLY">Every month</option>
            </select>
          </label>
        </div>

        <div class="flex items-center gap-3">
          <BaseButton type="submit" :loading="reminders.isSaving">Set reminder</BaseButton>
          <p v-if="created" class="text-sm text-emerald-600">{{ created }}</p>
          <p v-else-if="reminders.error" class="text-sm text-rose-600">{{ reminders.error }}</p>
        </div>
      </form>
    </BaseCard>

    <UpcomingReminders />
    <NotificationList />
  </div>
</template>
