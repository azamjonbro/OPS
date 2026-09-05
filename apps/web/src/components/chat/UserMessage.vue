<script setup lang="ts">
import MessageBubble from './MessageBubble.vue';

/**
 * What the person said.
 *
 * Rendered as plain text, never as markdown: their words are theirs, and a
 * shopkeeper who types `*asterisk*` around a product code means the asterisks.
 * `whitespace-pre-wrap` keeps the line breaks they actually typed.
 */
defineProps<{ content: string; createdAt?: string | null; pending?: boolean }>();
</script>

<template>
  <MessageBubble role="user" :created-at="createdAt" :pending="pending">
    <div
      class="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm leading-relaxed text-white"
    >
      {{ content }}
    </div>

    <template #actions>
      <span v-if="pending" class="text-ink-400">Sending…</span>
    </template>
  </MessageBubble>
</template>
