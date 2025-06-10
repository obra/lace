// ABOUTME: Jest test setup file for UI tests
// ABOUTME: Configures testing environment and global mocks

import { jest } from "@jest/globals";

// Set React testing environment flag BEFORE any React imports
global.IS_REACT_ACT_ENVIRONMENT = true;

// Configure React for testing environment
if (typeof window !== "undefined") {
  // Only set this in browser-like environments
  (global as any).jest = jest;
}

// Don't use fake timers globally - it breaks real timeout/async behavior
// Individual tests can enable fake timers if needed with jest.useFakeTimers()
