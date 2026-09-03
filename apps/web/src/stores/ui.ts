import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

const SIDEBAR_STORAGE_KEY = 'hadiya.ui.sidebarCollapsed';

export const useUiStore = defineStore('ui', () => {
  const sidebarCollapsed = ref(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true');
  /** Drives the off-canvas sidebar on small screens. */
  const mobileSidebarOpen = ref(false);

  watch(sidebarCollapsed, (collapsed) => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
  });

  const toggleSidebar = (): void => {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  };

  const toggleMobileSidebar = (open?: boolean): void => {
    mobileSidebarOpen.value = open ?? !mobileSidebarOpen.value;
  };

  return { sidebarCollapsed, mobileSidebarOpen, toggleSidebar, toggleMobileSidebar };
});
