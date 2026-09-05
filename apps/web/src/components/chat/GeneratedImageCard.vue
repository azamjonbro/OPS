<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

import type { GeneratedImageBlock } from '@/chat/message-content';
import BaseModal from '@/components/ui/BaseModal.vue';
import { useImagesStore } from '@/stores/images';

/**
 * An image the assistant drew, inside the conversation.
 *
 * The bytes sit behind an authenticated endpoint, so an `img src` pointing at
 * the API would come back 401 — an element cannot carry a bearer token. The
 * store fetches once and hands back an object URL, cached by image id, which is
 * also what stops a re-render from re-fetching. Nothing here can cause a second
 * generation: this component only ever *reads* an image that already exists.
 */
const props = defineProps<{ images: GeneratedImageBlock[] }>();

const gallery = useImagesStore();
const sources = ref(new Map<string, string>());
const preview = ref<GeneratedImageBlock | null>(null);
const isPreviewOpen = ref(false);

const load = async (): Promise<void> => {
  for (const image of props.images) {
    if (image.status !== 'completed' || sources.value.has(image.id)) {
      continue;
    }

    const url = await gallery.objectUrlFor(image.id);

    if (url) {
      sources.value = new Map(sources.value).set(image.id, url);
    }
  }
};

watch(() => props.images.map((image) => image.id).join(','), load, { immediate: true });

// The store owns the cache; releasing here would break the same image shown in
// the gallery on another screen.
onBeforeUnmount(() => {
  sources.value = new Map();
});

const openPreview = (image: GeneratedImageBlock): void => {
  preview.value = image;
  isPreviewOpen.value = true;
};
</script>

<template>
  <div class="flex flex-col gap-3 my-2">
    <ul
      class="grid gap-3"
      :class="images.length > 1 ? 'grid-cols-2 sm:grid-cols-3' : 'max-w-sm grid-cols-1'"
    >
      <li v-for="image in images" :key="image.id">
        <button
          v-if="sources.get(image.id)"
          type="button"
          class="group block w-full overflow-hidden rounded-[14px] ring-1 ring-border-subtle shadow-sm transition-all hover:shadow-md hover:ring-brand-500/50 focus:outline-none focus:ring-2 focus:ring-brand-500"
          :aria-label="`Open a larger view of ${image.prompt}`"
          @click="openPreview(image)"
        >
          <img
            :src="sources.get(image.id)"
            :alt="image.revisedPrompt ?? image.prompt"
            class="aspect-square w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        </button>

        <div
          v-else-if="image.status === 'failed'"
          class="grid aspect-square place-items-center rounded-[14px] bg-danger-50 p-4 text-center text-[12px] text-danger-700 ring-1 ring-danger-600/30"
        >
          The image could not be created.
        </div>

        <div
          v-else
          class="grid aspect-square animate-pulse place-items-center rounded-xl bg-surface-muted text-xs text-ink-500 ring-1 ring-border-subtle"
        >
          {{ image.status === 'generating' ? 'Creating…' : 'Loading…' }}
        </div>
      </li>
    </ul>

    <p v-if="images[0]?.prompt" class="text-xs text-ink-500">{{ images[0].prompt }}</p>
  </div>

  <BaseModal
    v-model:open="isPreviewOpen"
    :title="preview?.prompt ?? 'Generated image'"
    :description="preview?.revisedPrompt ?? undefined"
    size="lg"
  >
    <img
      v-if="preview && sources.get(preview.id)"
      :src="sources.get(preview.id)"
      :alt="preview.revisedPrompt ?? preview.prompt"
      class="mx-auto max-h-[70vh] w-auto rounded-lg"
    />
  </BaseModal>
</template>
