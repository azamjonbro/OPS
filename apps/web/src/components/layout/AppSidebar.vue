<script setup lang="ts">
import { RouterLink } from 'vue-router';

import { useNavigation } from '@/composables/useNavigation';
import { useUiStore } from '@/stores/ui';

const emit = defineEmits<{ navigate: [] }>();
/**
 * The main navigation.
 *
 * Collapsing keeps the icons and drops the labels, so the muscle memory of
 * where a thing sits survives; each link keeps a `title` in that state, which is
 * the only affordance a mouse user has left. Disabled entries stay visible so
 * the shape of the product is legible, but they are `aria-disabled` rather than
 * links to nowhere.
 */
const ui = useUiStore();
const { sections } = useNavigation();
</script>

<template>
  <aside
    class="flex h-full flex-col bg-slate-900 text-slate-300"
    :class="ui.sidebarCollapsed ? 'w-[4.5rem]' : 'w-64'"
  >
    <div class="flex h-16 shrink-0 items-center gap-3 px-5">
      <span
        class="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white"
        aria-hidden="true"
      >
        H
      </span>
      <span v-if="!ui.sidebarCollapsed" class="text-base font-semibold text-white">Hadiya</span>
    </div>

    <nav class="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main navigation">
      <div v-for="section in sections" :key="section.title" class="mt-5 first:mt-0">
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
              class="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors hover:bg-slate-800 hover:text-white"
              active-class="bg-slate-800 text-white"
              :title="ui.sidebarCollapsed ? item.label : undefined"
              @click="emit('navigate')"
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
              <span v-else class="sr-only">{{ item.label }}</span>
            </RouterLink>

            <span
              v-else
              aria-disabled="true"
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
              <span v-if="!ui.sidebarCollapsed">{{ item.label }}</span>
            </span>
          </li>
        </ul>
      </div>
    </nav>

    <button
      type="button"
      class="hidden items-center gap-3 border-t border-slate-800 px-5 py-3 text-sm text-slate-400 hover:text-white lg:flex"
      :aria-expanded="!ui.sidebarCollapsed"
      aria-controls="app-sidebar"
      @click="ui.toggleSidebar()"
    >
      <svg
        class="size-5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path :d="ui.sidebarCollapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'" />
      </svg>
      <span v-if="!ui.sidebarCollapsed">Collapse</span>
      <span v-else class="sr-only">Expand sidebar</span>
    </button>
  </aside>
</template>
