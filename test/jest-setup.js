// ABOUTME: Jest setup file for global test configuration and utilities
// ABOUTME: Provides test helpers, cleanup utilities, and common test patterns

import { jest } from "@jest/globals";

// Increase timeout for integration tests
jest.setTimeout(10000);

// Global test utilities
global.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Mock console methods for cleaner test output (unless verbose)
if (!process.env.VERBOSE_TESTS) {
  global.console = {
    ...console,
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
}

// Setup and teardown helpers
global.setupTest = async function () {
  // Common setup logic
};

global.teardownTest = async function () {
  // Common teardown logic
};

// Custom matchers can be added here
expect.extend({
  toBeWithinRange(received, floor, ceiling) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () =>
          `expected ${received} not to be within range ${floor} - ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `expected ${received} to be within range ${floor} - ${ceiling}`,
        pass: false,
      };
    }
  },
});
