import { customRef, type Ref } from 'vue';

/**
 * A ref that settles rather than fires.
 *
 * Search boxes are the reason: binding a query straight to a request means one
 * call per keystroke, most of them already stale by the time they land. The
 * value updates immediately for the input's own sake and notifies watchers only
 * once typing pauses.
 */
export const useDebouncedRef = <TValue>(initial: TValue, delayMs = 300): Ref<TValue> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let value = initial;

  return customRef<TValue>((track, trigger) => ({
    get() {
      track();

      return value;
    },
    set(next) {
      value = next;
      clearTimeout(timer);
      timer = setTimeout(trigger, delayMs);
    },
  }));
};
