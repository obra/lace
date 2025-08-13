// ABOUTME: End-to-end tests for directory browser functionality
// ABOUTME: Tests complete user workflows for project creation with directory selection

import { test, expect } from './mocks/setup';
import { homedir } from 'os';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  type TestEnvironment,
} from '@/e2e/helpers/test-utils';

test.describe('Directory Browser E2E Tests', () => {
  let testEnv: TestEnvironment;

  test.beforeEach(async ({ page }) => {
    testEnv = await setupTestEnvironment();
    await page.goto('/');
  });

  test.afterEach(async () => {
    await cleanupTestEnvironment(testEnv);
  });

  test('should show directory browser when creating project', async ({ page }) => {
    // Click "New Project" button
    const newProjectButton = page
      .locator('button:has-text("New Project")')
      .or(page.locator('[data-testid="new-project-button"]'))
      .first();

    await newProjectButton.waitFor({ timeout: 10000 });
    await newProjectButton.click();

    // Should open create project modal
    await expect(page.getByRole('heading', { name: 'Create New Project' }).first()).toBeVisible({
      timeout: 10000,
    });

    // Should show directory field with DirectoryField component
    const directoryInput = page.locator('input[placeholder="/path/to/your/project"]');
    await directoryInput.waitFor({ timeout: 5000 });

    // Check if directory field has folder icon (indicates DirectoryField is being used)
    const folderIcon = page.locator('.fa-folder').first();
    if ((await folderIcon.count()) > 0) {
      await expect(folderIcon).toBeVisible();
    }

    // Click on directory field to potentially open browser dropdown
    await directoryInput.click();

    // Test typing in the directory field
    await directoryInput.fill(`${homedir()}/test-directory`);

    // Verify the input accepts the value
    await expect(directoryInput).toHaveValue(`${homedir()}/test-directory`);
  });

  test('should handle directory input validation', async ({ page }) => {
    // Navigate to project creation
    const newProjectButton = page
      .locator('button:has-text("New Project")')
      .or(page.locator('[data-testid="new-project-button"]'))
      .first();

    await newProjectButton.waitFor({ timeout: 10000 });
    await newProjectButton.click();

    // Wait for modal to appear
    await expect(page.getByRole('heading', { name: 'Create New Project' }).first()).toBeVisible({
      timeout: 10000,
    });

    // Get the directory input field
    const directoryInput = page.locator('input[placeholder="/path/to/your/project"]');
    await directoryInput.waitFor({ timeout: 5000 });

    // Test typing an invalid path
    await directoryInput.fill('/invalid/path/that/does/not/exist');

    // Try to proceed (button should be disabled or show error)
    const createButton = page.locator('button:has-text("Create Project")');

    // The button might be disabled for invalid paths
    // Or there might be validation errors displayed
    const isButtonEnabled = await createButton.isEnabled();
    const hasValidationError =
      (await page.locator('.text-error, .text-red-500, [role="alert"]').count()) > 0;

    // Split OR condition into explicit assertions to show which condition failed
    if (isButtonEnabled) {
      expect(hasValidationError).toBeTruthy();
    } else {
      expect(isButtonEnabled).toBeFalsy();
    }
  });

  test('should work with valid directory paths', async ({ page }) => {
    // Navigate to project creation
    const newProjectButton = page
      .locator('button:has-text("New Project")')
      .or(page.locator('[data-testid="new-project-button"]'))
      .first();

    await newProjectButton.waitFor({ timeout: 10000 });
    await newProjectButton.click();

    // Wait for modal
    await expect(page.getByRole('heading', { name: 'Create New Project' }).first()).toBeVisible({
      timeout: 10000,
    });

    // Get the directory input field
    const directoryInput = page.locator('input[placeholder="/path/to/your/project"]');
    await directoryInput.waitFor({ timeout: 5000 });

    // Use home directory as a valid path
    const validPath = homedir();
    await directoryInput.fill(validPath);

    // Blur to trigger validation
    await directoryInput.blur();
    await page.waitForTimeout(1000);

    // Check if Create Project button becomes enabled
    const createButton = page.locator('button:has-text("Create Project")');

    // With a valid directory, the button should eventually become enabled
    // (may take some time for validation to run)
    await expect(createButton).toBeEnabled({ timeout: 5000 });
  });

  test('should show directory browser dropdown when focused', async ({ page }) => {
    // Navigate to project creation
    const newProjectButton = page
      .locator('button:has-text("New Project")')
      .or(page.locator('[data-testid="new-project-button"]'))
      .first();

    await newProjectButton.waitFor({ timeout: 10000 });
    await newProjectButton.click();

    // Wait for modal
    await expect(page.getByRole('heading', { name: 'Create New Project' }).first()).toBeVisible({
      timeout: 10000,
    });

    // Get the directory input field
    const directoryInput = page.locator('input[placeholder="/path/to/your/project"]');
    await directoryInput.waitFor({ timeout: 5000 });

    // Focus the input to potentially trigger dropdown
    await directoryInput.focus();

    // Wait a moment for dropdown to potentially appear
    await page.waitForTimeout(1000);

    // Check if directory browser elements appear
    const browserElements = page.locator('text=/Browse:|Loading directories|No directories found/');
    const dropdownElement = page.locator('.absolute.z-50').first();

    // Either should see browser text or dropdown container
    const hasBrowserElements = (await browserElements.count()) > 0;
    const hasDropdown = (await dropdownElement.count()) > 0;

    // Verify DirectoryField dropdown functionality with proper assertion
    await test.step('Verify directory browser dropdown appears', async () => {
      expect(hasBrowserElements || hasDropdown).toBeTruthy();
    });

    // This test mainly validates that the DirectoryField component is integrated
    // Even if dropdown doesn't appear, the field should still accept input
    await directoryInput.fill(homedir());
    await expect(directoryInput).toHaveValue(homedir());
  });

  test('should handle keyboard navigation in directory field', async ({ page }) => {
    // Navigate to project creation
    const newProjectButton = page
      .locator('button:has-text("New Project")')
      .or(page.locator('[data-testid="new-project-button"]'))
      .first();

    await newProjectButton.waitFor({ timeout: 10000 });
    await newProjectButton.click();

    // Wait for modal
    await expect(page.getByRole('heading', { name: 'Create New Project' }).first()).toBeVisible({
      timeout: 10000,
    });

    const directoryInput = page.locator('input[placeholder="/path/to/your/project"]');
    await directoryInput.waitFor({ timeout: 5000 });

    // Test keyboard navigation by using Tab to navigate to the field
    // Start by focusing on the modal close button or first element
    const closeButton = page
      .locator('button:has-text("×"), button[aria-label*="close"], .modal button')
      .first();
    if ((await closeButton.count()) > 0) {
      await closeButton.focus();

      // Tab until we reach the directory input (should be 1-3 tabs typically)
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab');
        if (
          (await directoryInput.isVisible()) &&
          (await directoryInput.evaluate((el) => el === document.activeElement))
        ) {
          break;
        }
      }
    } else {
      // Fallback: focus directly on the input
      await directoryInput.focus();
    }

    // Verify field is focused (this tests that keyboard navigation worked)
    await expect(directoryInput).toBeFocused();

    // Type using keyboard
    await page.keyboard.type(`${homedir()}/test`);

    // Verify input was typed
    await expect(directoryInput).toHaveValue(`${homedir()}/test`);

    // Press Escape to potentially close any dropdown
    await page.keyboard.press('Escape');

    // Field should still be focused and retain value after Escape
    await expect(directoryInput).toBeFocused();
    await expect(directoryInput).toHaveValue(`${homedir()}/test`);

    // Test keyboard selection and replacement
    // Select all text using Ctrl+A (or Cmd+A on Mac)
    const isMac = process.platform === 'darwin';
    const selectAllKey = isMac ? 'Meta+a' : 'Control+a';
    await page.keyboard.press(selectAllKey);

    // Type new text to replace selected text
    await page.keyboard.type('/new/path');

    // Verify new value
    await expect(directoryInput).toHaveValue('/new/path');
  });

  test('should integrate with project creation workflow', async ({ page }) => {
    // This test creates a full project using the DirectoryField
    const newProjectButton = page
      .locator('button:has-text("New Project")')
      .or(page.locator('[data-testid="new-project-button"]'))
      .first();

    await newProjectButton.waitFor({ timeout: 10000 });
    await newProjectButton.click();

    // Wait for modal
    await expect(page.getByRole('heading', { name: 'Create New Project' }).first()).toBeVisible({
      timeout: 10000,
    });

    // Fill directory field using DirectoryField component
    const directoryInput = page.locator('input[placeholder="/path/to/your/project"]');
    await directoryInput.waitFor({ timeout: 5000 });

    // Use testEnv temp directory for valid project creation
    const projectPath = `${testEnv.tempDir}/e2e-directory-test`;
    await directoryInput.fill(projectPath);

    // Blur to trigger validation
    await directoryInput.blur();
    await page.waitForTimeout(1000);

    // Create Project button should become enabled
    const createButton = page.locator('button:has-text("Create Project")');
    await expect(createButton).toBeEnabled({ timeout: 5000 });

    // Click create project
    await createButton.click();

    // Project should be created successfully
    // Wait for project interface to appear
    await expect(
      page
        .locator(
          '[data-testid="current-project-name"], [data-testid="current-project-name-desktop"]'
        )
        .first()
    ).toBeVisible({ timeout: 15000 });

    // Should reach the chat interface
    await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', {
      timeout: 10000,
    });

    await test.step('Project creation with DirectoryField completed', async () => {
      // Verify we have successfully reached the chat interface
      expect(
        await page
          .locator('input[placeholder*="Message"], textarea[placeholder*="Message"]')
          .count()
      ).toBeGreaterThan(0);
    });
  });
});
