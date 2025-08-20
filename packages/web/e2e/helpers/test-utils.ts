// ABOUTME: Reusable E2E test utilities for common operations
// ABOUTME: Centralizes UI interactions and per-test server management

import { Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { createServer } from 'net';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';

/**
 * Find an available port by attempting to create a server
 */
async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);

    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object' && 'port' in address) {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error('Unable to get port from server address'));
      }
    });
  });
}

/**
 * Wait for server to be ready by attempting HTTP requests
 */
async function waitForServer(url: string, timeoutMs: number = 30000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${url}/api/health`).catch(() => null);
      if (response?.ok) {
        console.log(`✅ Server ready at ${url}`);
        return;
      }
    } catch {
      // Server not ready yet
    }

    // Wait before retrying
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Server at ${url} failed to start within ${timeoutMs}ms`);
}

/**
 * Start a test server with isolated LACE_DIR
 */
async function startTestServer(
  tempDir: string
): Promise<{ serverUrl: string; serverProcess: ChildProcess }> {
  // Find available port
  const port = await getAvailablePort();
  const serverUrl = `http://localhost:${port}`;

  console.log(`🚀 Starting test server with LACE_DIR=${tempDir} on port ${port}`);

  // Start server process with isolated environment
  const serverProcess = spawn('npx', ['tsx', 'server-custom.ts'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: port.toString(),
      LACE_DIR: tempDir,
      ANTHROPIC_KEY: 'test-anthropic-key-for-e2e',
      LACE_DB_PATH: path.join(tempDir, 'lace.db'),
      NODE_ENV: 'test',
    },
  });

  // Handle server output
  serverProcess.stdout?.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.log(`[SERVER:${port}] ${output}`);
  });

  serverProcess.stderr?.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.error(`[SERVER:${port}] ${output}`);
  });

  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`Server process ${port} exited with code ${code}`);
    }
  });

  // Wait for server to be ready
  await waitForServer(serverUrl);

  return { serverUrl, serverProcess };
}

// Environment setup utilities
export interface TestEnvironment {
  tempDir: string;
  originalLaceDir: string | undefined;
  projectName: string;
  serverUrl: string;
  serverProcess: ChildProcess;
}

export async function setupTestEnvironment(): Promise<TestEnvironment> {
  // Create isolated temp directory for this test
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lace-test-'));
  const originalLaceDir = process.env.LACE_DIR;

  // Start isolated test server
  const { serverUrl, serverProcess } = await startTestServer(tempDir);

  const projectName = `E2E Test Project ${Date.now()}`;

  return {
    tempDir,
    originalLaceDir,
    projectName,
    serverUrl,
    serverProcess,
  };
}

