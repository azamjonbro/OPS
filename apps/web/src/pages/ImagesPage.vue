<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

import ImageCard from '@/components/images/ImageCard.vue';
import ImageGenerateForm from '@/components/images/ImageGenerateForm.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import { imageService, type ImageProviderStatus } from '@/services/image.service';
import { useImagesStore } from '@/stores/images';

/** The gallery: everything this employee has generated. */
const images = useImagesStore();
const status = ref<ImageProviderStatus | null>(null);

onMounted(async () => {
  await images.load();
  status.value = await imageService.status().catch(() => null);
});

// Object URLs are freed when the gallery closes, so a long session does not
// accumulate blobs it can never release.
onUnmounted(() => images.reset());
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-6">
    <div>
      <h2 class="text-xl font-semibold text-ink-900">Images</h2>
      <p class="mt-1 text-sm text-ink-500">
        Describe a picture and it is drawn for you — or ask the assistant: “shu post uchun rasm
        yarat”.
      </p>
    </div>

    <p
      v-if="status && !status.available"
      class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200"
    >
      Image generation is not configured{{ status.reason ? `: ${status.reason}` : '' }}.
    </p>

    <BaseCard
      title="Generate an image"
      :description="status?.model ? `Using ${status.model}` : undefined"
    >
      <ImageGenerateForm />
    </BaseCard>

    <BaseCard title="Your images" description="Most recent first">
      <template #header>
        <BaseButton
          variant="secondary"
          size="sm"
          :loading="images.isLoading"
          @click="images.load()"
        >
          Refresh
        </BaseButton>
      </template>

      <p v-if="images.isLoading && !images.hasImages" class="text-sm text-ink-500">Loading…</p>

      <p v-else-if="!images.hasImages" class="text-sm text-ink-500">Nothing generated yet.</p>

      <ul v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <ImageCard
          v-for="image in images.images"
          :key="image.id"
          :image="image"
          :busy="images.isLoading"
          @detach="(id) => images.attach(id, null)"
          @remove="(id) => images.remove(id)"
        />
      </ul>
    </BaseCard>
  </div>
</template>
