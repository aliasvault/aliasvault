import aliasvaultColors from "../../core/models/src/colors/tailwind-preset.cjs";

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,jsx,ts,tsx,html}",
    // Test fixtures are not shipped, so strip out of CSS.
    "!./src/**/__tests__/**"
  ],
  presets: [aliasvaultColors],
  darkMode: 'class',
  plugins: [],
}