// ABOUTME: Reusable E2E helper functions for common UI interactions
// ABOUTME: Component-aware functions using proper testids for reliable testing

import { Page, expect } from '@playwright/test';
import { withTestEnvironment, type TestEnvironment, TIMEOUTS } from './test-utils';
import * as fs from 'fs';
import * as path from 'path';

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

  // Wait for instance creation modal to be dismissed
  await page
    .waitForSelector('[data-testid="create-instance-modal"]', { state: 'hidden', timeout: 10000 })
    .catch(() => {
      // Fallback if modal testid doesn't exist - wait for any modal to close
      return page.waitForSelector('.modal', { state: 'hidden', timeout: 10000 }).catch(() => {
        // Final fallback
        return page.waitForTimeout(2000);
      });
    });

  // Dismiss the settings modal after provider creation
  await closeSettingsModal(page);
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
  // Check if provider is already configured - try multiple indicators
  const existingProviders = await Promise.race([
    page.locator('text="1 instance configured"').count(),
    page.locator('text="instance configured"').count(),
    page.locator('text="instances configured"').count(),
  ]);

  if (existingProviders > 0) {
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
    if (!(error instanceof Error && error.message.includes('already exists'))) {
      throw error;
    }
  }

  await closeSettingsModal(page); // Close the main settings modal
}

/** Setup default Anthropic provider for E2E tests */
export async function setupAnthropicProvider(page: Page): Promise<void> {
  await setupProvider(page, 'anthropic', {
    apiKey: 'test-anthropic-key-for-e2e',
    displayName: 'Test Anthropic Provider',
  });
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
    return;
  } catch {
    // FirstProjectHero button not found, try ProjectSelectorPanel
  }

  // Fall back to ProjectSelectorPanel button (regular project creation)
  const createButton = page.getByTestId('create-project-button');
  await createButton.waitFor({ state: 'visible', timeout: 5000 });
  await createButton.click();
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

  // Wait for navigation to the agent page after submission
  await page.waitForURL(/\/project\/[^\/]+\/session\/[^\/]+\/agent\/[^\/]+/, { timeout: 60000 });

  // Wait for the agent interface to be ready - look for message input instead of network idle
  await getMessageInput(page);
}

/** Complete project creation workflow */
export async function createProject(page: Page, name: string, path: string): Promise<void> {
  await clickCreateProjectButton(page);
  await fillProjectForm(page, name, path);
  await navigateProjectWizardSteps(page);
  await submitProjectCreation(page);
}

/**
 * Chat and Messaging Helpers
 */

/** Get the message input field using testid */
export async function getMessageInput(page: Page) {
  const messageInput = page.locator('[data-testid="message-input"]').first();
  await messageInput.waitFor({ state: 'visible', timeout: 10000 });
  return messageInput;
}

/** Send a message using the message input and send button */
export async function sendMessage(page: Page, message: string): Promise<void> {
  const messageInput = await getMessageInput(page);
  await messageInput.fill(message);

  // Try send button first, fall back to Enter key
  const sendButton = page.locator('[data-testid="send-button"], [data-testid="send"]').first();
  if (await sendButton.isVisible().catch(() => false)) {
    await sendButton.click();
  } else {
    await messageInput.press('Enter');
  }
}

/** Wait for the stop button to appear (indicates streaming is active) */
export async function waitForStopButton(page: Page, timeout: number = 10000): Promise<void> {
  const stopButton = page.locator('[data-testid="stop-button"]').first();
  await stopButton.waitFor({ state: 'visible', timeout });
}

/** Click the stop button to halt streaming */
export async function clickStopButton(page: Page): Promise<void> {
  const stopButton = page.locator('[data-testid="stop-button"]').first();
  await stopButton.waitFor({ state: 'visible', timeout: 5000 });
  await stopButton.click();
}

