// ABOUTME: E2E test server that runs the main server with test-specific configuration
// ABOUTME: Keeps production server clean while allowing E2E tests to run in isolated mode

// Starting E2E test server...

// Mock Anthropic API HTTP endpoints for E2E tests
import { mockAnthropicForE2E } from '@/e2e/helpers/anthropic-mock';

void (async () => {
  mockAnthropicForE2E();
  await import('./server-custom');
})();
