<script setup lang="ts">
/**
 * A step that did not work.
 *
 * Deliberately quiet. When a tool fails the assistant usually carries on and
 * answers anyway — it draws the picture, it just could not check the catalogue
 * first — so a loud red panel would overstate what went wrong and bury the
 * answer that did arrive.
 *
 * The raw upstream text is *not* the message. It is written for whoever reads
 * the logs and can carry a host, a path or a status code; a shopkeeper reading
 * "Billz answered 405 for /v1/auth/login" learns nothing except that the
 * product leaks. It sits behind a toggle instead, for whoever is debugging.
 */
defineProps<{ message: string; detail?: string | null }>();
</script>

<template>
  <div
    class="flex flex-col gap-1.5 rounded-lg bg-surface-muted px-3 py-2 text-xs ring-1 ring-border-subtle"
  >
    <p class="flex items-center gap-2 text-ink-500">
      <svg
        class="size-3.5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M12 8v5M12 16h.01M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Z" />
      </svg>
      <span class="min-w-0">{{ message }}</span>
    </p>

    <details v-if="detail" class="pl-5.5">
      <summary class="cursor-pointer list-none text-ink-400 hover:text-ink-700">Details</summary>
      <p class="mt-1.5 whitespace-pre-line break-words text-ink-500">{{ detail }}</p>
    </details>
  </div>
</template>
