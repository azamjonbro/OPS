<script setup lang="ts">
import { RouterView } from 'vue-router';

import ToastHost from '@/components/ui/ToastHost.vue';

/**
 * Mounted once, outside the router view, so a toast raised on one page is not
 * unmounted by navigating away from it.
 */
</script>

<template>
  <RouterView />
  <ToastHost />
</template>
