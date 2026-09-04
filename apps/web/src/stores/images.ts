import type { ImageAsset } from '@hadiya/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { toErrorMessage } from '@/services/api-error';
import {
  imageService,
  type GenerateImagePayload,
  type ListImagesParams,
} from '@/services/image.service';

/**
 * Image state for the UI.
 *
 * `isGenerating` is separate from `isLoading` because it is a different
 * experience: a gallery load blanks a list for a moment, while generating runs
 * for up to a minute and the rest of the page must stay usable.
 *
 * Object URLs are cached per image and revoked on reset, so a long session
 * browsing the gallery does not accumulate blobs it can never free.
 */
export const useImagesStore = defineStore('images', () => {
  const images = ref<ImageAsset[]>([]);
  const isLoading = ref(false);
  const isGenerating = ref(false);
  const error = ref<string | null>(null);
  const note = ref<string | null>(null);

  const objectUrls = new Map<string, string>();

  const hasImages = computed(() => images.value.length > 0);

  const run = async <TResult>(
    flag: { value: boolean },
    action: () => Promise<TResult>,
  ): Promise<TResult | null> => {
    flag.value = true;
    error.value = null;

    try {
      return await action();
    } catch (caught) {
      error.value = toErrorMessage(caught);

      return null;
    } finally {
      flag.value = false;
    }
  };

  const load = async (params: ListImagesParams = {}): Promise<void> => {
    const result = await run(isLoading, () => imageService.list({ pageSize: 24, ...params }));

    if (result) {
      images.value = result.items;
    }
  };

  const generate = async (payload: GenerateImagePayload): Promise<ImageAsset[]> => {
    note.value = null;

    const result = await run(isGenerating, () => imageService.generate(payload));

    if (!result) {
      return [];
    }

    note.value = result.note;
    images.value = [...result.images, ...images.value];

    return result.images;
  };

  const attach = async (id: string, contentItemId: string | null): Promise<void> => {
    const updated = await run(isLoading, () => imageService.attach(id, contentItemId));

    if (updated) {
      images.value = images.value.map((image) => (image.id === id ? updated : image));
    }
  };

  const remove = async (id: string): Promise<void> => {
    const done = await run(isLoading, async () => {
      await imageService.remove(id);

      return true;
    });

    if (done) {
      images.value = images.value.filter((image) => image.id !== id);
      releaseObjectUrl(id);
    }
  };

  /** The bytes, fetched once per image and remembered for this session. */
  const objectUrlFor = async (id: string): Promise<string | null> => {
    const cached = objectUrls.get(id);

    if (cached) {
      return cached;
    }

    try {
      const url = await imageService.fetchBlobUrl(id);
      objectUrls.set(id, url);

      return url;
    } catch (caught) {
      error.value = toErrorMessage(caught);

      return null;
    }
  };

  const releaseObjectUrl = (id: string): void => {
    const url = objectUrls.get(id);

    if (url) {
      URL.revokeObjectURL(url);
      objectUrls.delete(id);
    }
  };

  const reset = (): void => {
    for (const url of objectUrls.values()) {
      URL.revokeObjectURL(url);
    }

    objectUrls.clear();
    images.value = [];
    error.value = null;
    note.value = null;
  };

  return {
    images,
    hasImages,
    isLoading,
    isGenerating,
    error,
    note,
    load,
    generate,
    attach,
    remove,
    objectUrlFor,
    releaseObjectUrl,
    reset,
  };
});
