// ABOUTME: Reusable E2E helper functions for common UI interactions
// ABOUTME: Component-aware functions using proper testids for reliable testing

import { Page } from '@playwright/test';

/**
 * Settings and Configuration Helpers
 */

/** Open the settings modal using the testid */
export async function openSettingsModal(page: Page): Promise<void> {
  const settingsButton = page.locator('[data-testid="settings-button"]');
  await settingsButton.waitFor({ state: 'visible', timeout: 5000 });
  await settingsButton.click();

  // Wait for settings modal to open
  await page.waitForSelector('text="Configuration"', { timeout: 10000 });
}

/** Navigate to a specific settings tab */
export async function navigateToSettingsTab(page: Page, tabName: string): Promise<void> {
  const tab = page.locator(`button:has-text("${tabName}")`);
  if (await tab.isVisible()) {
    await tab.click();
  }
}

/** Close the settings modal using the dismiss button */
export async function closeSettingsModal(page: Page): Promise<void> {
  // Use .first() since there might be multiple close buttons (nested modals)
  const closeButton = page.locator('[aria-label="Close modal"]').first();
  await closeButton.waitFor({ state: 'visible', timeout: 5000 });

  // Force click to get past any overlay issues
  await closeButton.click({ force: true });
}

/**
 * Provider Instance Management Helpers
 */

/** Click the appropriate add instance button based on current state */
export async function clickAddInstanceButton(page: Page): Promise<void> {
  // Wait for Provider Instances section
  await page.waitForSelector('text="Provider Instances"', { timeout: 10000 });

  // Look for the "Add Your First Instance" button first
  const addFirstInstanceButton = page.locator('[data-testid="add-first-instance-button"]');
  const isFirstInstanceVisible = await addFirstInstanceButton.isVisible().catch(() => false);

  let addButton = addFirstInstanceButton;
  if (!isFirstInstanceVisible) {
    // Try the regular "Add Instance" button (for when instances already exist)
    addButton = page.locator('[data-testid="add-instance-button"]');
  }

  await addButton.waitFor({ state: 'visible', timeout: 5000 });
  await addButton.click();
}

/** Select a provider from the provider catalog */
export async function selectProvider(page: Page, providerId: string): Promise<void> {
  // Wait for AddInstanceModal to open
  await page.waitForSelector('text="Select Provider"', { timeout: 5000 });

  // Click on provider card using testid
  const providerCard = page.locator(`[data-testid="provider-card-${providerId}"]`);
  await providerCard.waitFor({ state: 'visible', timeout: 5000 });
  await providerCard.click();
}

/** Fill in provider configuration form */
export async function configureProviderInstance(
  page: Page,
  config: {
    apiKey: string;
    displayName?: string;
    endpoint?: string;
  }
): Promise<void> {
  // Wait for configuration step
  await page.waitForSelector('text="Configure Instance"', { timeout: 5000 });

  // Fill in API key
  const apiKeyInput = page.locator('[data-testid="api-key-input"]');
  await apiKeyInput.waitFor({ state: 'visible', timeout: 5000 });
  await apiKeyInput.fill(config.apiKey);

  // Optionally fill other fields if provided
  if (config.displayName) {
    const nameInput = page.locator('[data-testid="instance-name-input"]');
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill(config.displayName);
    }
  }

  if (config.endpoint) {
    const endpointInput = page.locator('[data-testid="endpoint-input"]');
    if (await endpointInput.isVisible().catch(() => false)) {
      await endpointInput.fill(config.endpoint);
    }
  }
}

/** Submit provider instance creation */
export async function createProviderInstance(page: Page): Promise<void> {
  const createButton = page.locator('[data-testid="create-instance-button"]');
  await createButton.waitFor({ state: 'visible', timeout: 5000 });
  await createButton.click();

  // Wait for instance to be created
  await page.waitForSelector('text="1 instance configured"', { timeout: 10000 });
}

/**
 * Combined Provider Setup Function
 */

