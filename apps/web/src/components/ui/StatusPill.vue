<script setup lang="ts">
import type { HealthStatus } from '@hadiya/shared';
import { computed } from 'vue';

const props = withDefaults(defineProps<{ status: HealthStatus | 'unknown'; label?: string }>(), {
  label: undefined,
});

const STYLES: Record<HealthStatus | 'unknown', { dot: string; chip: string; text: string }> = {
  ok: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 ring-emerald-200', text: 'text-emerald-700' },
  degraded: { dot: 'bg-amber-500', chip: 'bg-amber-50 ring-amber-200', text: 'text-amber-700' },
  down: { dot: 'bg-rose-500', chip: 'bg-rose-50 ring-rose-200', text: 'text-rose-700' },
  unknown: { dot: 'bg-slate-400', chip: 'bg-slate-50 ring-slate-200', text: 'text-slate-600' },
};

const style = computed(() => STYLES[props.status]);
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset"
    :class="[style.chip, style.text]"
  >
    <span class="size-1.5 rounded-full" :class="style.dot" aria-hidden="true" />
    {{ label ?? status }}
  </span>
</template>
