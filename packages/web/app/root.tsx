// ABOUTME: Root component for React Router v7 application
// ABOUTME: Sets up global providers, styles, and outlet for route rendering

import { Outlet, Scripts, Links, Meta } from 'react-router';
import '@/app/globals.css';
import { ErrorBoundary } from '@/components/old/ErrorBoundary';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ProviderInstanceProvider } from '@/components/providers/ProviderInstanceProvider';
import { ConsoleForwardScript } from '@/lib/console-forward/script';

export default function Root() {
  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body className="antialiased">
        <ConsoleForwardScript />
        <ErrorBoundary>
          <ThemeProvider>
            <ProviderInstanceProvider>
              <Outlet />
            </ProviderInstanceProvider>
          </ThemeProvider>
        </ErrorBoundary>
        <Scripts />
      </body>
    </html>
  );
}