export async function cleanupTestEnvironment(env: TestEnvironment) {
  console.log(`🧹 Cleaning up test environment: ${env.tempDir}`);

  // Kill server process
  if (env.serverProcess && !env.serverProcess.killed) {
    console.log(`🛑 Stopping server process`);
    env.serverProcess.kill('SIGTERM');

    // Wait for graceful shutdown, then force kill if needed
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (!env.serverProcess.killed) {
          console.log(`🔨 Force killing server process`);
          env.serverProcess.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      env.serverProcess.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  // Restore original LACE_DIR (though this is less critical now with per-test servers)
  if (env.originalLaceDir !== undefined) {
    process.env.LACE_DIR = env.originalLaceDir;
  } else {
    delete process.env.LACE_DIR;
  }

  delete process.env.ANTHROPIC_KEY;

  // Clean up temp directory
  if (
    env.tempDir &&
    (await fs.promises
      .stat(env.tempDir)
      .then(() => true)
      .catch(() => false))
  ) {
    await fs.promises.rm(env.tempDir, { recursive: true, force: true });
    console.log(`✅ Cleaned up temp directory: ${env.tempDir}`);
  }
}

// Project management utilities
export async function createProject(
  page: Page,
  projectName: string,
  tempDir: string,
  serverUrl?: string
) {
  // Navigate to home page (use serverUrl if provided, otherwise assume page is already at the right URL)
  if (serverUrl) {
    await page.goto(serverUrl);
  }
  await page.goto('/');

  // Wait for page to load
  await page.waitForTimeout(2000);

  // Take screenshot before clicking for debugging
  // await page.screenshot({ path: 'debug-before-new-project.png' });

  // Look for the New Project button with various selectors - handle both empty and existing project states
  const newProjectButton = page
    .locator('button:has-text("Create your first project")')
    .or(page.locator('button:has-text("Create New Project")'))
    .or(page.locator('button:has-text("New Project")'))
    .or(page.locator('[data-testid="new-project-button"]'))
    .or(page.locator('button').filter({ hasText: 'New Project' }))
    .first();

  await newProjectButton.waitFor({ timeout: 10000 });
  await newProjectButton.click();

  // Wait a moment after clicking
  await page.waitForTimeout(1000);

  // Take screenshot after clicking for debugging
  // await page.screenshot({ path: 'debug-after-new-project-click.png' });

  // Wait for the project creation modal to appear
  await expect(page.getByRole('heading', { name: 'Create New Project' }).first()).toBeVisible({
    timeout: 10000,
  });

  // Find the directory input field using the actual placeholder we discovered
  const directoryInput = page.locator('input[placeholder="/path/to/your/project"]');
  await directoryInput.waitFor({ timeout: 5000 });

  // Create a project directory path that includes the project name
  const projectPath = path.join(tempDir, projectName.replace(/\s+/g, '-').toLowerCase());

  // Create the directory first so validation passes
  await fs.promises.mkdir(projectPath, { recursive: true });

  // Verify project directory was created successfully
  if (
    !(await fs.promises
      .stat(projectPath)
      .then(() => true)
      .catch(() => false))
  ) {
    throw new Error(`Failed to create project directory: ${projectPath}`);
  }

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
  await expect(
    page
      .locator('[data-testid="current-project-name"], [data-testid="current-project-name-desktop"]')
      .first()
  ).toBeVisible({ timeout: 15000 });

  // Also verify we're in the chat interface (project creation should dump us there)
  await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', {
    timeout: 10000,
  });
}

async function selectProject(page: Page, projectName: string) {
  await page.click(`text=${projectName}`);
  // Wait for project to be selected - could add specific checks here
  await page.waitForTimeout(1000);
}

// Session management utilities
export async function createSession(page: Page, sessionName: string) {
  // Look for session creation input
  const sessionInput = page
    .locator('input[placeholder*="Session name"]')
    .or(page.locator('input[placeholder*="session"]'))
    .first();
  await sessionInput.waitFor({ timeout: 10000 });

  await sessionInput.fill(sessionName);
  await page.click('button:has-text("Create")');

  // Wait for session to appear
  await expect(page.getByText(sessionName)).toBeVisible({ timeout: 10000 });
}

async function selectSession(page: Page, sessionName: string) {
  await page.click(`text=${sessionName}`);
  await page.waitForTimeout(1000);
}

// Agent management utilities
export async function createAgent(page: Page, agentName: string, provider?: string) {
  // Click to create new agent
  await page.click('button:has-text("New Agent")');

  // Fill agent name
  const agentNameInput = page
    .locator('input[placeholder*="Agent name"]')
    .or(page.locator('[data-testid="agent-name-input"]'))
    .first();
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
  const createAgentButton = page
    .locator('button:has-text("Create Agent")')
    .or(page.locator('[data-testid="confirm-spawn-agent"]'));
  await createAgentButton.click();

  // Wait for agent to appear
  await expect(page.getByText(agentName)).toBeVisible({ timeout: 10000 });
}

export async function selectAgent(page: Page, agentName: string) {
  await page.click(`text=${agentName}`);
  await page.waitForTimeout(1000);
}

// Helper to get message input with fallback selectors
export function getMessageInput(page: Page) {
  return page
    .locator('textarea[placeholder*="Message"]')
    .or(page.locator('input[placeholder*="message"]'))
    .or(page.locator('[data-testid="message-input"]'))
    .or(page.locator('[data-testid="message-input"]'))
    .first();
}

// Messaging utilities
export async function sendMessage(page: Page, message: string) {
  // Use the shared message input helper
  const messageInput = getMessageInput(page);

  await messageInput.waitFor({ timeout: 10000 });
  await messageInput.fill(message);

  // Find and click send button
  const sendButton = page
    .locator('button[title*="Send"]')
    .or(page.locator('button:has-text("Send")'))
    .or(page.locator('button:has(svg)').last())
    .first();

  await sendButton.click();
}

