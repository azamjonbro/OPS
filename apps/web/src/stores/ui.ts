import { defineStore } from 'pinia';
import { onBeforeUnmount, ref, watch } from 'vue';

const SIDEBAR_STORAGE_KEY = 'hadiya.ui.sidebarCollapsed';
const THEME_STORAGE_KEY = 'hadiya.ui.theme';

export type ThemePreference = 'light' | 'dark' | 'system';

/** Reading storage must never be what stops the application from starting. */
const readStorage = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A private window with storage blocked still gets a working interface.
  }
};

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'light' || value === 'dark' || value === 'system';

/**
 * Chrome state: the sidebar, and the theme.
 *
 * `system` is the default and a real third option rather than a synonym for
 * light — somebody whose laptop switches at sunset expects this to follow, and
 * that only works if the preference stays "system" instead of being resolved
 * once and frozen.
 */
export const useUiStore = defineStore('ui', () => {
  const sidebarCollapsed = ref(readStorage(SIDEBAR_STORAGE_KEY) === 'true');
  /** Drives the off-canvas sidebar on small screens. */
  const mobileSidebarOpen = ref(false);

  const stored = readStorage(THEME_STORAGE_KEY);
  const theme = ref<ThemePreference>(isThemePreference(stored) ? stored : 'system');

  const media =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  const apply = (): void => {
    const resolved = theme.value === 'system' ? (media?.matches ? 'dark' : 'light') : theme.value;

    document.documentElement.dataset.theme = resolved;
  };

  const onSystemChange = (): void => {
    if (theme.value === 'system') {
      apply();
    }
  };

  media?.addEventListener?.('change', onSystemChange);
  onBeforeUnmount(() => media?.removeEventListener?.('change', onSystemChange));

  watch(theme, (next) => {
    writeStorage(THEME_STORAGE_KEY, next);
    apply();
  });

  watch(sidebarCollapsed, (collapsed) => {
    writeStorage(SIDEBAR_STORAGE_KEY, String(collapsed));
  });

  apply();

  const toggleSidebar = (): void => {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  };

  const toggleMobileSidebar = (open?: boolean): void => {
    mobileSidebarOpen.value = open ?? !mobileSidebarOpen.value;
  };

  const setTheme = (next: ThemePreference): void => {
    theme.value = next;
  };

  return {
    sidebarCollapsed,
    mobileSidebarOpen,
    theme,
    toggleSidebar,
    toggleMobileSidebar,
    setTheme,
  };
});
