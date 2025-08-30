// ABOUTME: E2E test for provider dropdown real-time updates
// ABOUTME: Tests that newly created provider instances immediately appear in project creation wizard

import { test, expect } from '@playwright/test';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  type TestEnvironment,
  TIMEOUTS,
} from './helpers/test-utils';

test.describe('Provider Dropdown Real-time Updates', () => {
  let testEnv: TestEnvironment;

  test.beforeEach(async ({ page }) => {
    // Setup isolated test environment for each test
    testEnv = await setupTestEnvironment();
    await page.goto(testEnv.serverUrl);
  });

  test.afterEach(async () => {
    if (testEnv) {
      await cleanupTestEnvironment(testEnv);
    }
  });

  test('newly created provider appears immediately in project creation dropdown', async ({
    page,
  }) => {
    // Generate random provider name to ensure uniqueness
    const randomId = Math.random().toString(36).substring(2, 15);
    const providerName = `test-provider-${randomId}`;

    // Step 1: Open settings and navigate to provider configuration
    await page.getByTestId('settings-button').click();
    await expect(page.getByText('AI Provider Configuration')).toBeVisible();

    // Step 2: Add a new provider instance
    await page.getByTestId('add-instance-button').click();
    await expect(page.getByText('Choose a provider from the catalog')).toBeVisible();

    // Select Anthropic provider for test
    await page.getByTestId('provider-card-anthropic').click();

    // Fill in provider details with random name
    await page.getByTestId('instance-name-input').fill(providerName);
    await page.getByTestId('api-key-input').fill('sk-test-12345');

    // Create the provider instance
    await page.getByTestId('create-instance-button').click();

    // Wait for the provider to be created and UI to update
    await expect(page.getByText(/\d+ instances? configured/)).toBeVisible();
    await expect(page.getByText(providerName)).toBeVisible();

    // Step 3: Close settings modal
    await page.getByRole('button', { name: 'Close modal' }).click();

    // Step 4: IMMEDIATELY open project creation wizard (no page reload)
    await page.getByTestId('create-project-button').click();
    await expect(page.getByText('Create New Project')).toBeVisible();

    // Navigate to the directory step
    await page.getByTestId('project-path-input').fill('/tmp/test-project');
    await page.getByTestId('project-wizard-continue-button').click();

    // Step 5: Verify the new provider appears in the dropdown
    await expect(page.getByText('Set default AI provider')).toBeVisible();

    // Click the provider dropdown to see all options
    const providerDropdown = page.locator('select').first();

    // Verify our newly created provider is in the dropdown options
    await expect(providerDropdown.locator(`option[text="${providerName}"]`)).toBeVisible();

    // Alternative check: get all option texts and verify our provider is included
    const options = await providerDropdown.locator('option').allTextContents();
    expect(options).toContain(providerName);

    // ✅ Test passed: Provider appears in dropdown immediately after creation
  });

  test('provider appears in project edit modal dropdown as well', async ({ page }) => {
    // Generate random provider name
    const randomId = Math.random().toString(36).substring(2, 15);
    const providerName = `edit-test-provider-${randomId}`;

    // First create a project to edit later
    await page.getByTestId('settings-button').click();
    await page.getByTestId('add-instance-button').click();
    await page.getByTestId('provider-card-anthropic').click();
    await page.getByTestId('instance-name-input').fill('initial-provider');
    await page.getByTestId('api-key-input').fill('sk-initial-12345');
    await page.getByTestId('create-instance-button').click();
    await page.getByRole('button', { name: 'Close modal' }).click();

    // Create a test project
    await page.getByTestId('create-project-button').click();
    await page.getByTestId('project-path-input').fill('/tmp/edit-test-project');
    await page.getByTestId('project-wizard-continue-button').click();
    await page.getByTestId('project-wizard-continue-button').click();
    await page.getByTestId('create-project-submit').click();

    // Wait for project to be created and navigate to it
    await expect(page.getByText('edit-test-project')).toBeVisible();

    // Now add a new provider while in the project
    await page.getByTestId('settings-button').click();
    await page.getByTestId('add-instance-button').click();
    await page.getByTestId('provider-card-openai').click();
    await page.getByTestId('instance-name-input').fill(providerName);
    await page.getByTestId('api-key-input').fill('sk-test-67890');
    await page.getByTestId('create-instance-button').click();
    await page.getByRole('button', { name: 'Close modal' }).click();

    // Open project settings to edit the project
    await page.locator('[data-testid*="project-settings"]').first().click();

    // Verify the new provider appears in the edit dropdown
    await expect(page.getByText('Default Provider')).toBeVisible();
    const editProviderDropdown = page.locator('select[data-testid*="provider"]').first();

    // Verify our newly created provider is in the edit dropdown
    const editOptions = await editProviderDropdown.locator('option').allTextContents();
    expect(editOptions).toContain(providerName);

    // ✅ Test passed: Provider appears in edit dropdown immediately after creation
  });
});
