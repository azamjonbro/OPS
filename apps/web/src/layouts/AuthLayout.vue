<script setup lang="ts">
import { RouterView } from 'vue-router';

import { appConfig } from '@/config/env';
</script>

<template>
  <div class="grid min-h-full place-items-center px-4 py-12">
    <div class="w-full max-w-sm">
      <div class="mb-8 flex flex-col items-center gap-3">
        <span
          class="grid size-12 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white"
        >
          H
        </span>
        <p class="text-sm text-ink-500">{{ appConfig.appName }} · business management</p>
      </div>

      <RouterView />
    </div>
  </div>
</template>
