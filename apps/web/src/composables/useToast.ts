import { readonly, ref, type DeepReadonly, type Ref } from 'vue';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

/**
 * Transient messages, held outside Pinia.
 *
 * A toast is not application state: nothing reads it, nothing derives from it,
 * and it is gone in four seconds. A module-level list is the honest shape, and
 * it keeps `useToast()` callable from a service or a composable without needing
 * an active Pinia instance.
 */
const items = ref<Toast[]>([]);
let nextId = 1;

const DEFAULT_DURATION_MS = 4_000;
/** Errors stay longer: they usually need reading twice. */
const ERROR_DURATION_MS = 7_000;

const dismiss = (id: number): void => {
  items.value = items.value.filter((toast) => toast.id !== id);
};

const push = (message: string, tone: ToastTone): number => {
  const id = nextId;
  nextId += 1;

  items.value = [...items.value, { id, message, tone }];

  setTimeout(() => dismiss(id), tone === 'error' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS);

  return id;
};

export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

export const useToast = (): ToastApi => ({
  success: (message) => void push(message, 'success'),
  error: (message) => void push(message, 'error'),
  info: (message) => void push(message, 'info'),
});

/** Used by the host component only. */
export const useToasts = (): {
  toasts: DeepReadonly<Ref<Toast[]>>;
  dismiss: (id: number) => void;
} => ({ toasts: readonly(items), dismiss });

/** Testing seam: clears anything left over between cases. */
export const resetToasts = (): void => {
  items.value = [];
};
