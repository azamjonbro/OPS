<script setup lang="ts">
/**
 * The way back to the newest message.
 *
 * Only rendered once somebody has scrolled away from the end, because a button
 * that says "go to where you already are" is noise. It is a real button rather
 * than a floating icon so the keyboard reaches it.
 */
defineProps<{ visible: boolean }>();

const emit = defineEmits<{ click: [] }>();
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-150"
    enter-from-class="opacity-0"
    leave-active-class="transition-opacity duration-150"
    leave-to-class="opacity-0"
  >
    <button
      v-if="visible"
      type="button"
      class="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-surface px-4 py-2 text-[13px] font-semibold text-ink-900 shadow-[0_4px_16px_rgba(0,0,0,0.1)] ring-1 ring-border-subtle hover:bg-surface-muted hover:shadow-[0_6px_24px_rgba(0,0,0,0.12)] transition-all focus:outline-none focus:ring-2 focus:ring-brand-500"
      @click="emit('click')"
    >
      <svg
        class="size-4 text-ink-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 5v14M19 12l-7 7-7-7" />
      </svg>
      Latest messages
    </button>
  </Transition>
</template>
