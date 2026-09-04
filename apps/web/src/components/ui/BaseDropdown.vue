<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * A menu hung off a trigger.
 *
 * Closes on outside click, on Escape and on choosing something. The trigger
 * carries `aria-expanded` and `aria-haspopup` so assistive technology knows it
 * opens a menu rather than navigating somewhere.
 */
withDefaults(defineProps<{ align?: 'left' | 'right'; label?: string }>(), {
  align: 'right',
  label: 'Open menu',
});

const isOpen = ref(false);
const root = ref<HTMLElement | null>(null);

const close = (): void => {
  isOpen.value = false;
};

const onDocumentPointerDown = (event: PointerEvent): void => {
  if (isOpen.value && root.value && !root.value.contains(event.target as Node)) {
    close();
  }
};

const onDocumentKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && isOpen.value) {
    close();
  }
};

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onDocumentKeydown);
});

defineExpose({ close });
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="flex items-center gap-2 rounded-lg text-sm"
      :aria-expanded="isOpen"
      aria-haspopup="menu"
      :aria-label="label"
      @click="isOpen = !isOpen"
    >
      <slot name="trigger" :open="isOpen" />
    </button>

    <div
      v-if="isOpen"
      role="menu"
      class="absolute z-30 mt-2 min-w-48 overflow-hidden rounded-xl bg-surface py-1 shadow-lg ring-1 ring-border-subtle"
      :class="align === 'right' ? 'right-0' : 'left-0'"
      @click="close"
    >
      <slot :close="close" />
    </div>
  </div>
</template>
