<script setup lang="ts">
import { RouterView } from 'vue-router';

import AppSidebar from '@/components/layout/AppSidebar.vue';
import AppTopbar from '@/components/layout/AppTopbar.vue';
import { useUiStore } from '@/stores/ui';

const ui = useUiStore();
</script>

<template>
  <div class="flex h-full">
    <div class="hidden lg:block">
      <AppSidebar />
    </div>

    <!-- Off-canvas sidebar for small screens -->
    <div v-if="ui.mobileSidebarOpen" class="fixed inset-0 z-40 lg:hidden">
      <div
        class="absolute inset-0 bg-slate-900/50"
        aria-hidden="true"
        @click="ui.toggleMobileSidebar(false)"
      />
      <div class="absolute inset-y-0 left-0">
        <AppSidebar />
      </div>
    </div>

    <div class="flex min-w-0 flex-1 flex-col">
      <AppTopbar />
      <main class="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
