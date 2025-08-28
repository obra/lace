// ABOUTME: React Router v7 app module loaded by Vite SSR
// ABOUTME: Contains virtual imports that only Vite can resolve

import { createRequestHandler } from '@react-router/express';
import type { Request, Response, NextFunction } from 'express';

// Create the request handler with virtual import - Vite will resolve this
const requestHandler = createRequestHandler({
  build: () => import('virtual:react-router/server-build'),
  getLoadContext() {
    return {
      // Add any context needed by your routes here
    };
  },
});

// Export the app function that the main server expects
export async function app(req: Request, res: Response, next: NextFunction) {
  return requestHandler(req, res, next);
}