/** Wait for the send button to appear (indicates streaming has stopped) */
export async function waitForSendButton(page: Page, timeout: number = 10000): Promise<void> {
  const sendButton = page.locator('[data-testid="send-button"], [data-testid="send"]').first();
  await sendButton.waitFor({ state: 'visible', timeout });
}

/** Verify a message is visible on the page */
export async function verifyMessageVisible(
  page: Page,
  message: string,
  timeout: number = 5000
): Promise<void> {
  await page.locator(`text="${message}"`).waitFor({ state: 'visible', timeout });
}

/** Verify a message is NOT visible on the page */
export async function verifyNoMessage(page: Page, message: string): Promise<void> {
  const messageVisible = await page
    .locator(`text="${message}"`)
    .isVisible()
    .catch(() => false);
  if (messageVisible) {
    throw new Error(`Message "${message}" should not be visible but was found`);
  }
}

/**
 * Session and Agent Management Helpers
 */

/** Create a new session - placeholder for now, may need actual implementation */
export async function createSession(page: Page, _sessionName?: string): Promise<void> {
  // This function may need implementation based on actual UI
  // For now, sessions are typically created automatically with projects
  // TODO: Implement if explicit session creation UI exists
  await page.waitForTimeout(100); // Placeholder
}

/** Create a new agent - placeholder for now, may need actual implementation */
export async function createAgent(page: Page, _agentName?: string): Promise<void> {
  // This function may need implementation based on actual UI
  // For now, agents are typically created automatically with projects
  // TODO: Implement if explicit agent creation UI exists
  await page.waitForTimeout(100); // Placeholder
}

/** Select an existing agent - placeholder for now, may need actual implementation */
export async function selectAgent(page: Page, _agentName: string): Promise<void> {
  // This function may need implementation based on actual UI
  // TODO: Implement if agent selection UI exists
  await page.waitForTimeout(100); // Placeholder
}

/**
 * Send message and wait for AI response content
 */
export async function sendMessageAndWaitForResponse(
  page: Page,
  message: string,
  expectedResponse?: string
): Promise<void> {
  await sendMessage(page, message);
  await verifyMessageVisible(page, message);

  const response = expectedResponse || "I'm a helpful AI assistant. How can I help you today?";
  await expect(page.getByText(response)).toBeVisible({ timeout: 15000 });
}

/**
 * Check if streaming is active by looking for stop button
 */
export async function isStreamingActive(page: Page): Promise<boolean> {
  return page
    .getByTestId('stop-button')
    .isVisible()
    .catch(() => false);
}

/**
 * Wait for streaming to start (stop button appears)
 */
export async function waitForStreamingStart(page: Page, timeout: number = 10000): Promise<boolean> {
  try {
    await page.getByTestId('stop-button').waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for streaming to stop (send button returns)
 */
export async function waitForStreamingStop(page: Page, timeout: number = 10000): Promise<boolean> {
  try {
    await page.getByTestId('send-button').waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current chat interface state using testids
 */
export async function getChatInterfaceState(page: Page) {
  return {
    messageInputVisible: await page
      .getByTestId('message-input')
      .isVisible()
      .catch(() => false),
    sendButtonVisible: await page
      .getByTestId('send-button')
      .isVisible()
      .catch(() => false),
    stopButtonVisible: await page
      .getByTestId('stop-button')
      .isVisible()
      .catch(() => false),
    isStreaming: await page
      .getByTestId('stop-button')
      .isVisible()
      .catch(() => false),
  };
}

/**
 * Complete project setup for tests that need a ready-to-use project
 */
export const testWithProject = (
  projectName: string,
  testFn: (page: Page, projectPath: string) => Promise<void>
) => {
  return withTestEnvironment(async (testEnv, page) => {
    await setupAnthropicProvider(page);
    const projectPath = path.join(testEnv.tempDir, projectName.toLowerCase().replace(/\s+/g, '-'));
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, projectName, projectPath);
    await getMessageInput(page);
    await testFn(page, projectPath);
  });
};
