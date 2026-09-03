<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <div class="grid min-h-full place-items-center px-4 py-16 text-center">
    <div>
      <p class="text-sm font-semibold text-brand-600">404</p>
      <h1 class="mt-2 text-2xl font-semibold text-ink-900">This page does not exist</h1>
      <p class="mt-2 text-sm text-ink-500">
        The address may be mistyped, or the module is not part of this release yet.
      </p>
      <RouterLink
        :to="{ name: 'dashboard' }"
        class="mt-6 inline-flex h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
      >
        Back to dashboard
      </RouterLink>
    </div>
  </div>
</template>
