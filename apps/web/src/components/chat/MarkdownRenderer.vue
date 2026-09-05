<script setup lang="ts">
import { computed } from 'vue';

import { renderMarkdown } from '@/chat/markdown';

/**
 * Assistant prose.
 *
 * `v-html` is safe here for one reason: `renderMarkdown` escapes every character
 * before it adds a single tag, so the string it returns contains only markup the
 * renderer itself created. Nothing the model wrote can become an element.
 *
 * The styling lives here rather than in a global stylesheet because these
 * elements exist nowhere else in the application, and a table inside a chat
 * bubble needs to scroll rather than widen the page.
 */
const props = defineProps<{ text: string }>();

const html = computed(() => renderMarkdown(props.text));
</script>

<template>
  <!--
    The usual objection to `v-html` does not apply here: `renderMarkdown`
    HTML-escapes every character before it adds a single tag, so this string
    contains only markup the renderer itself produced. `markdown.test.ts` holds
    that down — script tags, event handlers and `javascript:` links all come out
    as text.
  -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="markdown-body text-[15px] leading-[1.65] text-ink-900" v-html="html" />
</template>

<style scoped>
.markdown-body :deep(p) {
  margin: 0 0 0.75rem;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  margin: 1rem 0 0.5rem;
  font-weight: 600;
  line-height: 1.3;
}

.markdown-body :deep(h1) {
  font-size: 1.125rem;
}

.markdown-body :deep(h2) {
  font-size: 1.0625rem;
}

.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  font-size: 1rem;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0 0 0.75rem;
  padding-left: 1.25rem;
}

.markdown-body :deep(ul) {
  list-style: disc;
}

.markdown-body :deep(ol) {
  list-style: decimal;
}

.markdown-body :deep(li) {
  margin: 0.15rem 0;
}

.markdown-body :deep(a) {
  color: var(--color-brand-700);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-body :deep(code) {
  padding: 0.1rem 0.3rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border-subtle);
  border-radius: 0.3rem;
}

.markdown-body :deep(pre) {
  margin: 0 0 0.75rem;
  padding: 0.75rem 0.9rem;
  overflow-x: auto;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border-subtle);
  border-radius: 0.6rem;
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: none;
  border: 0;
  font-size: 0.8125rem;
  line-height: 1.6;
}

.markdown-body :deep(blockquote) {
  margin: 0 0 0.75rem;
  padding-left: 0.75rem;
  border-left: 3px solid var(--color-border-strong);
  color: var(--color-ink-700);
}

/* A wide table scrolls inside the bubble rather than widening the page. */
.markdown-body :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  margin: 0 0 0.75rem;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--color-border-subtle);
  text-align: left;
}

.markdown-body :deep(th) {
  background: var(--color-surface-muted);
  font-weight: 600;
}
</style>
