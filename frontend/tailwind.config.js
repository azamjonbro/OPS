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
       * Semantic surface scale, ordered from the darkest (page canvas) to the
       * lightest (hover). Components reference the role — `bg-card`, `border-line` —
       * so the palette can be retuned in one place instead of hunting raw hex values
       * spread across the templates.
       */
      colors: {
        canvas: '#0B0C0E',      // page background
        sunken: '#0E1014',      // inset areas: inputs, code blocks
        surface: '#111317',     // headers, sidebars, panels
        card: '#14161C',        // cards, message bubbles
        raised: '#171A22',      // card hover
        muted: '#1A1D26',       // secondary buttons, chips
        hover: '#252936',       // muted hover
        line: '#1F222A',        // default border
        'line-strong': '#262A36',
        'line-hover': '#2D3242',

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
