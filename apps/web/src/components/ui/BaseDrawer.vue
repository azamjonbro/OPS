<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';

defineProps<{ title: string; description?: string }>();

const emit = defineEmits<{ close: [] }>();

/**
 * A side panel, for detail that should not lose the list behind it.
 *
 * Shares the modal's accessibility contract — focus moved in and restored,
 * Escape to close, scroll locked — because a drawer is a dialog that happens to
 * slide. On a phone it becomes full width, since a 28rem panel on a 20rem
 * screen is just a modal with the edges cut off.
 */
const open = defineModel<boolean>('open', { required: true });

const id = useId();
const panel = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

const close = (): void => {
  open.value = false;
  emit('close');
};

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    close();
  }
};

watch(open, async (isOpen) => {
  if (isOpen) {
    previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    await nextTick();
    panel.value?.focus();

    return;
  }

  document.body.style.overflow = '';
  previouslyFocused?.focus?.();
});

onBeforeUnmount(() => {
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50" @keydown="onKeydown">
      <div class="absolute inset-0 bg-slate-900/50" aria-hidden="true" @click="close" />

      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`${id}-title`"
        tabindex="-1"
        class="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-surface shadow-xl"
      >
        <header
          class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4"
        >
          <div>
            <h2 :id="`${id}-title`" class="text-base font-semibold text-ink-900">{{ title }}</h2>
            <p v-if="description" class="mt-0.5 text-sm text-ink-500">{{ description }}</p>
          </div>
          <button
            type="button"
            class="rounded-lg p-1 text-ink-500 hover:bg-surface-muted hover:text-ink-900"
            aria-label="Close panel"
            @click="close"
          >
            <svg
              class="size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <slot />
        </div>

        <footer
          v-if="$slots.footer"
          class="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-4"
        >
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
