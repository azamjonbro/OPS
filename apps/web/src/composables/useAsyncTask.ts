import { readonly, ref, type Ref } from 'vue';

import { toErrorMessage } from '@/services/api-error';

export interface AsyncTask<TResult, TArgs extends unknown[]> {
  data: Readonly<Ref<TResult | null>>;
  error: Readonly<Ref<string | null>>;
  isLoading: Readonly<Ref<boolean>>;
  run: (...args: TArgs) => Promise<TResult | null>;
}

/**
 * Wraps an async call in the loading/error/data state every view needs, so
 * components do not each re-implement it.
 */
export const useAsyncTask = <TResult, TArgs extends unknown[]>(
  task: (...args: TArgs) => Promise<TResult>,
): AsyncTask<TResult, TArgs> => {
  const data = ref<TResult | null>(null) as Ref<TResult | null>;
  const error = ref<string | null>(null);
  const isLoading = ref(false);

  const run = async (...args: TArgs): Promise<TResult | null> => {
    isLoading.value = true;
    error.value = null;

    try {
      const result = await task(...args);
      data.value = result;

      return result;
    } catch (caught) {
      error.value = toErrorMessage(caught);

      return null;
    } finally {
      isLoading.value = false;
    }
  };

  return {
    data: readonly(data) as Readonly<Ref<TResult | null>>,
    error: readonly(error),
    isLoading: readonly(isLoading),
    run,
  };
};
