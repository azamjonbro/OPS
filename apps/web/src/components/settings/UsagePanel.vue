<script setup lang="ts">
import type { AiUsageReport } from '@hadiya/shared';
import { computed } from 'vue';

import { formatDate } from '@/utils/format';

/**
 * What the assistant has cost, from Hadiya's own stored token counts.
 *
 * There is deliberately no money on this panel and no "credit remaining". The
 * provider does not expose a balance to an ordinary API key — that needs an
 * admin key or the billing page in a browser — and the per-token rate depends
 * on the plan, the model version and the date, none of which this application
 * knows. A figure derived from a hard-coded price would look authoritative and
 * be quietly wrong, which is worse than the honest gap and the link.
 */
const props = defineProps<{ usage: AiUsageReport }>();

const total = computed(() => props.usage.totals.promptTokens + props.usage.totals.completionTokens);

const period = computed(() => {
  const { firstAt, lastAt } = props.usage.totals;

  return firstAt && lastAt ? `${formatDate(firstAt)} → ${formatDate(lastAt)}` : null;
});

const compact = (value: number): string => new Intl.NumberFormat('en-GB').format(value);
</script>

<template>
  <div class="flex flex-col gap-4">
    <dl class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      <div>
        <dt class="text-xs text-ink-500">Conversations</dt>
        <dd class="mt-0.5 text-sm font-semibold tabular-nums text-ink-900">
          {{ usage.conversationCount }}
        </dd>
      </div>
      <div>
        <dt class="text-xs text-ink-500">Answers</dt>
        <dd class="mt-0.5 text-sm font-semibold tabular-nums text-ink-900">
          {{ usage.totals.turns }}
        </dd>
      </div>
      <div>
        <dt class="text-xs text-ink-500">Images</dt>
        <dd class="mt-0.5 text-sm font-semibold tabular-nums text-ink-900">
          {{ usage.imageCount }}
        </dd>
      </div>
      <div>
        <dt class="text-xs text-ink-500">Tokens</dt>
        <dd class="mt-0.5 text-sm font-semibold tabular-nums text-ink-900">
          {{ compact(total) }}
        </dd>
      </div>
    </dl>

    <p v-if="period" class="text-xs text-ink-500">{{ period }}</p>

    <div v-if="usage.byModel.length > 0" class="overflow-x-auto">
      <table class="w-full text-left text-xs">
        <thead>
          <tr class="border-b border-border-subtle">
            <th scope="col" class="py-1.5 pr-3 font-medium text-ink-500">Model</th>
            <th scope="col" class="py-1.5 pr-3 text-right font-medium text-ink-500">Answers</th>
            <th scope="col" class="py-1.5 pr-3 text-right font-medium text-ink-500">Sent</th>
            <th scope="col" class="py-1.5 text-right font-medium text-ink-500">Received</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border-subtle">
          <tr v-for="row in usage.byModel" :key="row.model">
            <td class="py-1.5 pr-3 font-mono text-ink-900">{{ row.model }}</td>
            <td class="py-1.5 pr-3 text-right tabular-nums text-ink-700">{{ row.turns }}</td>
            <td class="py-1.5 pr-3 text-right tabular-nums text-ink-700">
              {{ compact(row.promptTokens) }}
            </td>
            <td class="py-1.5 text-right tabular-nums text-ink-700">
              {{ compact(row.completionTokens) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p
      v-if="usage.organisation"
      class="rounded-lg bg-surface-muted px-3 py-2 text-xs text-ink-700 ring-1 ring-border-subtle"
    >
      Across everyone: {{ usage.organisation.totals.turns }} answer(s),
      {{
        compact(usage.organisation.totals.promptTokens + usage.organisation.totals.completionTokens)
      }}
      tokens, {{ usage.organisation.imageCount }} image(s).
    </p>
  </div>
</template>
