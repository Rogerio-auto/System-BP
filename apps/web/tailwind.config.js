/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Inter Display"', 'Inter', 'ui-sans-serif', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Paleta dark-first. Refinar em /hm-designer.
        ink: {
          950: '#06070A',
          900: '#0B0D12',
          800: '#11141B',
          700: '#1A1E27',
          600: '#272C38',
          500: '#3A4151',
          400: '#5A6275',
          300: '#8A93A6',
          200: '#B8BFCD',
          100: '#E2E6EE',
          50: '#F5F7FA',
        },
      },
    },
  },
  plugins: [],
};
