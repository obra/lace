// ABOUTME: React Router request handler app - only handles React Router routes
// ABOUTME: Exports Express app with createRequestHandler - no static file serving

import { createRequestHandler } from '@react-router/express';
import express from 'express';

const BUILD_PATH = '../build/server/index.js';
const DEVELOPMENT = process.env.NODE_ENV !== 'production';

export const app = express();

if (DEVELOPMENT) {
  // Development mode - use virtual import
  app.use(
    createRequestHandler({
      build: () => import('virtual:react-router/server-build'),
      getLoadContext() {
        return {
          // Add any context needed by your routes here
        };
      },
    })
  );
} else {
  // Production mode - use pre-built bundle
  app.use(
    createRequestHandler({
      build: () => import(/* @vite-ignore */ BUILD_PATH),
      getLoadContext() {
        return {
          // Add any context needed by your routes here
        };
      },
    })
  );
}
