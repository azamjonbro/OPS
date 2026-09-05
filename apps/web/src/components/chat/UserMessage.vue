<script setup lang="ts">
import MessageBubble from './MessageBubble.vue';

defineProps<{ content: string; createdAt?: string | null; pending?: boolean }>();
</script>

<template>
  <MessageBubble role="user" :created-at="createdAt" :pending="pending">
    <div
      class="whitespace-pre-wrap break-words rounded-[20px] rounded-br-sm bg-surface-muted px-5 py-3 text-[15px] leading-relaxed text-ink-900"
    >
      {{ content }}
    </div>

    <template #actions>
      <span v-if="pending" class="text-ink-400">Sending…</span>
    </template>
  </MessageBubble>
</template>
