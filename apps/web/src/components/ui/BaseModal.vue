<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';

/**
 * A modal dialog.
 *
 * Three things make a dialog accessible and each is here deliberately: focus
 * moves into it on open and returns to whatever opened it on close, Escape
 * dismisses it, and Tab is trapped inside so the keyboard cannot wander onto
 * the page behind. Without the trap, a screen-reader user can silently end up
 * interacting with content the overlay is hiding.
 *
 * Body scrolling is locked while it is open, which is what stops the page
 * underneath from moving on a phone.
 */
const open = defineModel<boolean>('open', { required: true });

const props = withDefaults(
  defineProps<{ title: string; description?: string; size?: 'sm' | 'md' | 'lg' }>(),
  { description: undefined, size: 'md' },
);

const emit = defineEmits<{ close: [] }>();

const id = useId();
const panel = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

const SIZES = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' } as const;

const close = (): void => {
  open.value = false;
  emit('close');
};

const focusableWithin = (): HTMLElement[] =>
  [
    ...(panel.value?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []),
  ].filter((element) => element.offsetParent !== null);

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    event.stopPropagation();
    close();

    return;
  }

  if (event.key !== 'Tab') {
    return;
  }

  const focusable = focusableWithin();
  const first = focusable[0];
  const last = focusable.at(-1);

  if (!first || !last) {
    event.preventDefault();

    return;
  }

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

watch(
  open,
  async (isOpen) => {
    if (isOpen) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      document.body.style.overflow = 'hidden';
      await nextTick();
      (focusableWithin()[0] ?? panel.value)?.focus();

      return;
    }

    document.body.style.overflow = '';
    // Returning focus is what lets a keyboard user carry on where they were.
    previouslyFocused?.focus?.();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      @keydown="onKeydown"
    >
      <div class="absolute inset-0 bg-slate-900/50" aria-hidden="true" @click="close" />

      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`${id}-title`"
        :aria-describedby="description ? `${id}-description` : undefined"
        tabindex="-1"
        class="relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-xl ring-1 ring-border-subtle sm:rounded-2xl"
        :class="SIZES[props.size]"
      >
        <header class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div>
            <h2 :id="`${id}-title`" class="text-base font-semibold text-ink-900">{{ title }}</h2>
            <p v-if="description" :id="`${id}-description`" class="mt-0.5 text-sm text-ink-500">
              {{ description }}
            </p>
          </div>
          <button
            type="button"
            class="rounded-lg p-1 text-ink-500 hover:bg-surface-muted hover:text-ink-900"
            aria-label="Close dialog"
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
          class="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle px-5 py-4"
        >
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
