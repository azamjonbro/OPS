const STORAGE_KEY = 'jarvis-theme';
const listeners = new Set();

function systemPrefersLight() {
  return typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: light)').matches;
}

function readStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    return null; // Storage disabled (private browsing, etc.) — fall through.
  }
}

/** 'dark' | 'light'. The stored choice wins; otherwise follow the OS, defaulting dark. */
export function getTheme() {
  return readStoredTheme() || (systemPrefersLight() ? 'light' : 'dark');
}

function applyThemeClass(theme) {
  document.documentElement.classList.toggle('light', theme === 'light');
  document.documentElement.classList.toggle('dark', theme !== 'light');
}

export function setTheme(theme) {
  applyThemeClass(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch (e) {}
  listeners.forEach((fn) => fn(theme));
}

export function toggleTheme() {
  const next = getTheme() === 'light' ? 'dark' : 'light';
  setTheme(next);
  return next;
}

/** Applies the resolved theme immediately; call once at app startup. */
export function initTheme() {
  applyThemeClass(getTheme());

  // Only react to OS changes while the user hasn't made an explicit choice here.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
      if (!readStoredTheme()) applyThemeClass(e.matches ? 'light' : 'dark');
    });
  }
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export default { getTheme, setTheme, toggleTheme, initTheme, onThemeChange };
