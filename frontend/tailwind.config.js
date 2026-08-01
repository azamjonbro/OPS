/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      /**
       * Semantic surface scale, ordered from the deepest recess (canvas) to the
       * most raised (hover). Components reference the role — `bg-card`, `border-line`
       * — never a hex value, so the palette can be retuned in one place.
       *
       * Each token resolves through a CSS custom property (`--color-*`, defined in
       * style.css for both `:root` and `.light`), using the `rgb(var(--x) / <alpha-value>)`
       * pattern so opacity modifiers like `bg-card/60` keep working under either theme.
       */
      colors: {
        canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
        sunken: 'rgb(var(--color-sunken) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        card: 'rgb(var(--color-card) / <alpha-value>)',
        raised: 'rgb(var(--color-raised) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        hover: 'rgb(var(--color-hover) / <alpha-value>)',
        line: 'rgb(var(--color-line) / <alpha-value>)',
        'line-strong': 'rgb(var(--color-line-strong) / <alpha-value>)',
        'line-hover': 'rgb(var(--color-line-hover) / <alpha-value>)',

        // Accent hues stay constant across themes — they're always paired with a
        // tinted background (bg-indigo-500/20) that supplies its own contrast.
        accent: {
          blue: '#3B82F6',
          indigo: '#6366F1',
          purple: '#8B5CF6',
          emerald: '#10B981',
          cyan: '#06B6D4'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace']
      },
      transitionTimingFunction: {
        'out-soft': 'cubic-bezier(0.22, 1, 0.36, 1)'
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' }
        }
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-up': 'slide-up 200ms cubic-bezier(0.22, 1, 0.36, 1)',
        'scale-in': 'scale-in 160ms cubic-bezier(0.22, 1, 0.36, 1)'
      }
    },
  },
  plugins: [],
}
