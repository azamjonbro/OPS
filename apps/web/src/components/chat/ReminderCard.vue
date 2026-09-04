<script setup lang="ts">
import { ref } from 'vue';

import type { ReminderBlock } from '@/chat/message-content';
import BaseBadge from '@/components/ui/BaseBadge.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useToast } from '@/composables/useToast';
import { toErrorMessage } from '@/services/api-error';
import { reminderService } from '@/services/reminder.service';

/**
 * A reminder the assistant set.
 *
 * The local time and the zone are both shown, because "10:00" without a zone is
 * exactly the ambiguity the backend went to some trouble to remove — and a
 * person checking that the assistant understood them needs to see the wall
 * clock it actually recorded.
 *
 * Cancelling is a real API call, not a scheduler decision made here.
 */
const props = defineProps<{ reminder: ReminderBlock }>();

const toast = useToast();
const status = ref(props.reminder.status);
const isCancelling = ref(false);

const TONES = {
  scheduled: 'brand',
  sent: 'positive',
  cancelled: 'neutral',
  failed: 'danger',
} as const;

const cancel = async (): Promise<void> => {
  if (isCancelling.value) {
    return;
  }

  isCancelling.value = true;

  try {
    const updated = await reminderService.cancel(props.reminder.id);
    status.value = updated.status;
    toast.success('Reminder cancelled.');
  } catch (caught) {
    toast.error(toErrorMessage(caught));
  } finally {
    isCancelling.value = false;
  }
};
</script>

<template>
  <article class="flex flex-col gap-3 rounded-xl bg-surface p-4 ring-1 ring-border-subtle">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="truncate text-sm font-semibold text-ink-900">{{ reminder.title }}</h3>
        <p v-if="reminder.description" class="mt-0.5 text-xs text-ink-500">
          {{ reminder.description }}
        </p>
      </div>
      <BaseBadge :tone="TONES[status as keyof typeof TONES] ?? 'neutral'" dot>
        {{ status }}
      </BaseBadge>
    </div>

    <dl class="grid grid-cols-2 gap-2 text-xs">
      <div>
        <dt class="text-ink-500">When</dt>
        <dd class="mt-0.5 font-medium text-ink-900">
          {{ reminder.localScheduledAt || reminder.scheduledAt }}
        </dd>
      </div>
      <div v-if="reminder.timezone">
        <dt class="text-ink-500">Time zone</dt>
        <dd class="mt-0.5 text-ink-900">{{ reminder.timezone }}</dd>
      </div>
      <div v-if="reminder.recurrenceRule" class="col-span-2">
        <dt class="text-ink-500">Repeats</dt>
        <dd class="mt-0.5 font-mono text-ink-900">{{ reminder.recurrenceRule }}</dd>
      </div>
    </dl>

    <div class="flex flex-wrap gap-2">
      <BaseButton
        v-if="status === 'scheduled'"
        variant="secondary"
        size="sm"
        :loading="isCancelling"
        @click="cancel"
      >
        Cancel reminder
      </BaseButton>
      <RouterLink :to="{ name: 'reminders' }">
        <BaseButton variant="ghost" size="sm">All reminders</BaseButton>
      </RouterLink>
    </div>
  </article>
</template>
