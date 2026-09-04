<script setup lang="ts">
import type { ImageAsset } from '@hadiya/shared';
import { ref } from 'vue';

import ImageThumbnail from '@/components/images/ImageThumbnail.vue';
import BaseButton from '@/components/ui/BaseButton.vue';

/** One gallery tile: the picture, what it was asked for, and what can be done. */
defineProps<{ image: ImageAsset; busy: boolean; attachable?: boolean }>();

const emit = defineEmits<{
  attach: [id: string];
  detach: [id: string];
  remove: [id: string];
}>();

const isConfirmingDelete = ref(false);
</script>

<template>
  <li class="flex flex-col gap-2 rounded-xl bg-white p-3 ring-1 ring-border-subtle">
    <ImageThumbnail :image="image" />

    <p class="line-clamp-3 text-xs text-ink-700" :title="image.prompt">{{ image.prompt }}</p>
    <p class="text-xs text-ink-500">
      {{ image.aspectRatio }}
      <span v-if="image.width && image.height"> · {{ image.width }}×{{ image.height }}</span>
      <span v-if="image.style"> · {{ image.style }}</span>
      · {{ image.status }}
    </p>

    <div class="mt-auto flex flex-wrap items-center gap-2 pt-1">
      <BaseButton
        v-if="attachable && !image.contentItem && image.status === 'completed'"
        size="sm"
        variant="secondary"
        :disabled="busy"
        @click="emit('attach', image.id)"
      >
        Attach
      </BaseButton>
      <BaseButton
        v-else-if="image.contentItem"
        size="sm"
        variant="ghost"
        :disabled="busy"
        @click="emit('detach', image.id)"
      >
        Detach
      </BaseButton>

      <template v-if="isConfirmingDelete">
        <span class="text-xs text-ink-500">Delete?</span>
        <BaseButton size="sm" variant="secondary" :disabled="busy" @click="emit('remove', image.id)">
          Yes
        </BaseButton>
        <BaseButton size="sm" variant="ghost" @click="isConfirmingDelete = false">No</BaseButton>
      </template>
      <BaseButton v-else size="sm" variant="ghost" @click="isConfirmingDelete = true">
        Delete
      </BaseButton>
    </div>
  </li>
</template>
