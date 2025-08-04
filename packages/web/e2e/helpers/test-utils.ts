// ABOUTME: Reusable E2E test utilities for common operations
// ABOUTME: Centralizes UI interactions to reduce maintenance when UI changes

import { Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';

// Environment setup utilities
export interface TestEnvironment {
  tempDir: string;
  originalLaceDir: string | undefined;
  projectName: string;
}

export async function setupTestEnvironment(): Promise<TestEnvironment> {
  // Use the same temp directory pattern as core test utils
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lace-test-'));
  const originalLaceDir = process.env.LACE_DIR;
  process.env.LACE_DIR = tempDir;
  
  const projectName = `E2E Test Project ${Date.now()}`;
  
  return { tempDir, originalLaceDir, projectName };
}

export async function cleanupTestEnvironment(env: TestEnvironment) {
  if (env.originalLaceDir !== undefined) {
    process.env.LACE_DIR = env.originalLaceDir;
  } else {
    delete process.env.LACE_DIR;
  }

  delete process.env.ANTHROPIC_KEY;

  if (env.tempDir && fs.existsSync(env.tempDir)) {
    await fs.promises.rm(env.tempDir, { recursive: true, force: true });
  }
}

// Project management utilities
export async function createProject(page: Page, projectName: string, tempDir: string) {
  // Navigate to home page
  await page.goto('/');
  
  // Wait for page to load
  await page.waitForTimeout(2000);
  
  // Take screenshot before clicking for debugging
  await page.screenshot({ path: 'debug-before-new-project.png' });
  
  // Look for the New Project button with various selectors
  const newProjectButton = page.locator('button:has-text("New Project")')
    .or(page.locator('[data-testid="new-project-button"]'))
    .or(page.locator('button').filter({ hasText: 'New Project' }))
    .first();
  
  await newProjectButton.waitFor({ timeout: 10000 });
  await newProjectButton.click();
  
  // Wait a moment after clicking
  await page.waitForTimeout(1000);
  
  // Take screenshot after clicking for debugging
  await page.screenshot({ path: 'debug-after-new-project-click.png' });
  
  // Wait for the project creation modal to appear
  await expect(page.getByRole('heading', { name: 'Create New Project' }).first()).toBeVisible({ timeout: 10000 });
  
  // Find the directory input field using the actual placeholder we discovered
  const directoryInput = page.locator('input[placeholder="/path/to/your/project"]');
  await directoryInput.waitFor({ timeout: 5000 });
  
  // Create a project directory path that includes the project name
  const projectPath = path.join(tempDir, projectName.replace(/\s+/g, '-').toLowerCase());
  
  // Create the directory first so validation passes
  await fs.promises.mkdir(projectPath, { recursive: true });
  
  // Fill the directory path
  await directoryInput.fill(projectPath);
  
  // Trigger events to activate form validation
  await directoryInput.blur();
  await page.waitForTimeout(1000);
  
  // Click the Create Project button - it should be enabled now
  const createButton = page.locator('button:has-text("Create Project")');
  await createButton.waitFor({ state: 'visible', timeout: 5000 });
  
  // Wait for button to be enabled (form validation should pass with valid directory)
  await expect(createButton).toBeEnabled({ timeout: 5000 });
  
  // Click the button
  await createButton.click();
  
  // Wait for project to be created and become visible in the sidebar
  // Use test ID to reliably identify when we're in the project interface
  await expect(page.locator('[data-testid="current-project-name"], [data-testid="current-project-name-desktop"]').first()).toBeVisible({ timeout: 15000 });
  
  // Also verify we're in the chat interface (project creation should dump us there)
  await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', { timeout: 10000 });
}

export async function selectProject(page: Page, projectName: string) {
  await page.click(`text=${projectName}`);
  // Wait for project to be selected - could add specific checks here
  await page.waitForTimeout(1000);
}

// Session management utilities
export async function createSession(page: Page, sessionName: string) {
  // Look for session creation input
  const sessionInput = page.locator('input[placeholder*="Session name"]').or(page.locator('input[placeholder*="session"]')).first();
  await sessionInput.waitFor({ timeout: 10000 });
  
  await sessionInput.fill(sessionName);
  await page.click('button:has-text("Create")');
  
  // Wait for session to appear
  await expect(page.getByText(sessionName)).toBeVisible({ timeout: 10000 });
}

export async function selectSession(page: Page, sessionName: string) {
  await page.click(`text=${sessionName}`);
  await page.waitForTimeout(1000);
}

// Agent management utilities
export async function createAgent(page: Page, agentName: string, provider?: string) {
  // Click to create new agent
  await page.click('button:has-text("New Agent")');
  
  // Fill agent name
  const agentNameInput = page.locator('input[placeholder*="Agent name"]').or(page.locator('[data-testid="agent-name-input"]')).first();
  await agentNameInput.waitFor({ timeout: 10000 });
  await agentNameInput.fill(agentName);
  
  // Select provider if specified
  if (provider) {
    const providerSelect = page.locator('select[name="provider"]').first();
    if (await providerSelect.isVisible()) {
      await providerSelect.selectOption(provider);
    }
  }
  
  // Submit agent creation
  await page.click('button:has-text("Create Agent")').or(page.click('[data-testid="confirm-spawn-agent"]'));
  
  // Wait for agent to appear
  await expect(page.getByText(agentName)).toBeVisible({ timeout: 10000 });
}

export async function selectAgent(page: Page, agentName: string) {
  await page.click(`text=${agentName}`);
  await page.waitForTimeout(1000);
}

// Messaging utilities
export async function sendMessage(page: Page, message: string) {
  // Look for message input field with various possible selectors
  const messageInput = page.locator('textarea[placeholder*="Message"]')
    .or(page.locator('input[placeholder*="message"]'))
    .or(page.locator('[data-testid="message-input"]'))
    .first();
  
  await messageInput.waitFor({ timeout: 10000 });
  await messageInput.fill(message);
  
  // Find and click send button
  const sendButton = page.locator('button[title*="Send"]')
    .or(page.locator('button:has-text("Send")'))
    .or(page.locator('button:has(svg)').last())
    .first();
  
  await sendButton.click();
}

export async function waitForStopButton(page: Page, timeout: number = 5000) {
  const stopButton = page.locator('button[title*="Stop"]')
    .or(page.locator('button:has-text("Stop")'))
    .first();
  
  await stopButton.waitFor({ timeout });
  return stopButton;
}

export async function clickStopButton(page: Page) {
  const stopButton = await waitForStopButton(page);
  await stopButton.click();
}

export async function waitForSendButton(page: Page, timeout: number = 5000) {
  const sendButton = page.locator('button[title*="Send"]')
    .or(page.locator('button:has-text("Send")'))
    .first();
  
  await sendButton.waitFor({ timeout });
  return sendButton;
}

// Verification utilities
export async function verifyMessageVisible(page: Page, message: string, timeout: number = 10000) {
  // Look for the message in the conversation area, not in input fields
  const messageInConversation = page.getByText(message).and(page.locator('span, div, p')).first();
  await expect(messageInConversation).toBeVisible({ timeout });
}

export async function verifyNoMessage(page: Page, message: string) {
  await expect(page.getByText(message)).not.toBeVisible();
}

// Wait utilities
export async function waitForTimeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Create project with specific provider for tool approval tests
export async function createProjectWithProvider(page: Page, projectName: string, tempDir: string, provider: string, model: string) {
  // Navigate to home page
  await page.goto('/');
  
  // Wait for page to load
  await page.waitForTimeout(2000);
  
  // Click "New Project" button
  const newProjectButton = page.locator('button:has-text("New Project")')
    .or(page.locator('[data-testid="new-project-button"]'))
    .or(page.locator('button').filter({ hasText: 'New Project' }))
    .first();
  
  await newProjectButton.waitFor({ timeout: 10000 });
  await newProjectButton.click();
  
  // Wait for the project creation modal to appear
  await expect(page.getByRole('heading', { name: 'Create New Project' }).first()).toBeVisible({ timeout: 10000 });
  
  // Find the directory input field
  const directoryInput = page.locator('input[placeholder="/path/to/your/project"]');
  await directoryInput.waitFor({ timeout: 5000 });
  
  // Create the project directory
  const projectPath = path.join(tempDir, projectName.replace(/\s+/g, '-').toLowerCase());
  await fs.promises.mkdir(projectPath, { recursive: true });
  
  // Fill in the directory path
  await directoryInput.fill(projectPath);
  await directoryInput.blur();
  
  // Wait for form validation to complete
  await page.waitForTimeout(1000);
  
  // Click "Advanced Options" to show provider selection
  await page.click('text=Advanced Options');
  await page.waitForTimeout(1000);
  
  // Wait for provider selection to appear using specific test ID
  const providerSelect = page.locator('[data-testid="create-project-provider-select"]');
  await providerSelect.waitFor({ timeout: 5000 });
  
  // Debug: log available options to understand what values are expected
  const providerOptions = await providerSelect.locator('option').allTextContents();
  console.log('Available provider options:', providerOptions);
  
  // Debug: log option values 
  const providerValues = await providerSelect.locator('option').evaluateAll(
    options => options.map(opt => (opt as HTMLOptionElement).value)
  );
  console.log('Available provider values:', providerValues);
  
  await providerSelect.selectOption(provider);
  
  // Wait for models to load after provider selection
  await page.waitForTimeout(1000);
  
  // Select the model using specific test ID
  const modelSelect = page.locator('[data-testid="create-project-model-select"]');
  await modelSelect.selectOption(model);
  
  // Click Create Project button
  const createButton = page.locator('button:has-text("Create Project")');
  await createButton.waitFor({ state: 'visible', timeout: 5000 });
  
  // Ensure the button is enabled
  await expect(createButton).toBeEnabled({ timeout: 10000 });
  
  // Take a screenshot before clicking to debug
  await page.screenshot({ path: 'debug-before-create-project.png' });
  
  await createButton.click();
  
  // Wait for the modal to disappear (indicates project creation completed)
  // Target the specific modal heading (the one with the X button)
  await expect(page.locator('.fixed.inset-0 h3:has-text("Create New Project")')).not.toBeVisible({ timeout: 20000 });
  
  // Wait for project to be created and become visible in the sidebar
  // Use test ID to reliably identify when we're in the project interface
  await expect(page.locator('[data-testid="current-project-name"], [data-testid="current-project-name-desktop"]').first()).toBeVisible({ timeout: 15000 });
  
  // Wait for the chat interface to be ready
  await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', { timeout: 10000 });
}