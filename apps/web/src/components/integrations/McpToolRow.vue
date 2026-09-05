<script setup lang="ts">
import { MCP_TOOL_PERMISSIONS, type McpTool, type McpToolPermission } from '@hadiya/shared';
import { computed } from 'vue';

import BaseBadge from '@/components/ui/BaseBadge.vue';

/**
 * One discovered tool, and what the assistant may do with it.
 *
 * The permission is a select rather than a toggle because there are genuinely
 * four answers and three of them mean "not automatically". Collapsing them into
 * on/off would lose the one that matters most — *ask me first* — which is the
 * setting that makes a write tool safe to leave connected at all.
 *
 * The description is text an external server wrote. It has already been
 * stripped of control and zero-width characters server-side and is rendered as
 * text by Vue, never as markup: a tool named after a `<script>` tag appears as
 * that string and does nothing.
 */
const props = defineProps<{ tool: McpTool; busy?: boolean }>();
const emit = defineEmits<{ change: [permission: McpToolPermission] }>();

const PERMISSION_LABELS: Record<McpToolPermission, string> = {
  enabled: 'Enabled',
  requires_confirmation: 'Ask me first',
  disabled: 'Disabled',
  blocked: 'Blocked',
};

const PERMISSION_TONES = {
  enabled: 'positive',
  requires_confirmation: 'warning',
  disabled: 'neutral',
  blocked: 'danger',
} as const;

const RISK_LABELS = {
  read: 'Reads data',
  write: 'Changes data',
  destructive: 'Deletes data',
  unknown: 'Unclassified',
} as const;

const isRisky = computed(() => props.tool.risk === 'destructive' || props.tool.risk === 'unknown');

const onChange = (event: Event): void => {
  emit('change', (event.target as HTMLSelectElement).value as McpToolPermission);
};
</script>

<template>
  <div class="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <code class="font-mono text-sm text-ink-900">{{ tool.name }}</code>
        <BaseBadge :tone="PERMISSION_TONES[tool.permission]" dot>
          {{ PERMISSION_LABELS[tool.permission] }}
        </BaseBadge>
        <BaseBadge v-if="isRisky" tone="warning">{{ RISK_LABELS[tool.risk] }}</BaseBadge>
      </div>

      <p v-if="tool.description" class="mt-1 text-xs text-ink-500">{{ tool.description }}</p>
      <p v-else class="mt-1 text-xs italic text-ink-400">The server gave no description.</p>
    </div>

    <label class="shrink-0">
      <span class="sr-only">Permission for {{ tool.name }}</span>
      <select
        class="h-9 rounded-lg bg-surface px-2 text-sm text-ink-900 ring-1 ring-inset ring-border-subtle focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:opacity-60"
        :value="tool.permission"
        :disabled="busy"
        @change="onChange"
      >
        <option v-for="permission in MCP_TOOL_PERMISSIONS" :key="permission" :value="permission">
          {{ PERMISSION_LABELS[permission] }}
        </option>
      </select>
    </label>
  </div>
</template>
