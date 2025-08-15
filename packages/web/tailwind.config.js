/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
    './.storybook/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: [
          'var(--font-google-sans-code)',
          'Google Sans Code',
          'JetBrains Mono',
          'ui-monospace',
          'SF Mono',
          'SFMono-Regular',
          'Monaco',
          'Consolas',
          'Liberation Mono',
          'Menlo',
          'Courier New',
          'monospace',
        ],
        'google-sans-code': [
          'var(--font-google-sans-code)',
          'Google Sans Code',
          'ui-monospace',
          'SFMono-Regular',
          'Monaco',
          'Consolas',
          'Liberation Mono',
          'Menlo',
          'Courier New',
          'monospace',
        ],
      },
      backdropBlur: {
        xs: '2px',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'vapor-bg':
          'radial-gradient(1200px 700px at 15% -10%, rgba(34, 197, 94, 0.14), transparent 60%), radial-gradient(1000px 600px at 85% 0%, rgba(59, 130, 246, 0.1), transparent 60%), linear-gradient(180deg, #0b0f0e, #121614)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.8' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      'light',
      {
        'lace-dark': {
          primary: '#8b5cf6',
          'primary-content': '#ffffff',
          secondary: '#06b6d4',
          'secondary-content': '#ffffff',
          accent: '#10b981',
          'accent-content': '#ffffff',
          neutral: '#374151',
          'neutral-content': '#d1d5db',
          'base-100': '#1f2937',
          'base-200': '#111827',
          'base-300': '#0f172a',
          'base-content': '#f3f4f6',
          info: '#3b82f6',
          success: '#10b981',
          warning: '#f59e0b',
          error: '#ef4444',
        },
      },
      'dark',
      'cupcake',
      'corporate',
      'synthwave',
      'black',
      'business',
      'emerald',
      'lofi',
    ],
    darkTheme: 'lace-dark',
    base: true,
    styled: true,
    utils: true,
    prefix: '',
    logs: true,
    themeRoot: ':root',
  },
};

export default config;
