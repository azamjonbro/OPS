<script setup lang="ts">
import { onMounted } from 'vue';

import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import { useRemindersStore } from '@/stores/reminders';

/**
 * What the signed-in employee has coming up.
 *
 * The time shown is `localScheduledAt`, which the API renders in the account's
 * own zone. Formatting the UTC instant here would show the browser's zone
 * instead, and a reminder set for ten o'clock at the shop would read as
 * something else on a phone abroad.
 */
const reminders = useRemindersStore();

onMounted(() => {
  void reminders.load();
});
</script>

<template>
  <BaseCard title="Upcoming reminders" description="Scheduled for you">
    <template #header>
      <BaseButton
        variant="secondary"
        size="sm"
        :loading="reminders.isLoading"
        @click="reminders.load()"
      >
        Refresh
      </BaseButton>
    </template>

    <p v-if="reminders.error" class="text-sm text-rose-600">{{ reminders.error }}</p>

    <p v-else-if="!reminders.hasUpcoming && !reminders.isLoading" class="text-sm text-ink-500">
      Nothing scheduled. Ask the assistant to remind you about something.
    </p>

    <ul v-else class="divide-y divide-border-subtle rounded-lg ring-1 ring-border-subtle">
      <li
        v-for="reminder in reminders.upcoming"
        :key="reminder.id"
        class="flex items-start justify-between gap-4 px-4 py-3"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-ink-900">{{ reminder.title }}</p>
          <p class="mt-0.5 text-xs text-ink-500">
            {{ reminder.localScheduledAt }}
            <span v-if="reminder.recurrenceDescription">
              · {{ reminder.recurrenceDescription }}
            </span>
          </p>
          <p v-if="reminder.description" class="mt-1 truncate text-xs text-ink-500">
            {{ reminder.description }}
          </p>
        </div>
        <BaseButton
          variant="ghost"
          size="sm"
          :disabled="reminders.isSaving"
          @click="reminders.cancel(reminder.id)"
        >
          Cancel
        </BaseButton>
      </li>
    </ul>
  </BaseCard>
</template>
