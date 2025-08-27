// ABOUTME: Client-side entry point for React Router v7 SPA mode
// ABOUTME: Hydrates the application on the client side only

import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';

import './globals.css';

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>
  );
});
