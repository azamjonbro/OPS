<script setup lang="ts">
export interface TabItem {
  value: string;
  label: string;
  /** Rendered as a count chip beside the label. */
  badge?: number | string;
}

const props = defineProps<{ tabs: TabItem[]; label?: string }>();

/**
 * A tab strip following the ARIA pattern: arrow keys move between tabs, and the
 * selected tab is the only one in the tab order, so Tab moves *out* of the strip
 * rather than through every tab in it.
 */
const model = defineModel<string>({ required: true });

const onKeydown = (event: KeyboardEvent, index: number): void => {
  const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;

  if (delta === 0) {
    return;
  }

  event.preventDefault();
  const next = props.tabs[(index + delta + props.tabs.length) % props.tabs.length];

  if (next) {
    model.value = next.value;
  }
};
</script>

<template>
  <div class="overflow-x-auto border-b border-border-subtle">
    <div role="tablist" :aria-label="label ?? 'Sections'" class="flex min-w-max gap-1">
      <button
        v-for="(tab, index) in tabs"
        :key="tab.value"
        type="button"
        role="tab"
        :aria-selected="model === tab.value"
        :tabindex="model === tab.value ? 0 : -1"
        class="flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors"
        :class="
          model === tab.value
            ? 'border-brand-600 text-brand-700'
            : 'border-transparent text-ink-500 hover:text-ink-900'
        "
        @click="model = tab.value"
        @keydown="onKeydown($event, index)"
      >
        {{ tab.label }}
        <span
          v-if="tab.badge !== undefined"
          class="rounded-full bg-surface-muted px-1.5 py-0.5 text-xs tabular-nums text-ink-500"
        >
          {{ tab.badge }}
        </span>
      </button>
    </div>
  </div>
</template>
