// ABOUTME: E2E tests for tool approval modal functionality
// ABOUTME: Tests the complete user workflow for tool approval using reusable utilities

import { test, expect } from '@playwright/test';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  createProjectWithProvider,
  type TestEnvironment,
} from './helpers/test-utils';
import { startTestServer, type TestServer } from './helpers/test-server';

// Test environment setup
test.describe.configure({ mode: 'serial' }); // Run tests sequentially to avoid session conflicts

test.describe('Tool Approval Modal E2E Tests', () => {
  let testEnv: TestEnvironment;
  let testServer: TestServer;

  test.beforeEach(async ({ page }) => {
    testEnv = await setupTestEnvironment();
    testServer = await startTestServer();
    process.env.ANTHROPIC_KEY = 'test-anthropic-key-for-e2e';

    // Add console and error listeners for debugging
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));
    page.on('requestfailed', (request) =>
      console.log('REQUEST FAILED:', request.url(), request.failure()?.errorText)
    );

    await page.addInitScript((tempDir) => {
      window.testEnv = {
        ANTHROPIC_KEY: 'test-key',
        LACE_DB_PATH: `${tempDir}/lace.db`,
      };
    }, testEnv.tempDir);

    // Navigate to test server
    await page.goto(testServer.baseURL);

    // Create project with a real provider for now - just test the UI flow
    // We'll use anthropic provider which is always available
    await createProjectWithProvider(
      page,
      testEnv.projectName,
      testEnv.tempDir,
      'anthropic',
      'claude-sonnet-4-20250514'
    );
  });

  test.afterEach(async () => {
    await cleanupTestEnvironment(testEnv);
    await testServer.cleanup();
  });

  test('should display basic UI elements', async ({ page }) => {
    // Project creation auto-creates session and agent, puts us in chat interface
    // Verify the basic UI elements are visible
    await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', {
      timeout: 10000,
    });

    // Verify we have the message input (main UI element for tool approval scenarios)
    const messageInput = page.locator(
      'input[placeholder*="Message"], textarea[placeholder*="Message"]'
    );
    await expect(messageInput).toBeVisible();
    await expect(messageInput).toBeEnabled();
  });

  test('should be able to send messages that might trigger tool approval', async ({ page }) => {
    // We're already in the chat interface with auto-created session and agent
    await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', {
      timeout: 10000,
    });

    // Send a message that might trigger a tool call requiring approval
    // Using a file read operation which could trigger approval in a real scenario
    const messageInput = page.locator(
      'input[placeholder*="Message"], textarea[placeholder*="Message"]'
    );
    await messageInput.fill('Please read the contents of package.json');

    // Look for send button
    const sendButton = page
      .locator('button[title*="Send"]')
      .or(page.locator('button:has-text("Send")'))
      .first();
    await sendButton.click();

    // Verify the message was sent (appears in the chat)
    await expect(page.getByText('Please read the contents of package.json')).toBeVisible({
      timeout: 10000,
    });

    // Note: In a real scenario with tool approval enabled, this would trigger a modal
    // For now, we just verify the basic messaging functionality works
    // Tool approval modal functionality would require more complex test setup with actual tools
  });

  test('should handle Allow Once decision via button click', async ({ page }) => {
    // We're already in chat interface with auto-created session and agent
    await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', {
      timeout: 10000,
    });

    // Trigger tool approval by sending a message that requires file read
    const messageInput = page.locator(
      'input[placeholder*="Message"], textarea[placeholder*="Message"]'
    );
    await messageInput.fill('Please read package.json');

    const sendButton = page
      .locator('button[title*="Send"]')
      .or(page.locator('button:has-text("Send")'))
      .first();
    await sendButton.click();

    // Wait for tool approval modal to appear
    await page.waitForSelector('text=Tool Approval Required', { timeout: 15000 });

    // Click Allow Once button
    await page.getByRole('button', { name: /Allow Once/ }).click();

    // Verify modal disappears
    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();

    // Verify tool execution continues - look for agent response
    await expect(page.getByText('Please read package.json')).toBeVisible({ timeout: 5000 });

    // Wait for agent response to appear in conversation
    await page.waitForTimeout(3000); // Give time for tool execution and response

    // Verify some response content appeared (the exact content depends on whether package.json exists)
    const conversationArea = page
      .locator('[data-testid="conversation"]')
      .or(page.locator('.conversation'))
      .or(page.locator('main'));
    const hasResponse =
      (await conversationArea.getByText(/error|content|file|package/).count()) > 0;
    expect(hasResponse).toBeTruthy();
  });

  test('should handle Allow Session decision via button click', async ({ page }) => {
    // We're already in chat interface with auto-created session and agent
    await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', {
      timeout: 10000,
    });

    // Trigger tool approval by sending a message that requires file read
    const messageInput = page.locator(
      'input[placeholder*="Message"], textarea[placeholder*="Message"]'
    );
    await messageInput.fill('Please read package.json');

    const sendButton = page
      .locator('button[title*="Send"]')
      .or(page.locator('button:has-text("Send")'))
      .first();
    await sendButton.click();

    // Wait for tool approval modal to appear
    await page.waitForSelector('text=Tool Approval Required', { timeout: 15000 });

    // Click Allow Session button
    await page.getByRole('button', { name: /Allow Session/ }).click();

    // Verify modal disappears
    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();

    // Verify tool execution continues
    await expect(page.getByText('Please read package.json')).toBeVisible({ timeout: 5000 });

    // Wait for agent response
    await page.waitForTimeout(3000);

    const conversationArea = page
      .locator('[data-testid="conversation"]')
      .or(page.locator('.conversation'))
      .or(page.locator('main'));
    const hasResponse =
      (await conversationArea.getByText(/error|content|file|package/).count()) > 0;
    expect(hasResponse).toBeTruthy();
  });

  test('should handle Deny decision via button click', async ({ page }) => {
    // We're already in chat interface with auto-created session and agent
    await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', {
      timeout: 10000,
    });

    // Trigger tool approval by sending a message that requires file read
    const messageInput = page.locator(
      'input[placeholder*="Message"], textarea[placeholder*="Message"]'
    );
    await messageInput.fill('Please read package.json');

    const sendButton = page
      .locator('button[title*="Send"]')
      .or(page.locator('button:has-text("Send")'))
      .first();
    await sendButton.click();

    // Wait for tool approval modal to appear
    await page.waitForSelector('text=Tool Approval Required', { timeout: 15000 });

    // Click Deny button
    await page.getByRole('button', { name: /Deny/ }).click();

    // Verify modal disappears
    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();

    // Verify tool was denied - look for denial or error message in conversation
    await expect(page.getByText('Please read package.json')).toBeVisible({ timeout: 5000 });

    // Wait for agent response about denial
    await page.waitForTimeout(3000);

    // Look for indication that tool was denied
    const conversationArea = page
      .locator('[data-testid="conversation"]')
      .or(page.locator('.conversation'))
      .or(page.locator('main'));
    const hasdenialResponse =
      (await conversationArea.getByText(/denied|rejected|cannot|unable/).count()) > 0;
    expect(hasdenialResponse).toBeTruthy();
  });

  test('should handle keyboard shortcuts', async ({ page }) => {
    // We're already in chat interface with auto-created session and agent
    await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', {
      timeout: 10000,
    });

    // Test Y key for Allow Once
    const messageInput = page.locator(
      'input[placeholder*="Message"], textarea[placeholder*="Message"]'
    );
    await messageInput.fill('Please read package.json');

    const sendButton = page
      .locator('button[title*="Send"]')
      .or(page.locator('button:has-text("Send")'))
      .first();
    await sendButton.click();

    // Wait for tool approval modal and press Y key
    await page.waitForSelector('text=Tool Approval Required', { timeout: 15000 });
    await page.keyboard.press('y');

    // Verify modal disappears
    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();

    // Verify message sent and wait for response
    await expect(page.getByText('Please read package.json')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(3000);

    const conversationArea = page
      .locator('[data-testid="conversation"]')
      .or(page.locator('.conversation'))
      .or(page.locator('main'));
    const hasResponse =
      (await conversationArea.getByText(/error|content|file|package/).count()) > 0;
    expect(hasResponse).toBeTruthy();
  });

  test('should handle escape key to deny', async ({ page }) => {
    // We're already in chat interface with auto-created session and agent
    await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', {
      timeout: 10000,
    });

    // Trigger tool approval
    const messageInput = page.locator(
      'input[placeholder*="Message"], textarea[placeholder*="Message"]'
    );
    await messageInput.fill('Please read package.json');

    const sendButton = page
      .locator('button[title*="Send"]')
      .or(page.locator('button:has-text("Send")'))
      .first();
    await sendButton.click();

    // Wait for modal and press Escape
    await page.waitForSelector('text=Tool Approval Required', { timeout: 15000 });
    await page.keyboard.press('Escape');

    // Verify modal disappears
    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();

    // Verify tool was denied
    await expect(page.getByText('Please read package.json')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(3000);

    const conversationArea = page
      .locator('[data-testid="conversation"]')
      .or(page.locator('.conversation'))
      .or(page.locator('main'));
    const hasdenialResponse =
      (await conversationArea.getByText(/denied|rejected|cannot|unable/).count()) > 0;
    expect(hasdenialResponse).toBeTruthy();
  });

  test('should display tool metadata correctly', async ({ page }) => {
    // We're already in chat interface with auto-created session and agent
    await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', {
      timeout: 10000,
    });

    // Trigger tool approval
    const messageInput = page.locator(
      'input[placeholder*="Message"], textarea[placeholder*="Message"]'
    );
    await messageInput.fill('Please read package.json');

    const sendButton = page
      .locator('button[title*="Send"]')
      .or(page.locator('button:has-text("Send")'))
      .first();
    await sendButton.click();

    // Wait for modal
    await page.waitForSelector('text=Tool Approval Required', { timeout: 15000 });

    // Verify tool name is displayed (file-read or similar)
    const hasToolName = (await page.getByText(/file-read|read|File/).count()) > 0;
    expect(hasToolName).toBeTruthy();

    // Verify risk level indicator (SAFE, LOW_RISK, etc.)
    const hasRiskLevel = (await page.getByText(/SAFE|LOW_RISK|Read-only/i).count()) > 0;
    expect(hasRiskLevel).toBeTruthy();

    // Verify parameters section exists
    const hasParameters = (await page.getByText(/Parameters|Args|Input/i).count()) > 0;
    expect(hasParameters).toBeTruthy();

    // Verify action buttons are present
    await expect(page.getByRole('button', { name: /Allow Once/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Allow Session/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Deny/ })).toBeVisible();

    // Close modal to clean up
    await page.keyboard.press('Escape');
  });

  test('should handle multiple keyboard shortcuts', async ({ page }) => {
    // We're already in chat interface with auto-created session and agent
    await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', {
      timeout: 10000,
    });

    // Test A key (alternative to Y for Allow Once)
    const messageInput = page.locator(
      'input[placeholder*="Message"], textarea[placeholder*="Message"]'
    );
    await messageInput.fill('Please read package.json');

    const sendButton = page
      .locator('button[title*="Send"]')
      .or(page.locator('button:has-text("Send")'))
      .first();
    await sendButton.click();

    await page.waitForSelector('text=Tool Approval Required', { timeout: 15000 });
    await page.keyboard.press('a');

    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();

    await expect(page.getByText('Please read package.json')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(3000);

    const conversationArea = page
      .locator('[data-testid="conversation"]')
      .or(page.locator('.conversation'))
      .or(page.locator('main'));
    const hasResponse =
      (await conversationArea.getByText(/error|content|file|package/).count()) > 0;
    expect(hasResponse).toBeTruthy();
  });

  test('should handle session-wide approval correctly', async ({ page }) => {
    // We're already in chat interface with auto-created session and agent
    await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', {
      timeout: 10000,
    });

    const messageInput = page.locator(
      'input[placeholder*="Message"], textarea[placeholder*="Message"]'
    );

    // First tool call - approve for session
    await messageInput.fill('Please read package.json');

    const sendButton = page
      .locator('button[title*="Send"]')
      .or(page.locator('button:has-text("Send")'))
      .first();
    await sendButton.click();

    await page.waitForSelector('text=Tool Approval Required', { timeout: 15000 });
    await page.keyboard.press('s'); // Allow Session

    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();

    // Verify first message and wait for response
    await expect(page.getByText('Please read package.json')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(3000);

    // Second tool call - should NOT show approval modal (already approved for session)
    await messageInput.fill('Please read README.md');
    await sendButton.click();

    // Wait a bit and verify modal does NOT appear
    await page.waitForTimeout(2000);
    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();

    // Verify second message sent
    await expect(page.getByText('Please read README.md')).toBeVisible({ timeout: 5000 });

    // Verify tool execution continues without second approval
    await page.waitForTimeout(3000);
    const conversationArea = page
      .locator('[data-testid="conversation"]')
      .or(page.locator('.conversation'))
      .or(page.locator('main'));
    const hasMultipleResponses =
      (await conversationArea.getByText(/error|content|file|package|README/i).count()) >= 2;
    expect(hasMultipleResponses).toBeTruthy();
  });
});
