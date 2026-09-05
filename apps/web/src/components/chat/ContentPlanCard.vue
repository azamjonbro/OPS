<script setup lang="ts">
import { ref } from 'vue';

import type { ContentPlanBlock } from '@/chat/message-content';
import BaseBadge from '@/components/ui/BaseBadge.vue';
import BaseButton from '@/components/ui/BaseButton.vue';

/**
 * A content plan the assistant wrote, laid out day by day.
 *
 * Days collapse to their headline because a seven-day plan with full captions
 * is a wall of text in a chat column; the one being discussed can be opened.
 *
 * Note what is *not* here: no edit controls. Changing a day is done by saying
 * so — "3-kunni o'zgartir" — which goes back through the same chat endpoint
 * with the same conversation id. Building a second editing path would be a
 * second content architecture, and the plan already has a proper editor of its
 * own on the content screen.
 */
const props = defineProps<{ plan: ContentPlanBlock }>();

const expanded = ref<number | null>(props.plan.items.length === 1 ? 1 : null);

const toggle = (day: number): void => {
  expanded.value = expanded.value === day ? null : day;
};
</script>

<template>
  <article class="overflow-hidden rounded-xl bg-surface ring-1 ring-border-subtle">
    <header
      class="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-4 py-3"
    >
      <div class="min-w-0">
        <h3 class="truncate text-sm font-semibold text-ink-900">{{ plan.title }}</h3>
        <p class="text-xs text-ink-500">
          {{ plan.platform }} · {{ plan.itemCount }} day(s)
          <span v-if="plan.startDate"> · {{ plan.startDate }} → {{ plan.endDate }}</span>
        </p>
      </div>
      <RouterLink :to="{ name: 'content-plan', params: { id: plan.id } }">
        <BaseButton variant="secondary" size="sm">Open plan</BaseButton>
      </RouterLink>
    </header>

    <ol class="divide-y divide-border-subtle">
      <li v-for="item in plan.items" :key="item.day">
        <button
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-muted"
          :aria-expanded="expanded === item.day"
          @click="toggle(item.day)"
        >
          <span
            class="grid size-6 shrink-0 place-items-center rounded-md bg-brand-50 text-xs font-semibold text-brand-700"
            aria-hidden="true"
          >
            {{ item.day }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-ink-900">{{ item.title }}</span>
            <span class="block text-xs text-ink-500">
              {{ item.date }}<span v-if="item.date"> · </span>{{ item.contentType }}
            </span>
          </span>
          <svg
            class="size-4 shrink-0 text-ink-400 transition-transform"
            :class="expanded === item.day ? 'rotate-180' : ''"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        <div v-if="expanded === item.day" class="flex flex-col gap-2 px-4 pb-3 pl-[3.25rem]">
          <p v-if="item.idea" class="text-xs text-ink-500">{{ item.idea }}</p>
          <p v-if="item.caption" class="whitespace-pre-line text-sm text-ink-700">
            {{ item.caption }}
          </p>
          <p v-if="item.callToAction" class="text-xs font-medium text-ink-700">
            {{ item.callToAction }}
          </p>
          <ul v-if="item.hashtags.length > 0" class="flex flex-wrap gap-1">
            <li v-for="tag in item.hashtags" :key="tag">
              <BaseBadge tone="brand">#{{ tag }}</BaseBadge>
            </li>
          </ul>
        </div>
      </li>
    </ol>

    <p class="border-t border-border-subtle px-4 py-2 text-xs text-ink-500">
      Ask for a change in the chat — for example “3-kunni o‘zgartir”.
    </p>
  </article>
</template>