/** Complete provider setup workflow */
export async function setupProvider(
  page: Page,
  providerId: string,
  config: {
    apiKey: string;
    displayName?: string;
    endpoint?: string;
  }
): Promise<void> {
  console.log(`Setting up ${providerId} provider configuration...`);

  // Check if provider is already configured - try multiple indicators
  const existingProviders = await Promise.race([
    page.locator('text="1 instance configured"').count(),
    page.locator('text="instance configured"').count(),
    page.locator('text="instances configured"').count(),
  ]);

  if (existingProviders > 0) {
    console.log('Provider already configured, skipping setup');
    return;
  }

  // Open settings and navigate to providers
  await openSettingsModal(page);
  await navigateToSettingsTab(page, 'Providers');

  // Set up the provider instance
  try {
    await clickAddInstanceButton(page);
    await selectProvider(page, providerId);
    await configureProviderInstance(page, config);
    await createProviderInstance(page);
  } catch (error) {
    // If instance already exists, just continue
    if (error instanceof Error && error.message.includes('already exists')) {
      console.log('Provider instance already exists, continuing...');
    } else {
      throw error;
    }
  }

  // Close settings modal
  await closeSettingsModal(page);

  console.log(`${providerId} provider configuration completed`);
}

/**
 * Project Creation Helpers
 */

/** Click the create project button using proper testid - handles both onboarding and project selector scenarios */
export async function clickCreateProjectButton(page: Page): Promise<void> {
  // Try FirstProjectHero button first (onboarding flow)
  const firstProjectButton = page.getByTestId('create-first-project-button');

  try {
    await firstProjectButton.waitFor({ state: 'visible', timeout: 3000 });
    await firstProjectButton.click();
    console.log('Clicked FirstProjectHero create button');
    return;
  } catch (error) {
    console.log('FirstProjectHero button not found, trying ProjectSelectorPanel...');
  }

  // Fall back to ProjectSelectorPanel button (regular project creation)
  const createButton = page.getByTestId('create-project-button');
  await createButton.waitFor({ state: 'visible', timeout: 5000 });
  await createButton.click();
  console.log('Clicked ProjectSelectorPanel create button');
}

/** Fill project creation form */
export async function fillProjectForm(page: Page, name: string, path: string): Promise<void> {
  // Fill project path
  const pathInput = page.getByTestId('project-path-input');
  await pathInput.waitFor({ state: 'visible', timeout: 5000 });
  await pathInput.fill(path);

  // Fill name input only if it's visible (advanced mode)
  const nameInput = page.getByTestId('project-name-input');
  const nameInputCount = await nameInput.count();
  if (nameInputCount > 0) {
    await nameInput.waitFor({ state: 'visible', timeout: 2000 });
    await nameInput.fill(name);
  }
}

/** Navigate through project creation wizard steps */
export async function navigateProjectWizardSteps(page: Page): Promise<void> {
  // Look for Continue button using testid (more reliable than text)
  const continueButton = page.locator('[data-testid="project-wizard-continue-button"]');

  // Check if we're in wizard mode (continue button exists)
  const continueCount = await continueButton.count();

  if (continueCount > 0) {
    // We're in simplified mode wizard - need to go through steps
    // Step 2 -> 3
    if (await continueButton.isVisible().catch(() => false)) {
      await continueButton.waitFor({ state: 'visible', timeout: 3000 });
      await continueButton.click();

      // Wait a moment for step 3 to load
      await page.waitForTimeout(1000);

      // Step 3 -> 4 (same button, different step)
      if (await continueButton.isVisible().catch(() => false)) {
        await continueButton.waitFor({ state: 'visible', timeout: 3000 });
        await continueButton.click();

        // Wait for step 4 (final step with submit)
        await page.waitForTimeout(1000);
      }
    }
  }
}

/** Submit project creation */
export async function submitProjectCreation(page: Page): Promise<void> {
  const submitButton = page.getByTestId('create-project-submit');
  await submitButton.waitFor({ state: 'visible', timeout: 5000 });
  await submitButton.click();
}

/** Complete project creation workflow */
export async function createProject(page: Page, name: string, path: string): Promise<void> {
  await clickCreateProjectButton(page);
  await fillProjectForm(page, name, path);
  await navigateProjectWizardSteps(page);
  await submitProjectCreation(page);
}
