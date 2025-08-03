// ABOUTME: Reusable E2E test utilities for common operations
// ABOUTME: Centralizes UI interactions to reduce maintenance when UI changes

import { Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Environment setup utilities
export interface TestEnvironment {
  tempDir: string;
  originalLaceDir: string | undefined;
  projectName: string;
}

export async function setupTestEnvironment(): Promise<TestEnvironment> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lace-e2e-test-'));
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
  
  // Wait for project to be created and become visible
  // The project name is derived from the directory path (lowercased with dashes)
  const displayedProjectName = projectName.replace(/\s+/g, '-').toLowerCase();
  await expect(page.getByRole('heading', { name: displayedProjectName })).toBeVisible({ timeout: 15000 });
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
  await expect(page.getByText(message)).toBeVisible({ timeout });
}

export async function verifyNoMessage(page: Page, message: string) {
  await expect(page.getByText(message)).not.toBeVisible();
}

// Wait utilities
export async function waitForTimeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}