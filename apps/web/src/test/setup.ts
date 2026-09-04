import { config } from '@vue/test-utils';
import { afterEach, vi } from 'vitest';

import { resetToasts } from '@/composables/useToast';

/**
 * One place the DOM is made predictable.
 *
 * `matchMedia` is missing in happy-dom and the UI store reads it to resolve the
 * system theme; stubbing it here means no component has to defend against the
 * environment. Storage is cleared between cases so a remembered sidebar or
 * theme cannot leak from one test into the next.
 */
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** `RouterLink` is stubbed globally; routing itself is tested with a real router. */
config.global.stubs = {
  RouterLink: {
    props: ['to'],
    template: '<a><slot /></a>',
  },
};

afterEach(() => {
  window.localStorage.clear();
  resetToasts();
  vi.restoreAllMocks();
});
