// ABOUTME: Root layout component for the Next.js app
// ABOUTME: Sets up global styles, metadata, and theme provider infrastructure

import type { Metadata } from 'next';
import '@/app/globals.css';
import { ErrorBoundary } from '@/components/old/ErrorBoundary';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ConsoleForwardScript } from '@/lib/console-forward/script';
import { lato, dmSans, googleSansCode } from '@/app/fonts';

export const metadata: Metadata = {
  title: 'Lace Web Terminal',
  description: 'AI coding assistant with multi-agent support',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head></head>
      <body
        className={`${dmSans.variable} ${lato.variable} ${googleSansCode.variable} antialiased`}
      >
        <ConsoleForwardScript />
        <ErrorBoundary>
          <ThemeProvider>{children}</ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
