import type { Metadata } from 'next';
import '~/app/globals.css';
import '~/lib/fontawesome';

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