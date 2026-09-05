<script setup lang="ts">
import { watch } from 'vue';
import { RouterView, useRoute } from 'vue-router';

import AppSidebar from '@/components/layout/AppSidebar.vue';
import AppTopbar from '@/components/layout/AppTopbar.vue';
import { useUiStore } from '@/stores/ui';

/**
 * The application shell.
 *
 * On desktop the sidebar is part of the layout; below `lg` it becomes an
 * off-canvas panel over a scrim, which is what stops the desktop layout from
 * simply overflowing on a phone. Navigating closes it — leaving it open over
 * the page somebody just chose is the classic mobile-drawer mistake.
 */
const ui = useUiStore();
const route = useRoute();

watch(
  () => route.fullPath,
  () => ui.toggleMobileSidebar(false),
);
</script>

<template>
  <div class="flex h-full">
    <a
      href="#main-content"
      class="sr-only-focusable absolute left-4 top-4 z-[70] rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
    >
      Skip to content
    </a>

    <div class="hidden lg:block">
      <AppSidebar />
    </div>

    <div v-if="ui.mobileSidebarOpen" class="fixed inset-0 z-40 lg:hidden">
      <div
        class="absolute inset-0 bg-slate-900/50"
        aria-hidden="true"
        @click="ui.toggleMobileSidebar(false)"
      />
      <div class="absolute inset-y-0 left-0 shadow-xl">
        <AppSidebar @navigate="ui.toggleMobileSidebar(false)" />
      </div>
    </div>

    <div class="flex min-w-0 flex-1 flex-col">
      <AppTopbar />
      <main id="main-content" class="flex-1 overflow-y-auto px-4 py-6 sm:px-6" tabindex="-1">
        <RouterView />
      </main>
    </div>
  </div>
</template>
