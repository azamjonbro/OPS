import type { PaginatedResult, PaginationMeta } from '@hadiya/shared';
import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue';

import { toErrorMessage } from '@/services/api-error';

const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
  hasPrevious: false,
  hasNext: false,
};

export interface PaginatedResource<TItem> {
  items: Ref<TItem[]>;
  pagination: Ref<PaginationMeta>;
  page: Ref<number>;
  isLoading: Ref<boolean>;
  error: Ref<string | null>;
  reload: () => Promise<void>;
  goToPage: (page: number) => void;
}

export interface PaginatedResourceOptions {
  pageSize?: number;
  /** Reactive filters; a change resets to page 1 and refetches. */
  watchSources?: Array<() => unknown>;
  immediate?: boolean;
}

/**
 * The list-page pattern, once.
 *
 * Every list in the application does the same four things — fetch a page, track
 * loading and error, reset to page one when a filter changes, and drop a
 * response that arrived after a newer one. That last part is the subtle one: a
 * fast typist can have three searches in flight, and without the sequence check
 * the slowest reply wins and the list disagrees with the search box. An
 * `AbortSignal` is passed through so the request is cancelled too, rather than
 * merely ignored.
 *
 * Deliberately local state, not a store: a product list is not shared with
 * anything, and putting it in Pinia would make two screens fight over one array.
 */
export const usePaginatedResource = <TItem>(
  fetcher: (
    params: { page: number; pageSize: number },
    signal: AbortSignal,
  ) => Promise<PaginatedResult<TItem>>,
  options: PaginatedResourceOptions = {},
): PaginatedResource<TItem> => {
  const pageSize = options.pageSize ?? 20;

  const items = shallowRef<TItem[]>([]) as Ref<TItem[]>;
  const pagination = ref<PaginationMeta>({ ...EMPTY_PAGINATION, pageSize });
  const page = ref(1);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  let sequence = 0;
  let controller: AbortController | null = null;

  const reload = async (): Promise<void> => {
    controller?.abort();
    controller = new AbortController();

    const current = sequence + 1;
    sequence = current;

    isLoading.value = true;
    error.value = null;

    try {
      const result = await fetcher({ page: page.value, pageSize }, controller.signal);

      // A stale reply is discarded rather than rendered.
      if (current !== sequence) {
        return;
      }

      items.value = result.items;
      pagination.value = result.pagination;
    } catch (caught) {
      if (current !== sequence || (caught as { code?: string }).code === 'CANCELLED') {
        return;
      }

      error.value = toErrorMessage(caught);
      items.value = [];
    } finally {
      if (current === sequence) {
        isLoading.value = false;
      }
    }
  };

  const goToPage = (next: number): void => {
    page.value = Math.max(1, next);
  };

  watch(page, () => void reload());

  for (const source of options.watchSources ?? []) {
    watch(source, () => {
      // A new filter invalidates the current page number: page 4 of the old
      // result set is meaningless against the new one.
      if (page.value !== 1) {
        page.value = 1;

        return;
      }

      void reload();
    });
  }

  if (options.immediate !== false) {
    void reload();
  }

  onBeforeUnmount(() => controller?.abort());

  return { items, pagination, page, isLoading, error, reload, goToPage };
};
