/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,jsx,ts,tsx,html}",
    // Test fixtures are not shipped, so strip out of CSS.
    "!./src/**/__tests__/**"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          "900": "#7b4a1e",
          "800": "#9a5d26",
          "700": "#b8702f",
          "600": "#d68338",
          "500": "#f49541",
          "400": "#f6a752",
          "300": "#f8b963",
          "200": "#fbcb74",
          "100": "#fdde85",
          "50": "#ffe096"
        }
      }
    }
  },
  plugins: [],
}