export async function waitForStopButton(page: Page, timeout: number = 5000) {
  const stopButton = page
    .locator('button[title*="Stop"]')
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
  const sendButton = page
    .locator('button[title*="Send"]')
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
async function waitForTimeout(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Create project with specific provider for tool approval tests
async function createProjectWithProvider(
  page: Page,
  projectName: string,
  tempDir: string,
  providerInstanceId: string,
  modelId: string
) {
  // Navigate to home page
  await page.goto('/');

  // Wait for page to load
  await page.waitForTimeout(2000);

  // Click "New Project" button - handle both empty and existing project states
  const newProjectButton = page
    .locator('button:has-text("Create your first project")')
    .or(page.locator('button:has-text("Create New Project")'))
    .or(page.locator('button:has-text("New Project")'))
    .or(page.locator('[data-testid="new-project-button"]'))
    .or(page.locator('button').filter({ hasText: 'New Project' }))
    .first();

  await newProjectButton.waitFor({ timeout: 10000 });
  await newProjectButton.click();

  // Wait for the project creation modal to appear
  await expect(page.getByRole('heading', { name: 'Create New Project' }).first()).toBeVisible({
    timeout: 10000,
  });

  // Find the directory input field
  const directoryInput = page.locator('input[placeholder="/path/to/your/project"]');
  await directoryInput.waitFor({ timeout: 5000 });

  // Create the project directory
  const projectPath = path.join(tempDir, projectName.replace(/\s+/g, '-').toLowerCase());
  await fs.promises.mkdir(projectPath, { recursive: true });

  // Verify project directory was created successfully
  if (
    !(await fs.promises
      .stat(projectPath)
      .then(() => true)
      .catch(() => false))
  ) {
    throw new Error(`Failed to create project directory: ${projectPath}`);
  }

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
  const providerValues = await providerSelect
    .locator('option')
    .evaluateAll((options) => options.map((opt) => (opt as HTMLOptionElement).value));
  console.log('Available provider values:', providerValues);

  await providerSelect.selectOption(providerInstanceId);

  // Wait for models to load after provider selection
  await page.waitForTimeout(1000);

  // Select the model using specific test ID
  const modelSelect = page.locator('[data-testid="create-project-model-select"]');
  await modelSelect.selectOption(modelId);

  // Click Create Project button
  const createButton = page.locator('button:has-text("Create Project")');
  await createButton.waitFor({ state: 'visible', timeout: 5000 });

  // Ensure the button is enabled
  await expect(createButton).toBeEnabled({ timeout: 10000 });

  // Take a screenshot before clicking to debug
  // await page.screenshot({ path: 'debug-before-create-project.png' });

  await createButton.click();

  // Wait for the modal to disappear (indicates project creation completed)
  // Target the specific modal heading (the one with the X button)
  await expect(page.locator('.fixed.inset-0 h3:has-text("Create New Project")')).not.toBeVisible({
    timeout: 20000,
  });

  // Wait for project to be created and become visible in the sidebar
  // Use test ID to reliably identify when we're in the project interface
  await expect(
    page
      .locator('[data-testid="current-project-name"], [data-testid="current-project-name-desktop"]')
      .first()
  ).toBeVisible({ timeout: 15000 });

  // Wait for the chat interface to be ready
  await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', {
    timeout: 10000,
  });
}

