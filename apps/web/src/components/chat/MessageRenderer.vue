<script setup lang="ts">
import type { MessageBlock } from '@/chat/message-content';
import ContentPlanCard from './ContentPlanCard.vue';
import ConfirmationCard from './ConfirmationCard.vue';
import GeneratedImageCard from './GeneratedImageCard.vue';
import MarkdownRenderer from './MarkdownRenderer.vue';
import MetricsCard from './MetricsCard.vue';
import ReminderCard from './ReminderCard.vue';
import ToolExecutionCard from './ToolExecutionCard.vue';
import ToolResultTable from './ToolResultTable.vue';

/**
 * One assistant turn, block by block.
 *
 * This is the only place that decides *how* something is shown, and it decides
 * it from the block's `kind` alone. Adding a way to render a result means
 * adding a case here and a reader in `message-content`; it never means an
 * extra `v-if` in the bubble, and nothing downstream of this component knows
 * that images or plans exist.
 *
 * The generic tool card is the last resort and is deliberately reachable: a
 * capability the frontend has never heard of still appears as a named step
 * rather than silently vanishing from the transcript.
 */
defineProps<{ blocks: MessageBlock[]; disabled?: boolean }>();

const emit = defineEmits<{ reply: [text: string] }>();
</script>

<template>
  <div class="flex flex-col gap-3">
    <template v-for="(block, index) in blocks" :key="index">
      <MarkdownRenderer v-if="block.kind === 'text'" :text="block.text" />

      <GeneratedImageCard v-else-if="block.kind === 'image'" :images="block.images" />

      <ContentPlanCard v-else-if="block.kind === 'content-plan'" :plan="block.plan" />

      <ReminderCard v-else-if="block.kind === 'reminder'" :reminder="block.reminder" />

      <MetricsCard v-else-if="block.kind === 'metrics'" :metrics="block.metrics" />

      <ToolResultTable v-else-if="block.kind === 'table'" :table="block.table" />

      <ConfirmationCard
        v-else-if="block.kind === 'confirmation'"
        :question="block.question"
        :disabled="disabled"
        @reply="emit('reply', $event)"
      />

      <p
        v-else-if="block.kind === 'error'"
        class="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-700 ring-1 ring-danger-600/25"
      >
        {{ block.message }}
      </p>

      <ToolExecutionCard v-else :call="block.call" />
    </template>
  </div>
</template>
