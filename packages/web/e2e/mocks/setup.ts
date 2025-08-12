// ABOUTME: MSW setup for Playwright tests
// ABOUTME: Initializes mock service worker for intercepting external API calls

import { createWorkerFixture, MockServiceWorker } from 'playwright-msw';
import { test as baseTest } from '@playwright/test';
import { http } from 'msw';
import { handlers } from './handlers';

// Create test fixture with MSW worker
export const test = baseTest.extend<{
  worker: MockServiceWorker;
  http: typeof http;
}>({
  worker: createWorkerFixture(handlers),
  http,
});

// Re-export expect for convenience
export { expect } from '@playwright/test';

// For backwards compatibility, export the worker fixture
export const mockServiceWorker = createWorkerFixture(handlers);