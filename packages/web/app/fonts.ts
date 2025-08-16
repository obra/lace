import localFont from 'next/font/local';

// Configure local fonts using @fontsource packages (CSS-only, no Next.js font objects needed)
// Fonts are loaded via CSS imports in globals.css
export const lato = {
  variable: '--font-lato',
  className: '', // CSS-only, no specific className needed
};

export const dmSans = {
  variable: '--font-dm-sans',
  className: '', // CSS-only, no specific className needed
};

// Configure local Google Sans Code font with variable font file
export const googleSansCode = localFont({
  src: [
    {
      path: '../public/fonts/variable/GoogleSansCode[wght].ttf',
      weight: '200 700',
      style: 'normal',
    },
    {
      path: '../public/fonts/variable/GoogleSansCode-Italic[wght].ttf',
      weight: '200 700',
      style: 'italic',
    },
  ],
  variable: '--font-google-sans-code',
  display: 'swap',
});
