/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./.storybook/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: [
          'ui-monospace',
          'JetBrains Mono',
          'Fira Code',
          'SF Mono',
          'SFMono-Regular',
          'Monaco',
          'Consolas',
          'Liberation Mono',
          'Menlo',
          'Courier New',
          'monospace'
        ],
      },
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      'light',
      'dark',
      'cupcake',
      'corporate',
      'synthwave',
      'black',
      'business',
      'emerald',
      'lofi',
    ],
    darkTheme: 'dark',
    base: true,
    styled: true,
    utils: true,
    prefix: '',
    logs: true,
    themeRoot: ':root',
  },
};

export default config;
