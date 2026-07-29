/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0B0C0E',
        surface: {
          50: '#14161B',
          100: '#1A1D24',
          200: '#232731',
          300: '#2F3442',
        },
        border: 'rgba(255, 255, 255, 0.08)',
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
      }
    },
  },
  plugins: [],
}
