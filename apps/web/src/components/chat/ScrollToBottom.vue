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
      class="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-ink-700 shadow-md ring-1 ring-border-subtle hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-brand-600"
      @click="emit('click')"
    >
      <svg
        class="size-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
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
