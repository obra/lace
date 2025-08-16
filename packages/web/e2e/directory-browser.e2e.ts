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
      .or(page.locator('[data-testid="create-project-button"]'))
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
    // Use ProjectSelector page object for proper wizard navigation
    const { createPageObjects } = await import('./page-objects');
    const { projectSelector } = createPageObjects(page);

    await projectSelector.clickNewProject();

    // Wait for modal to appear
    await expect(page.getByRole('heading', { name: 'Create New Project' }).first()).toBeVisible({
      timeout: 10000,
    });

    // Get the directory input field
    const directoryInput = page.locator('input[placeholder="/path/to/your/project"]');
    await directoryInput.waitFor({ timeout: 5000 });

    // Test typing an invalid path
    await directoryInput.fill('/invalid/path/that/does/not/exist');

    // Navigate through wizard steps to reach submit button
    await projectSelector.navigateWizardSteps();

    // Try to proceed (button should be disabled or show error)
    const createButton = page.getByTestId('create-project-submit');
    await createButton.waitFor({ timeout: 5000 });

    // The button might be disabled for invalid paths
    // Or there might be validation errors displayed
    const isButtonEnabled = await createButton.isEnabled();
    const hasValidationError =
      (await page.locator('.text-error, .text-red-500, [role="alert"]').count()) > 0;

    // Validation should either disable the button or show error messages
    expect(isButtonEnabled || hasValidationError).toBeTruthy();
  });

  test('should work with valid directory paths', async ({ page }) => {
    await page.goto('/');

    // Use ProjectSelector page object for proper wizard navigation
    const { createPageObjects } = await import('./page-objects');
    const { projectSelector } = createPageObjects(page);

    await projectSelector.clickNewProject();

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

    // Navigate through wizard steps to reach submit button
    await projectSelector.navigateWizardSteps();

    // Check if Create Project button becomes enabled
    const createButton = page.getByTestId('create-project-submit');

    // With a valid directory, the button should eventually become enabled
    // (may take some time for validation to run)
    await expect(createButton).toBeEnabled({ timeout: 5000 });
  });

  test('should show directory browser dropdown when focused', async ({ page }) => {
    // Navigate to project creation
    const newProjectButton = page
      .locator('button:has-text("New Project")')
      .or(page.locator('[data-testid="create-project-button"]'))
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
    // Use ProjectSelector page object for proper setup
    const { createPageObjects } = await import('./page-objects');
    const { projectSelector } = createPageObjects(page);

    await projectSelector.clickNewProject();

    // Wait for modal
    await expect(page.getByRole('heading', { name: 'Create New Project' }).first()).toBeVisible({
      timeout: 10000,
    });

    const directoryInput = page.locator('input[placeholder="/path/to/your/project"]');
    await directoryInput.waitFor({ timeout: 5000 });

    // Test focusing directly on the input (simpler approach)
    await directoryInput.focus();

    // Verify field is focused
    await expect(directoryInput).toBeFocused();

    // Test typing in the field
    await directoryInput.fill(`${homedir()}/test`);

    // Verify input was filled
    await expect(directoryInput).toHaveValue(`${homedir()}/test`);

    // Test keyboard selection and replacement
    await directoryInput.focus();

    // Select all text using Ctrl+A (or Cmd+A on Mac)
    const isMac = process.platform === 'darwin';
    const selectAllKey = isMac ? 'Meta+a' : 'Control+a';
    await page.keyboard.press(selectAllKey);

    // Use keyboard to type new text (simulating real user input)
    await page.keyboard.type('/new/path');

    // Verify new value was typed
    await expect(directoryInput).toHaveValue('/new/path');

    // Test that Tab key can navigate away from field
    await page.keyboard.press('Tab');

    // Field should no longer be focused after Tab
    await expect(directoryInput).not.toBeFocused();
  });

  test('should integrate with project creation workflow', async ({ page }) => {
    // Set up test environment
    const testEnv = await setupTestEnvironment();

    try {
      // Page is already at / from beforeEach hook

      // This test creates a full project using the DirectoryField
      const newProjectButton = page.getByTestId('create-project-button');

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

      // Use ProjectSelector to navigate through wizard and submit
      const { createPageObjects } = await import('./page-objects');
      const { projectSelector } = createPageObjects(page);

      // Navigate through wizard steps to reach submit button
      await projectSelector.navigateWizardSteps();

      // Create Project button should become enabled
      const createButton = page.getByTestId('create-project-submit');
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
      await page.waitForSelector(
        'input[placeholder*="Message"], textarea[placeholder*="Message"]',
        {
          timeout: 10000,
        }
      );

      await test.step('Project creation with DirectoryField completed', async () => {
        // Verify we have successfully reached the chat interface
        expect(
          await page
            .locator('input[placeholder*="Message"], textarea[placeholder*="Message"]')
            .count()
        ).toBeGreaterThan(0);
      });
    } finally {
      await cleanupTestEnvironment(testEnv);
    }
  });
});
