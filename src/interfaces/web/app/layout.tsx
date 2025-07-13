// ABOUTME: Root layout for Next.js web interface
// ABOUTME: Provides HTML structure, global styles, and FontAwesome setup for the Lace web app

import type { Metadata } from 'next';
import './globals.css';
import '~/interfaces/web/lib/fontawesome';

export const metadata: Metadata = {
  title: 'Lace - AI Coding Assistant',
  description: 'A sophisticated AI coding assistant with event-sourcing architecture',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}