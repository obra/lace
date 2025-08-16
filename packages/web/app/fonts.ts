// ABOUTME: Font configuration using @fontsource packages for consistent loading
// ABOUTME: All fonts use CSS imports in globals.css for reliable self-hosting

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

// Configure Google Sans Code using @fontsource package for consistency
export const googleSansCode = {
  variable: '--font-google-sans-code',
  className: '', // CSS-only, no specific className needed
};
