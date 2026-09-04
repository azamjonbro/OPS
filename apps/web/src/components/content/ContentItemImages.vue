<script setup lang="ts">
import type { ImageAsset } from '@hadiya/shared';
import { onMounted, ref } from 'vue';

import ImageGenerateForm from '@/components/images/ImageGenerateForm.vue';
import ImageThumbnail from '@/components/images/ImageThumbnail.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { imageService } from '@/services/image.service';
import { useImagesStore } from '@/stores/images';

/**
 * The images attached to one day of a plan.
 *
 * It keeps its own list rather than reading the gallery store's, because the
 * gallery holds *all* of a person's images and this is a filtered view of one
 * day; sharing the array would mean one screen's filter emptying the other.
 */
const props = defineProps<{ contentItemId: string }>();

const images = useImagesStore();
const attached = ref<ImageAsset[]>([]);
const isLoading = ref(false);
const showForm = ref(false);

const load = async (): Promise<void> => {
  isLoading.value = true;

  try {
    const result = await imageService.list({ contentItemId: props.contentItemId, pageSize: 12 });
    attached.value = result.items;
  } finally {
    isLoading.value = false;
  }
};

const detach = async (id: string): Promise<void> => {
  await images.attach(id, null);
  await load();
};

const remove = async (id: string): Promise<void> => {
  await images.remove(id);
  await load();
};

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <span class="text-xs font-medium uppercase tracking-wide text-ink-500">
        Images ({{ attached.length }})
      </span>
      <BaseButton size="sm" variant="ghost" @click="showForm = !showForm">
        {{ showForm ? 'Cancel' : 'Generate one' }}
      </BaseButton>
    </div>

    <div v-if="showForm" class="rounded-lg bg-surface-muted p-3">
      <ImageGenerateForm
        :content-item-id="contentItemId"
        @generated="
          () => {
            showForm = false;
            load();
          }
        "
      />
    </div>

    <p v-if="isLoading" class="text-xs text-ink-500">Loading…</p>

    <ul v-else-if="attached.length > 0" class="grid grid-cols-3 gap-2 sm:grid-cols-4">
      <li v-for="image in attached" :key="image.id" class="flex flex-col gap-1">
        <ImageThumbnail :image="image" />
        <div class="flex items-center gap-1">
          <BaseButton size="sm" variant="ghost" @click="detach(image.id)">Detach</BaseButton>
          <BaseButton size="sm" variant="ghost" @click="remove(image.id)">Delete</BaseButton>
        </div>
      </li>
    </ul>
  </div>
</template>
