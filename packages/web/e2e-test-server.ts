// ABOUTME: E2E test server that runs in production mode for faster test execution
// ABOUTME: Uses built Next.js app instead of dev mode for optimal E2E test performance

// Mock Anthropic API HTTP endpoints for E2E tests
import { mockAnthropicForE2E } from '@/e2e/helpers/anthropic-mock';

void (async () => {
  // Mock Anthropic API for E2E tests
  mockAnthropicForE2E();

  // Import and run the custom server (NODE_ENV set by spawn environment)
  await import('./server-custom');
})();
