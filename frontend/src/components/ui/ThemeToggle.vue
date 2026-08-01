<template>
  <button
    type="button"
    @click="toggle"
    class="relative w-9 h-9 rounded-xl bg-muted hover:bg-hover border border-line flex items-center justify-center text-gray-300 hover:text-white transition-colors shrink-0"
    :title="isLight ? 'Tungi rejimga o\'tish' : 'Kunduzgi rejimga o\'tish'"
    :aria-label="isLight ? 'Tungi rejimga o\'tish' : 'Kunduzgi rejimga o\'tish'"
  >
    <Icon :name="isLight ? 'moon' : 'sun'" size="sm" />
  </button>
</template>

<script>
import { getTheme, toggleTheme, onThemeChange } from '../../services/themeService';

export default {
  name: 'ThemeToggle',
  data() {
    return {
      theme: getTheme()
    };
  },
  computed: {
    isLight() {
      return this.theme === 'light';
    }
  },
  mounted() {
    // Keeps every toggle instance in the app (sidebar, admin header, login) in sync
    // when the theme changes from any one of them.
    this.unsubscribe = onThemeChange((t) => { this.theme = t; });
  },
  beforeUnmount() {
    if (this.unsubscribe) this.unsubscribe();
  },
  methods: {
    toggle() {
      this.theme = toggleTheme();
    }
  }
};
</script>
