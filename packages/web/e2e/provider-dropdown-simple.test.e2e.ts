// ABOUTME: Simple E2E test to verify provider dropdown issue is fixed
// ABOUTME: Tests basic navigation and provider addition flow

import { test, expect } from '@playwright/test';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  type TestEnvironment,
} from './helpers/test-utils';

test.describe('Provider Dropdown - Simple Test', () => {
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

  test('can navigate to settings and see provider configuration', async ({ page }) => {
    // Just test basic navigation to settings
    await page.getByTestId('settings-button').click();

    // Verify we can see the provider configuration panel
    await expect(page.getByText('AI Provider Configuration')).toBeVisible();
    await expect(page.getByText('Provider Instances')).toBeVisible();

    // Verify we can see the add instance button
    await expect(page.getByTestId('add-instance-button')).toBeVisible();

    // ✅ Basic settings navigation works
  });

  test('provider appears in project creation dropdown after being added', async ({ page }) => {
    // Generate random provider name
    const randomId = Math.random().toString(36).substring(2, 15);
    const providerName = `test-provider-${randomId}`;

    // Step 1: Wait for page to load
    await page
      .locator('[data-testid="settings-button"]')
      .waitFor({ state: 'visible', timeout: 10000 });

    // Step 2: Open settings and add a provider (NO PAGE RELOAD)
    await page.locator('[data-testid="settings-button"]').click();
    await page.waitForSelector('text="Provider Instances"', { timeout: 5000 });

    // Click add instance button
    await page.locator('[data-testid="add-instance-button"]').click();
    await page.waitForSelector('text="Select Provider"', { timeout: 5000 });

    // Select Anthropic provider
    await page.locator('[data-testid="provider-card-anthropic"]').click();
    await page.waitForSelector('text="Configure Instance"', { timeout: 5000 });

    // Fill form with random name
    await page.locator('[data-testid="instance-name-input"]').fill(providerName);
    await page.locator('[data-testid="api-key-input"]').fill('sk-test-12345');

    // Create the provider
    await page.locator('[data-testid="create-instance-button"]').click();

    // Wait for provider list to update (verify creation)
    await page.waitForSelector(`text="${providerName}"`, { timeout: 5000 });

    // Step 3: Close settings modal (NO PAGE RELOAD)
    await page.locator('[aria-label="Close modal"]').first().click();

    // Step 4: Open project creation wizard (NO PAGE RELOAD)
    // Handle first-run vs existing projects - use the correct first-run test id
    const firstRunButton = page.locator('[data-testid="create-first-project-button"]');
    const regularButton = page.locator('[data-testid="create-project-button"]');

    const visibleButton = (await firstRunButton.isVisible().catch(() => false))
      ? firstRunButton
      : regularButton;

    await visibleButton.click();

    // Step 5: Navigate to provider selection step
    await page.locator('[data-testid="project-path-input"]').fill('/tmp/test-project');
    await page.locator('[data-testid="project-wizard-continue-button"]').click();

    // Step 6: Verify the new provider appears in dropdown
    await page.waitForSelector('text="Set default AI provider"', { timeout: 5000 });

    // Get all dropdown options and verify our provider is there
    const providerDropdown = page.locator('select').first();
    const options = await providerDropdown.locator('option').allTextContents();

    expect(options).toContain(providerName);
    // ✅ Provider appears in dropdown after creation
  });
});