// Provider configuration utilities
export async function setupAnthropicProvider(
  page: Page,
  apiKey: string = 'sk-fake-key'
): Promise<void> {
  console.log('Setting up Anthropic provider configuration...');

  // Look for the settings/gear icon in the sidebar
  const settingsSelectors = [
    '[data-testid="settings-button"]',
    'button:has([data-testid="gear-icon"])',
    'button:has-text("Settings")',
    '[title="Settings"]',
    '[aria-label="Settings"]',
    'button svg[data-icon="gear"]',
    'button svg[data-icon="cog"]',
    'button svg[data-icon="settings"]',
    '.sidebar button:last-child', // Often settings is the last button
    'nav button:last-child',
  ];

  let settingsButton;
  for (const selector of settingsSelectors) {
    settingsButton = page.locator(selector).first();
    if (await settingsButton.isVisible().catch(() => false)) {
      console.log(`Found settings button with selector: ${selector}`);
      break;
    }
  }

  if (!settingsButton || !(await settingsButton.isVisible().catch(() => false))) {
    // Take a screenshot to debug
    await page.screenshot({ path: 'debug-settings-search.png' });
    console.log('Could not find settings button, checking page content...');

    // Log available buttons for debugging
    const buttons = await page.locator('button').all();
    console.log(`Found ${buttons.length} buttons on page`);

    throw new Error('Could not find settings button or gear icon');
  }

  await settingsButton.click();
  console.log('Clicked settings button');

  // Wait for settings modal/page to open
  await page.waitForTimeout(2000);

  // Look for add provider button or provider instances section
  const providerSelectors = [
    'button:has-text("Add Provider")',
    'button:has-text("Add New Provider")',
    'button:has-text("Create Provider")',
    'button:has-text("+")', // Could be a plus icon button
    'text="Provider Instances"',
    'text="Provider"',
    'text="Providers"',
    'text="Anthropic"',
    'text="API Configuration"',
    'text="AI Provider"',
    'button:has-text("Configure Provider")',
    'button:has-text("Anthropic")',
  ];

  let providerElement;
  for (const selector of providerSelectors) {
    providerElement = page.locator(selector).first();
    if (await providerElement.isVisible().catch(() => false)) {
      console.log(`Found provider section with selector: ${selector}`);
      break;
    }
  }

  if (!providerElement || !(await providerElement.isVisible().catch(() => false))) {
    await page.screenshot({ path: 'debug-provider-search.png' });
    throw new Error('Could not find provider configuration section');
  }

  // Click on the provider element
  await providerElement.click();
  console.log('Clicked provider section');
  await page.waitForTimeout(1000);

  // Wait for provider configuration form
  await page.waitForTimeout(1000);

  // After clicking provider section, look for "Add your first instance" or similar
  const addInstanceSelectors = [
    // Try different ways to find the "Add your first instance" text/button
    ':has-text("Add your first instance")',
    ':has-text("Add your first")',
    'button:has-text("Add your first instance")',
    'button:has-text("Add instance")',
    'button:has-text("Create your first instance")',
    'a:has-text("Add your first instance")',
    'div:has-text("Add your first instance")',
    'span:has-text("Add your first instance")',
    '*:has-text("Add your first") >> visible=true',
    'button:has-text("Add Provider")',
    'button:has-text("Add New Provider")',
    'button:has-text("Create Provider")',
    'button:has-text("Add")',
    'button:has-text("New")',
    'button:has-text("+")',
    'text="Add your first instance"',
    'text="Create your first instance"',
  ];

  // Debug: log all buttons and text content to understand the UI
  const allButtons = await page.locator('button').all();
  console.log(`Found ${allButtons.length} buttons after clicking Provider Instances:`);
  for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
    const button = allButtons[i];
    const text = await button.textContent().catch(() => '');
    const isVisible = await button.isVisible().catch(() => false);
    console.log(`Button ${i}: "${text}" visible=${isVisible}`);
  }

  // Look for all text on page containing relevant keywords
  const pageText = await page.textContent('body');
  console.log('Page text includes:');
  if (pageText && pageText.toLowerCase().includes('instance')) {
    console.log('  - Contains "instance"');
  }
  if (pageText && pageText.toLowerCase().includes('add')) {
    console.log('  - Contains "add"');
  }
  if (pageText && pageText.toLowerCase().includes('create')) {
    console.log('  - Contains "create"');
  }
  if (pageText && pageText.toLowerCase().includes('first')) {
    console.log('  - Contains "first"');
  }

  // Log all visible text elements that might be clickable
  const clickableElements = await page
    .locator('*:has-text("Add"), *:has-text("Create"), *:has-text("instance")')
    .all();
  console.log(`Found ${clickableElements.length} elements containing relevant text`);
  for (let i = 0; i < Math.min(clickableElements.length, 5); i++) {
    const element = clickableElements[i];
    const text = await element.textContent().catch(() => '');
    const tagName = await element.evaluate((el) => el.tagName).catch(() => '');
    const isVisible = await element.isVisible().catch(() => false);
    console.log(`  Element ${i}: ${tagName} "${text.substring(0, 50)}" visible=${isVisible}`);
  }

  let addProviderButton;
  for (const selector of addInstanceSelectors) {
    addProviderButton = page.locator(selector).first();
    if (await addProviderButton.isVisible().catch(() => false)) {
      console.log(`Found add provider button with selector: ${selector}`);
      await addProviderButton.click();
      await page.waitForTimeout(2000); // Give more time for form to appear
      break;
    }
  }

  // Look for API key input field
  const apiKeySelectors = [
    'input[placeholder*="API"]',
    'input[placeholder*="key"]',
    'input[placeholder*="sk-"]',
    'input[type="password"]',
    'input[name*="api"]',
    'input[name*="key"]',
    'textarea[placeholder*="API"]',
    'textarea[placeholder*="key"]',
    'input[id*="api"]',
    'input[id*="key"]',
    'input[class*="api"]',
    'input[class*="key"]',
  ];

  // Look for provider type selection (dropdown, radio buttons, etc.)
  const providerTypeSelectors = [
    'select[name*="provider"]',
    'select[name*="type"]',
    'input[value="anthropic"]',
    'button:has-text("Anthropic")',
    'label:has-text("Anthropic")',
    'option:has-text("Anthropic")',
  ];

  for (const selector of providerTypeSelectors) {
    const providerTypeElement = page.locator(selector).first();
    if (await providerTypeElement.isVisible().catch(() => false)) {
      console.log(`Found provider type selector with selector: ${selector}`);
      if (selector.startsWith('select')) {
        await providerTypeElement.selectOption('anthropic');
      } else if (selector.startsWith('input')) {
        await providerTypeElement.check();
      } else {
        await providerTypeElement.click();
      }
      await page.waitForTimeout(1000);
      break;
    }
  }

  let apiKeyInput;
  for (const selector of apiKeySelectors) {
    apiKeyInput = page.locator(selector).first();
    if (await apiKeyInput.isVisible().catch(() => false)) {
      console.log(`Found API key input with selector: ${selector}`);
      break;
    }
  }

  if (!apiKeyInput || !(await apiKeyInput.isVisible().catch(() => false))) {
    await page.screenshot({ path: 'debug-api-key-search.png' });
    console.log('Taking screenshot of current state for debugging...');

    // Log all input elements on the page for debugging
    const allInputs = await page.locator('input, textarea, select').all();
    console.log(`Found ${allInputs.length} input elements on page`);
    for (let i = 0; i < allInputs.length; i++) {
      const input = allInputs[i];
      const tagName = await input.evaluate((el) => el.tagName);
      const placeholder = await input.getAttribute('placeholder').catch(() => 'none');
      const name = await input.getAttribute('name').catch(() => 'none');
      const type = await input.getAttribute('type').catch(() => 'none');
      console.log(
        `Input ${i}: ${tagName} placeholder="${placeholder}" name="${name}" type="${type}"`
      );
    }

    throw new Error('Could not find API key input field');
  }

  await apiKeyInput.fill(apiKey);
  console.log('Filled API key');

  // Save the configuration
  const saveSelectors = [
    'button:has-text("Save")',
    'button:has-text("Add")',
    'button:has-text("Configure")',
    'button:has-text("Create")',
    'button:has-text("Submit")',
    'button[type="submit"]',
  ];

  let saveButton;
  for (const selector of saveSelectors) {
    saveButton = page.locator(selector).first();
    if (await saveButton.isVisible().catch(() => false)) {
      console.log(`Found save button with selector: ${selector}`);
      break;
    }
  }

  if (saveButton && (await saveButton.isVisible().catch(() => false))) {
    await saveButton.click();
    console.log('Clicked save button');
    await page.waitForTimeout(2000);
  }

  // Try to close settings modal
  const closeSelectors = [
    'button:has-text("Close")',
    'button:has-text("Done")',
    '[aria-label="Close"]',
    'button:has-text("×")',
    '.modal button[aria-label="close"]',
  ];

  for (const selector of closeSelectors) {
    const closeButton = page.locator(selector).first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
      console.log('Closed settings modal');
      break;
    }
  }

  console.log('Anthropic provider configuration completed');
}
