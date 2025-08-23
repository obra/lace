// ABOUTME: Tests page object interface functionality and UI interaction patterns
// ABOUTME: Verifies page object abstractions provide clean interface for test automation

import { test, expect } from '@playwright/test';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  type TestEnvironment,
} from './helpers/test-utils';
import { createPageObjects } from './page-objects';

test.describe('Page Objects', () => {
  let testEnv: TestEnvironment;

  test.beforeEach(async ({ page }) => {
    testEnv = await setupTestEnvironment();
    await page.goto(testEnv.serverUrl);
  });

  test.afterEach(async () => {
    if (testEnv) {
      await cleanupTestEnvironment(testEnv);
    }
  });

  test('page objects provide clean interface for UI interactions', async ({ page }) => {
    const { projectSelector, _chatInterface } = createPageObjects(page);

    // Use page object methods
    await projectSelector.clickNewProject();

    // Verify the form opened (this is an assertion in the test, not page object)
    // In simplified mode, the path input appears first
    await expect(projectSelector.projectPathInput).toBeVisible();
  });
});
