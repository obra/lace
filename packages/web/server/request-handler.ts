// ABOUTME: React Router request handler that handles both frontend and API routes
// ABOUTME: Exports a request handler function (not an Express app) for use in main server

import { createRequestHandler } from '@react-router/express';

export const requestHandler = createRequestHandler({
  build: () => import('virtual:react-router/server-build'),
  getLoadContext() {
    return {
      // Add any context needed by your routes here
      // This gets passed to loaders and actions as context
    };
  },
});
