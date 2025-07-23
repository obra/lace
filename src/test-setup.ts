// ABOUTME: Global test setup for React/Ink components and console capture
// ABOUTME: Configures jsdom, React testing environment, and quiet console for Vitest

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Import console capture setup (runs global beforeEach/afterEach)
import '~/test-utils/console-capture';

// Cleanup after each test
afterEach(() => {
  cleanup();
});
