// ABOUTME: Root layout for Next.js web interface
// ABOUTME: Provides HTML structure and global styles for the Lace web app

import React from 'react';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lace - AI Coding Assistant',
  description: 'A sophisticated AI coding assistant with event-sourcing architecture',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <div id="app">
          {children}
        </div>
      </body>
    </html>
  );
}