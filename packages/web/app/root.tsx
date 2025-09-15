// ABOUTME: Root component for React Router v7 application
// ABOUTME: Sets up global providers, styles, and outlet for route rendering

import { Outlet, Scripts, Links, Meta } from 'react-router';
import '@/app/globals.css';
import '@/app/fonts';
import { ErrorBoundary } from '@/components/old/ErrorBoundary';
import { SettingsProvider } from '@/components/providers/SettingsProvider';
import { ProviderInstanceProvider } from '@/components/providers/ProviderInstanceProvider';
import { ReleaseNotesProvider } from '@/components/providers/ReleaseNotesProvider';
import { ConsoleForwardScript } from '@/lib/console-forward/script';
import { DebugPanel } from '@/components/debug/DebugPanel';

export default function Root() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Lace</title>
        <Meta />
        <Links />
      </head>
      <body className="antialiased">
        <ConsoleForwardScript />
        <ErrorBoundary>
          <SettingsProvider>
            <ProviderInstanceProvider>
              <ReleaseNotesProvider>
                <DebugPanel>
                  <Outlet />
                </DebugPanel>
              </ReleaseNotesProvider>
            </ProviderInstanceProvider>
          </SettingsProvider>
        </ErrorBoundary>
        <Scripts />
      </body>
    </html>
  );
}
