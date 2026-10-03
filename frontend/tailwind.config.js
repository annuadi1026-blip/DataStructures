/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#EEF1F6', card: '#FFFFFF', ink: '#14213D', soft: '#5B6785', line: '#D5DBE8',
        brand: { DEFAULT: '#2D4BDB', dark: '#2039A8', tint: '#E4E9FC' },
        ok: { DEFAULT: '#0F8F7D', tint: '#DDF3EF' }, warn: { DEFAULT: '#B87400', tint: '#FDF0D3' }, bad: { DEFAULT: '#C2364A', tint: '#FBE4E8' },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
