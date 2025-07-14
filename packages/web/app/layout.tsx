// ABOUTME: Root layout component for the Next.js app
// ABOUTME: Sets up global styles and metadata

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lace Web Terminal',
  description: 'AI coding assistant with multi-agent support',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}