/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/interfaces/web/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};