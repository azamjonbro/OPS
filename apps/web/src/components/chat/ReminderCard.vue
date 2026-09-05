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
  <article
    class="flex flex-col gap-4 rounded-[14px] bg-surface p-5 shadow-sm ring-1 ring-border-subtle my-2"
  >
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h3 class="truncate text-[15px] font-semibold text-ink-900">{{ reminder.title }}</h3>
        <p v-if="reminder.description" class="mt-1 text-[13px] text-ink-500 leading-relaxed">
          {{ reminder.description }}
        </p>
      </div>
      <BaseBadge :tone="TONES[status as keyof typeof TONES] ?? 'neutral'" dot class="!rounded-md">
        {{ status }}
      </BaseBadge>
    </div>

    <dl class="grid grid-cols-2 gap-4 rounded-xl bg-surface-muted/50 p-4 ring-1 ring-border-subtle">
      <div>
        <dt class="text-[11px] font-semibold uppercase tracking-wider text-ink-400">When</dt>
        <dd class="mt-1 text-[13px] font-medium text-ink-900">
          {{ reminder.localScheduledAt || reminder.scheduledAt }}
        </dd>
      </div>
      <div v-if="reminder.timezone">
        <dt class="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Time zone</dt>
        <dd class="mt-1 text-[13px] font-medium text-ink-900">{{ reminder.timezone }}</dd>
      </div>
      <div v-if="reminder.recurrenceRule" class="col-span-2">
        <dt class="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Repeats</dt>
        <dd
          class="mt-1 font-mono text-[13px] text-ink-900 bg-surface px-2 py-1 rounded-md inline-block ring-1 ring-border-subtle shadow-sm"
        >
          {{ reminder.recurrenceRule }}
        </dd>
      </div>
    </dl>

    <div class="flex flex-wrap gap-2.5 mt-1">
      <BaseButton
        v-if="status === 'scheduled'"
        variant="secondary"
        size="sm"
        :loading="isCancelling"
        class="!rounded-lg"
        @click="cancel"
      >
        Cancel reminder
      </BaseButton>
      <RouterLink :to="{ name: 'reminders' }">
        <BaseButton variant="ghost" size="sm" class="!rounded-lg text-ink-600 hover:text-ink-900"
          >All reminders</BaseButton
        >
      </RouterLink>
    </div>
  </article>
</template>
