// ABOUTME: Global test setup for React/Ink components
// ABOUTME: Configures jsdom and React testing environment for Vitest

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup after each test
afterEach(() => {
  cleanup();
});
