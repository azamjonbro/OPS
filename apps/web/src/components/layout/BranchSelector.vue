<script setup lang="ts">
import { onMounted } from 'vue';

import { useBranchesStore } from '@/stores/branches';

/**
 * Which branch the interface is scoped to.
 *
 * Rendered only for accounts that are not tied to one branch — for everybody
 * else the API decides, and a control that could not change anything would be
 * a lie about what the person can do.
 */
const branches = useBranchesStore();

onMounted(() => void branches.load());
</script>

<template>
  <label v-if="branches.canChoose && branches.branches.length > 0" class="hidden sm:block">
    <span class="sr-only">Branch</span>
    <select
      :value="branches.selectedBranchId ?? ''"
      class="h-9 rounded-lg bg-surface px-2 text-sm text-ink-900 ring-1 ring-inset ring-border-subtle focus:outline-none focus:ring-2 focus:ring-brand-600"
      @change="branches.select(($event.target as HTMLSelectElement).value || null)"
    >
      <option value="">All branches</option>
      <option v-for="branch in branches.branches" :key="branch.id" :value="branch.id">
        {{ branch.name }}
      </option>
    </select>
  </label>
</template>
