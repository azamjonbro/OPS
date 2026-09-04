<script setup lang="ts">
import {
  ASPECT_RATIO_GUIDANCE,
  IMAGE_ASPECT_RATIOS,
  IMAGE_MAX_COUNT,
  IMAGE_STYLES,
  type ImageAspectRatio,
  type ImageStyle,
} from '@hadiya/shared';
import { reactive } from 'vue';

import BaseButton from '@/components/ui/BaseButton.vue';
import { useImagesStore } from '@/stores/images';

/**
 * The generation form.
 *
 * `contentItemId` is passed straight through when the form is opened from a
 * content day, so the image is attached at generation time rather than needing
 * a second step the person might forget.
 */
const props = withDefaults(defineProps<{ contentItemId?: string | null }>(), {
  contentItemId: null,
});

const emit = defineEmits<{ generated: [] }>();

const images = useImagesStore();

const form = reactive({
  prompt: '',
  aspectRatio: '1:1' as ImageAspectRatio,
  style: '' as ImageStyle | '',
  count: 1,
});

const submit = async (): Promise<void> => {
  const created = await images.generate({
    prompt: form.prompt,
    aspectRatio: form.aspectRatio,
    ...(form.style ? { style: form.style } : {}),
    count: form.count,
    ...(props.contentItemId ? { contentItemId: props.contentItemId } : {}),
  });

  if (created.length > 0) {
    form.prompt = '';
    emit('generated');
  }
};

const fieldClasses =
  'h-10 w-full rounded-lg px-3 text-sm text-ink-900 ring-1 ring-inset ring-border-subtle focus:outline-none focus:ring-2 focus:ring-brand-600';
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="submit">
    <label class="flex flex-col gap-1">
      <span class="text-xs font-medium uppercase tracking-wide text-ink-500"
        >Describe the image</span
      >
      <textarea
        v-model="form.prompt"
        required
        rows="3"
        minlength="3"
        maxlength="1500"
        :class="[fieldClasses, 'h-auto py-2']"
        placeholder="A gold wristwatch on a marble surface, soft daylight"
      />
    </label>

    <div class="grid gap-4 sm:grid-cols-4">
      <label class="flex flex-col gap-1">
        <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Shape</span>
        <select v-model="form.aspectRatio" :class="fieldClasses">
          <option
            v-for="ratio in IMAGE_ASPECT_RATIOS"
            :key="ratio"
            :value="ratio"
            :title="ASPECT_RATIO_GUIDANCE[ratio]"
          >
            {{ ratio }}
          </option>
        </select>
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Style</span>
        <select v-model="form.style" :class="fieldClasses">
          <option value="">Default</option>
          <option v-for="style in IMAGE_STYLES" :key="style" :value="style">{{ style }}</option>
        </select>
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Variations</span>
        <input
          v-model.number="form.count"
          type="number"
          min="1"
          :max="IMAGE_MAX_COUNT"
          :class="fieldClasses"
        />
      </label>

      <div class="flex items-end">
        <BaseButton type="submit" block :loading="images.isGenerating">
          {{ images.isGenerating ? 'Drawing…' : 'Generate' }}
        </BaseButton>
      </div>
    </div>

    <p v-if="images.isGenerating" class="text-sm text-ink-500">
      This can take up to a minute. You can keep working.
    </p>
    <p v-else-if="images.error" class="text-sm text-rose-600">{{ images.error }}</p>
    <p v-else-if="images.note" class="text-sm text-amber-700">{{ images.note }}</p>
  </form>
</template>
