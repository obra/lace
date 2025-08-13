import { Lato, DM_Sans, JetBrains_Mono } from 'next/font/google';

// Configure Lato via Next Fonts for optimal loading and automatic CSS class
// Adjust weights/styles as needed by the design system
export const lato = Lato({
  subsets: ['latin'],
  weight: ['300', '400', '700', '900'],
  display: 'swap',
  variable: '--font-lato',
});

// DM Sans for UI text
export const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-dm-sans',
});

// JetBrains Mono for code elements
export const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});
