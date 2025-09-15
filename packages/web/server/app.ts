// ABOUTME: React Router v7 app module loaded by Vite SSR
// ABOUTME: Contains virtual imports that only Vite can resolve

import { createRequestHandler } from '@react-router/express';
import express from 'express';

export const app = express();

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
