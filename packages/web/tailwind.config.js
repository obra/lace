/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'terminal-bg': '#1a1a1a',
        'terminal-fg': '#d4d4d4',
        'terminal-green': '#4ade80',
        'terminal-blue': '#60a5fa',
        'terminal-yellow': '#facc15',
        'terminal-red': '#f87171',
        'terminal-purple': '#c084fc',
      },
      fontFamily: {
        mono: ['Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
}