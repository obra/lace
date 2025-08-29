// ABOUTME: Legacy MSW setup file - no longer needed
// ABOUTME: Playwright-MSW has been removed due to circular dependency issues

// This file is kept temporarily for reference but should not be used.
// Use the standard test pattern from docs/web-testing.md instead:
//
// import { test, expect } from '@playwright/test';
// import { setupTestEnvironment, cleanupTestEnvironment } from './helpers/test-utils';

import { test as baseTest } from '@playwright/test';

// Deprecated: Use standard setupTestEnvironment() pattern instead
export const test = baseTest;
export { expect } from '@playwright/test';
