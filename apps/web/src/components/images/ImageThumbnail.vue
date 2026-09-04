<script setup lang="ts">
import type { ImageAsset } from '@hadiya/shared';
import { onBeforeUnmount, ref, watch } from 'vue';

import { useImagesStore } from '@/stores/images';

/**
 * One image, fetched with the viewer's token.
 *
 * The bytes are behind an authenticated endpoint, so an `<img src>` pointing at
 * the API would come back 401 — the element cannot carry a header. The store
 * downloads the file once and hands back an object URL instead, which is also
 * why the failed and generating states are rendered here rather than left as a
 * broken image icon.
 */
const props = defineProps<{ image: ImageAsset }>();

const images = useImagesStore();
const source = ref<string | null>(null);
const isLoading = ref(false);

const load = async (): Promise<void> => {
  source.value = null;

  if (props.image.status !== 'completed') {
    return;
  }

  isLoading.value = true;
  source.value = await images.objectUrlFor(props.image.id);
  isLoading.value = false;
};

watch(() => [props.image.id, props.image.status], load, { immediate: true });

// The store owns the cache; releasing here would break a second view of the
// same image on another screen.
onBeforeUnmount(() => {
  source.value = null;
});
</script>

<template>
  <div
    class="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-surface-muted ring-1 ring-border-subtle"
  >
    <img
      v-if="source"
      :src="source"
      :alt="image.revisedPrompt ?? image.prompt"
      class="size-full object-cover"
    />
    <p v-else-if="image.status === 'failed'" class="px-3 text-center text-xs text-rose-600">
      {{ image.failureReason ?? 'Generation failed' }}
    </p>
    <p v-else-if="image.status === 'generating'" class="text-xs text-ink-500">Generating…</p>
    <p v-else-if="isLoading" class="text-xs text-ink-500">Loading…</p>
    <p v-else class="px-3 text-center text-xs text-ink-500">No preview</p>
  </div>
</template>
