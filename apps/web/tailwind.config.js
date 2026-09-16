/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx,html}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          '900': '#7b4a1e',
          '800': '#9a5d26',
          '700': '#b8702f',
          '600': '#d68338',
          '500': '#f49541',
          '400': '#f6a752',
          '300': '#f8b963',
          '200': '#fbcb74',
          '100': '#fdde85',
          '50': '#ffe096',
        },
      },
      fontFamily: {
        'sans': ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'sans-serif', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'],
        'body': ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'sans-serif', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'],
        'mono': ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', 'monospace'],
      },
      transitionProperty: {
        'width': 'width',
      },
      animation: {
        'spin-ccw': 'spin-ccw 1s linear infinite',
      },
      keyframes: {
        'spin-ccw': {
          'from': { transform: 'rotate(0deg)' },
          'to': { transform: 'rotate(-360deg)' },
        },
      },
    },
  },
  plugins: [],
};
