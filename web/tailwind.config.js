/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        studio: {
          dark: '#121214',
          card: '#1a1a1e',
          border: '#2a2a30',
          accent: '#007acc',
          teal: '#4ec9b0',
          amber: '#dcdcaa',
          emerald: '#4ade80',
        }
      }
    },
  },
  plugins: [],
};
