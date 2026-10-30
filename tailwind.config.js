/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ide: {
          bg: '#181818',
          sidebar: '#1e1e1e',
          activityBar: '#252526',
          editor: '#1e1e1e',
          panel: '#1e1e1e',
          statusbar: '#007acc',
          statusbarBg: '#1f1f1f',
          border: '#2d2d2d',
          accent: '#007acc',
          hover: '#2a2d2e',
          selected: '#37373d',
          textMuted: '#858585',
          textNormal: '#cccccc',
          textBright: '#ffffff',
        }
      }
    },
  },
  plugins: [],
}
