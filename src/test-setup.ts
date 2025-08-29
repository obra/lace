// ABOUTME: Test setup for vitest test environment
// ABOUTME: Common configuration and utilities for all test files

import { beforeEach } from 'vitest';

// Reset environment before each test
beforeEach(() => {
  // Clear only LACE-specific environment variables that might affect tests
  for (const key in process.env) {
    if (key.startsWith('LACE_')) {
      delete process.env[key];
    }
  }
});

// Global test utilities can be added here
