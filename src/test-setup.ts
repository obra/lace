// ABOUTME: Test setup for vitest test environment
// ABOUTME: Common configuration and utilities for all test files

import { beforeEach } from 'vitest';

// Reset environment before each test
beforeEach(() => {
  // Clear any environment variables that might affect tests
  delete process.env.NODE_ENV;
  delete process.env.CI;
});

// Global test utilities can be added here
