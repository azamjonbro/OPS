<script setup lang="ts">
import { RouterLink } from 'vue-router';

import { navigationSections } from '@/config/navigation';
import { useUiStore } from '@/stores/ui';

const ui = useUiStore();
</script>

<template>
  <aside
    class="flex h-full flex-col bg-slate-900 text-slate-300 transition-[width] duration-200"
    :class="ui.sidebarCollapsed ? 'w-[4.5rem]' : 'w-64'"
  >
    <div class="flex h-16 items-center gap-3 px-5">
      <span
        class="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white"
      >
        H
      </span>
      <span v-if="!ui.sidebarCollapsed" class="text-base font-semibold text-white">Hadiya</span>
    </div>

    <nav class="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
      <div v-for="section in navigationSections" :key="section.title" class="mt-5 first:mt-0">
        <p
          v-if="!ui.sidebarCollapsed"
          class="px-2 pb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-500"
        >
          {{ section.title }}
        </p>
        <ul class="space-y-1">
          <li v-for="item in section.items" :key="item.label">
            <RouterLink
              v-if="item.to"
              :to="item.to"
              class="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium hover:bg-slate-800 hover:text-white"
              active-class="bg-slate-800 text-white"
              :title="ui.sidebarCollapsed ? item.label : undefined"
            >
              <svg
                class="size-5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path :d="item.icon" />
              </svg>
              <span v-if="!ui.sidebarCollapsed">{{ item.label }}</span>
            </RouterLink>

            <span
              v-else
              class="flex cursor-not-allowed items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-500"
              :title="`${item.label} — available in a later phase`"
            >
              <svg
                class="size-5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path :d="item.icon" />
              </svg>
              <span v-if="!ui.sidebarCollapsed" class="flex-1">{{ item.label }}</span>
              <span
                v-if="!ui.sidebarCollapsed"
                class="rounded bg-slate-800 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide"
              >
                soon
              </span>
            </span>
          </li>
        </ul>
      </div>
    </nav>

    <button
      type="button"
      class="flex h-12 items-center gap-3 border-t border-slate-800 px-5 text-sm text-slate-400 hover:text-white"
      @click="ui.toggleSidebar()"
    >
      <svg
        class="size-5 shrink-0 transition-transform"
        :class="ui.sidebarCollapsed ? 'rotate-180' : ''"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span v-if="!ui.sidebarCollapsed">Collapse</span>
    </button>
  </aside>
</template>
