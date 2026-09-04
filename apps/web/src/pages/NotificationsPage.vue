<script setup lang="ts">
import NotificationList from '@/components/notifications/NotificationList.vue';
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-5">
    <div>
      <h2 class="text-xl font-semibold text-ink-900">Notifications</h2>
      <p class="mt-1 text-sm text-ink-500">Reminders and system messages delivered to you.</p>
    </div>

    <NotificationList />
  </div>
</template>
