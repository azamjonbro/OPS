<script setup lang="ts">
import { RouterLink } from 'vue-router';

import { assistantLink } from '@/config/navigation';
import { useNavigation } from '@/composables/useNavigation';
import { useUiStore } from '@/stores/ui';

const emit = defineEmits<{ navigate: [] }>();
/**
 * The back office menu.
 * Improved with UX best practices: smooth transitions, clear active states,
 * tooltips for collapsed mode, and an intuitive toggle button.
 */
const ui = useUiStore();
const { sections } = useNavigation();
</script>

<template>
  <aside
    class="relative flex h-full flex-col bg-[#0F172A] text-slate-300 shadow-2xl transition-[width] duration-300 ease-in-out border-r border-slate-800"
    :class="ui.sidebarCollapsed ? 'w-[4.5rem]' : 'w-64'"
  >
    <!-- Floating Toggle Button -->
    <button
      type="button"
      class="absolute -right-3 top-7 z-50 hidden size-6 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-slate-300 shadow-md transition-all hover:bg-brand-600 hover:text-white lg:flex hover:scale-110 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-slate-900"
      :aria-expanded="!ui.sidebarCollapsed"
      aria-controls="app-sidebar"
      @click="ui.toggleSidebar()"
      :title="ui.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
    >
      <svg
        class="size-3.5 transition-transform duration-300"
        :class="ui.sidebarCollapsed ? 'rotate-180' : ''"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>

    <RouterLink
      :to="{ name: 'assistant' }"
      class="flex h-20 shrink-0 items-center gap-3 px-5 group"
      @click="emit('navigate')"
    >
      <div
        class="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-[0_0_15px_rgba(var(--color-brand-600),0.5)] transition-transform duration-300 group-hover:scale-105"
        aria-hidden="true"
      >
        <span class="text-sm font-bold text-white">H</span>
      </div>
      <span
        class="text-lg font-bold tracking-wide text-white transition-opacity duration-300"
        :class="ui.sidebarCollapsed ? 'opacity-0 hidden' : 'opacity-100'"
      >
        Hadiya
      </span>
    </RouterLink>

    <div class="shrink-0 px-3 pb-4">
      <RouterLink
        :to="assistantLink.to ?? { name: 'assistant' }"
        class="group flex items-center gap-3 rounded-xl bg-slate-800/50 px-3 py-2.5 text-sm font-medium text-white ring-1 ring-inset ring-slate-700/50 transition-all duration-200 hover:bg-brand-600 hover:ring-brand-500 hover:shadow-lg"
        :title="ui.sidebarCollapsed ? assistantLink.label : undefined"
        @click="emit('navigate')"
      >
        <div class="rounded-lg bg-brand-500/20 p-1 text-brand-300 transition-colors group-hover:bg-white/20 group-hover:text-white">
          <svg
            class="size-4.5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path :d="assistantLink.icon" />
          </svg>
        </div>
        <span
          class="transition-opacity duration-300 whitespace-nowrap"
          :class="ui.sidebarCollapsed ? 'opacity-0 w-0 hidden' : 'opacity-100'"
        >
          Back to the assistant
        </span>
        <span v-if="ui.sidebarCollapsed" class="sr-only">{{ assistantLink.label }}</span>
      </RouterLink>
    </div>

    <nav
      class="flex-1 overflow-y-auto overflow-x-hidden border-t border-slate-800/50 px-3 pb-6 pt-4 custom-scrollbar"
      aria-label="Back office"
    >
      <div v-for="section in sections" :key="section.title" class="mt-6 first:mt-0">
        <p
          class="px-3 pb-2 text-[0.65rem] font-bold uppercase tracking-widest text-slate-500 transition-opacity duration-300"
          :class="ui.sidebarCollapsed ? 'opacity-0 hidden' : 'opacity-100'"
        >
          {{ section.title }}
        </p>
        <ul class="space-y-1.5">
          <li v-for="item in section.items" :key="item.label">
            <RouterLink
              v-if="item.to"
              :to="item.to"
              class="group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-slate-800 hover:text-white overflow-hidden"
              active-class="bg-brand-600/10 text-brand-400"
              :title="ui.sidebarCollapsed ? item.label : undefined"
              @click="emit('navigate')"
            >
              <!-- Active state indicator -->
              <div class="absolute left-0 top-1/2 h-1/2 w-1 -translate-y-1/2 rounded-r-full bg-brand-500 opacity-0 transition-opacity" />
              
              <svg
                class="size-5 shrink-0 text-slate-400 transition-colors group-hover:text-white"
                :class="{'text-brand-400': false /* Use router active class to style svg via parent */}"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path :d="item.icon" />
              </svg>
              <span
                class="transition-opacity duration-300 whitespace-nowrap"
                :class="ui.sidebarCollapsed ? 'opacity-0 w-0 hidden' : 'opacity-100'"
              >
                {{ item.label }}
              </span>
              <span v-if="ui.sidebarCollapsed" class="sr-only">{{ item.label }}</span>
            </RouterLink>

            <span
              v-else
              aria-disabled="true"
              class="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 opacity-70"
              :title="`${item.label} — available in a later phase`"
            >
              <svg
                class="size-5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path :d="item.icon" />
              </svg>
              <span
                class="transition-opacity duration-300 whitespace-nowrap"
                :class="ui.sidebarCollapsed ? 'opacity-0 w-0 hidden' : 'opacity-100'"
              >
                {{ item.label }}
              </span>
            </span>
          </li>
        </ul>
      </div>
    </nav>
  </aside>
</template>

<style scoped>
/* Optional: Custom scrollbar for the navigation area to look more elegant */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: #334155;
  border-radius: 10px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: #475569;
}
/* For Firefox */
.custom-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: #334155 transparent;
}

/* Add active state styles for the pseudo-element via router-link-exact-active */
:deep(.router-link-exact-active) div.absolute {
  opacity: 1 !important;
}
:deep(.router-link-exact-active) svg {
  @apply text-brand-400 !important;
}
</style>
