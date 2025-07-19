// ABOUTME: E2E tests for tool approval modal functionality
// ABOUTME: Tests the complete user workflow for tool approval in the web UI

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Test environment setup
test.describe.configure({ mode: 'serial' }); // Run tests sequentially to avoid session conflicts

test.describe('Tool Approval Modal E2E Tests', () => {
  let tempDir: string;
  let projectName: string;

  test.beforeEach(async ({ page }) => {
    // Create unique temp directory for this test
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lace-e2e-approval-'));

    // Create unique project name for this test run
    projectName = `Tool Approval Project ${Date.now()}`;

    // Set up test environment with temp directory
    await page.addInitScript((testTempDir) => {
      window.testEnv = {
        ANTHROPIC_KEY: 'test-key',
        LACE_DB_PATH: path.join(testTempDir, 'lace.db'),
      };
    }, tempDir);

    // Set LACE_DIR environment variable for the server
    process.env.LACE_DIR = tempDir;

    // Navigate to the web app
    await page.goto('/');

    // Create a test project first
    await page.click('text=New Project');
    await page.fill('#name', projectName);
    await page.fill('#description', 'Project for tool approval testing');
    await page.fill('#workingDirectory', path.join(tempDir, 'workspace'));
    await page.click('button[type="submit"]');

    // Wait for project to be created and selected
    await expect(page.getByText(projectName)).toBeVisible();

    // Wait for the app to load
    await page.waitForSelector('[data-testid="create-session-button"]');
  });

  test.afterEach(async () => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('should display basic UI elements', async ({ page }) => {
    // Just verify the basic UI loads
    await expect(page.locator('[data-testid="create-session-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="session-name-input"]')).toBeVisible();
  });

  test('should display tool approval modal when tool requires approval', async ({ page }) => {
    // Create a new session with unique name
    const sessionName = `Tool Approval Test ${Date.now()}`;
    await page.fill('[data-testid="session-name-input"]', sessionName);
    await page.click('[data-testid="create-session-button"]');

    // Wait for session to appear in the UI (use first() to handle duplicates)
    await expect(page.locator(`text=${sessionName}`).first()).toBeVisible({ timeout: 10000 });

    // Click on the session to select it
    await page.click(`text=${sessionName}`);

    // Wait for spawn agent button to appear
    await page.waitForSelector('[data-testid="spawn-agent-button"]', { timeout: 10000 });

    // Spawn an agent
    await page.click('[data-testid="spawn-agent-button"]');
    await page.fill('[data-testid="agent-name-input"]', 'Test Agent');
    await page.click('[data-testid="confirm-spawn-agent"]');

    // Wait for agent to appear in the UI (use first() to handle duplicates)
    await expect(page.locator('text=Test Agent').first()).toBeVisible({ timeout: 10000 });

    // Click on the agent to select it (click the agent name in the list, not the status message)
    await page.click('div.font-semibold:has-text("Test Agent")');

    // Wait for message input to be available
    await page.waitForSelector('[data-testid="message-input"]', { timeout: 10000 });

    // Send a message that will trigger a tool call requiring approval
    // Using a file read operation which should trigger approval
    await page.fill('[data-testid="message-input"]', 'Please read the contents of package.json');
    await page.click('[data-testid="send-message-button"]');

    // Wait for the tool approval modal to appear
    await page.waitForSelector('text=Tool Approval Required', { timeout: 15000 });

    // Verify modal is visible and contains expected elements
    await expect(page.locator('text=Tool Approval Required')).toBeVisible();
    await expect(page.getByRole('button', { name: /Allow Once/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Allow Session/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Deny/ })).toBeVisible();

    // Verify countdown timer is present
    await expect(page.locator('text=until auto-deny')).toBeVisible();

    // Verify keyboard shortcuts are shown
    await expect(page.locator('text=[Y/A]')).toBeVisible();
    await expect(page.locator('text=[S]')).toBeVisible();
    await expect(page.locator('text=[N/D]')).toBeVisible();
  });

  test('should handle Allow Once decision via button click', async ({ page }) => {
    // Setup session and agent
    await page.fill('[data-testid="session-name-input"]', 'Allow Once Test');
    await page.click('[data-testid="create-session-button"]');
    await page.waitForSelector('[data-testid="spawn-agent-button"]');

    await page.click('[data-testid="spawn-agent-button"]');
    await page.fill('[data-testid="agent-name-input"]', 'Test Agent');
    await page.click('[data-testid="confirm-spawn-agent"]');
    await page.waitForSelector('[data-testid="message-input"]');

    await page.click('div.font-semibold:has-text("Test Agent")');

    // Trigger tool approval
    await page.fill('[data-testid="message-input"]', 'Please read package.json');
    await page.click('[data-testid="send-message-button"]');

    // Wait for modal and click Allow Once
    await page.waitForSelector('text=Tool Approval Required');
    await page.getByRole('button', { name: /Allow Once/ }).click();

    // Verify modal disappears
    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();

    // Verify tool execution continues (look for file contents or tool result)
    await page.waitForSelector('[data-testid="agent-response"]', { timeout: 10000 });
  });

  test('should handle Allow Session decision via button click', async ({ page }) => {
    // Setup session and agent
    await page.fill('[data-testid="session-name-input"]', 'Allow Session Test');
    await page.click('[data-testid="create-session-button"]');
    await page.waitForSelector('[data-testid="spawn-agent-button"]');

    await page.click('[data-testid="spawn-agent-button"]');
    await page.fill('[data-testid="agent-name-input"]', 'Test Agent');
    await page.click('[data-testid="confirm-spawn-agent"]');
    await page.waitForSelector('[data-testid="message-input"]');

    await page.click('div.font-semibold:has-text("Test Agent")');

    // Trigger tool approval
    await page.fill('[data-testid="message-input"]', 'Please read package.json');
    await page.click('[data-testid="send-message-button"]');

    // Wait for modal and click Allow Session
    await page.waitForSelector('text=Tool Approval Required');
    await page.getByRole('button', { name: /Allow Session/ }).click();

    // Verify modal disappears
    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();

    // Verify tool execution continues
    await page.waitForSelector('[data-testid="agent-response"]', { timeout: 10000 });
  });

  test('should handle Deny decision via button click', async ({ page }) => {
    // Setup session and agent
    await page.fill('[data-testid="session-name-input"]', 'Deny Test');
    await page.click('[data-testid="create-session-button"]');
    await page.waitForSelector('[data-testid="spawn-agent-button"]');

    await page.click('[data-testid="spawn-agent-button"]');
    await page.fill('[data-testid="agent-name-input"]', 'Test Agent');
    await page.click('[data-testid="confirm-spawn-agent"]');
    await page.waitForSelector('[data-testid="message-input"]');

    await page.click('div.font-semibold:has-text("Test Agent")');

    // Trigger tool approval
    await page.fill('[data-testid="message-input"]', 'Please read package.json');
    await page.click('[data-testid="send-message-button"]');

    // Wait for modal and click Deny
    await page.waitForSelector('text=Tool Approval Required');
    await page.getByRole('button', { name: /Deny/ }).click();

    // Verify modal disappears
    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();

    // Verify tool was denied (look for denial message)
    await page.waitForSelector('[data-testid="agent-response"]', { timeout: 10000 });
    await expect(page.locator('text=denied')).toBeVisible();
  });

  test('should handle keyboard shortcuts', async ({ page }) => {
    // Setup session and agent
    await page.fill('[data-testid="session-name-input"]', 'Keyboard Test');
    await page.click('[data-testid="create-session-button"]');
    await page.waitForSelector('[data-testid="spawn-agent-button"]');

    await page.click('[data-testid="spawn-agent-button"]');
    await page.fill('[data-testid="agent-name-input"]', 'Test Agent');
    await page.click('[data-testid="confirm-spawn-agent"]');
    await page.waitForSelector('[data-testid="message-input"]');

    await page.click('div.font-semibold:has-text("Test Agent")');

    // Test Y key for Allow Once
    await page.fill('[data-testid="message-input"]', 'Please read package.json');
    await page.click('[data-testid="send-message-button"]');

    await page.waitForSelector('text=Tool Approval Required');
    await page.keyboard.press('y');

    // Verify modal disappears
    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();

    // Wait for tool execution to complete
    await page.waitForSelector('[data-testid="agent-response"]', { timeout: 10000 });
  });

  test('should handle escape key to deny', async ({ page }) => {
    // Setup session and agent
    await page.fill('[data-testid="session-name-input"]', 'Escape Test');
    await page.click('[data-testid="create-session-button"]');
    await page.waitForSelector('[data-testid="spawn-agent-button"]');

    await page.click('[data-testid="spawn-agent-button"]');
    await page.fill('[data-testid="agent-name-input"]', 'Test Agent');
    await page.click('[data-testid="confirm-spawn-agent"]');
    await page.waitForSelector('[data-testid="message-input"]');

    await page.click('div.font-semibold:has-text("Test Agent")');

    // Trigger tool approval
    await page.fill('[data-testid="message-input"]', 'Please read package.json');
    await page.click('[data-testid="send-message-button"]');

    // Wait for modal and press Escape
    await page.waitForSelector('text=Tool Approval Required');
    await page.keyboard.press('Escape');

    // Verify modal disappears
    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();

    // Verify tool was denied
    await page.waitForSelector('[data-testid="agent-response"]', { timeout: 10000 });
    await expect(page.locator('text=denied')).toBeVisible();
  });

  test.skip('should display tool metadata correctly', async ({ page }) => {
    // Setup session and agent
    await page.fill('[data-testid="session-name-input"]', 'Metadata Test');
    await page.click('[data-testid="create-session-button"]');
    await page.waitForSelector('[data-testid="spawn-agent-button"]');

    await page.click('[data-testid="spawn-agent-button"]');
    await page.fill('[data-testid="agent-name-input"]', 'Test Agent');
    await page.click('[data-testid="confirm-spawn-agent"]');
    await page.waitForSelector('[data-testid="message-input"]');

    await page.click('div.font-semibold:has-text("Test Agent")');

    // Trigger tool approval
    await page.fill('[data-testid="message-input"]', 'Please read package.json');
    await page.click('[data-testid="send-message-button"]');

    // Wait for modal
    await page.waitForSelector('text=Tool Approval Required');

    // Verify tool name is displayed
    await expect(page.locator('text=file-read')).toBeVisible();

    // Verify risk level indicator
    await expect(page.locator('text=SAFE')).toBeVisible();

    // Verify read-only indicator
    await expect(page.locator('text=Read-only')).toBeVisible();

    // Verify parameters section
    await expect(page.locator('text=Parameters:')).toBeVisible();

    // Verify help text
    await expect(page.locator('text=Allow Once: Approve this specific call only')).toBeVisible();
    await expect(page.locator('text=Allow Session: Approve all calls to')).toBeVisible();
    await expect(page.locator('text=Deny: Reject this tool call')).toBeVisible();
  });

  test('should handle timeout and auto-deny', async ({ page }) => {
    // Setup session and agent
    await page.fill('[data-testid="session-name-input"]', 'Timeout Test');
    await page.click('[data-testid="create-session-button"]');
    await page.waitForSelector('[data-testid="spawn-agent-button"]');

    await page.click('[data-testid="spawn-agent-button"]');
    await page.fill('[data-testid="agent-name-input"]', 'Test Agent');
    await page.click('[data-testid="confirm-spawn-agent"]');
    await page.waitForSelector('[data-testid="message-input"]');

    await page.click('div.font-semibold:has-text("Test Agent")');

    // Trigger tool approval
    await page.fill('[data-testid="message-input"]', 'Please read package.json');
    await page.click('[data-testid="send-message-button"]');

    // Wait for modal
    await page.waitForSelector('text=Tool Approval Required');

    // Verify countdown timer is present and decreasing
    await expect(page.locator('text=until auto-deny')).toBeVisible();

    // Check that the timer shows a number (like "30s", "29s", etc.)
    const timerElement = page
      .locator('div:has-text("until auto-deny")')
      .locator('..')
      .locator('div')
      .first();
    await expect(timerElement).toContainText('s');

    // Wait for modal to auto-close (timeout is 30 seconds, but we'll wait a bit longer)
    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible({ timeout: 35000 });

    // Verify tool was denied due to timeout
    await page.waitForSelector('[data-testid="agent-response"]', { timeout: 10000 });
    await expect(page.locator('text=denied')).toBeVisible();
  });

  test('should handle multiple keyboard shortcuts', async ({ page }) => {
    // Setup session and agent
    await page.fill('[data-testid="session-name-input"]', 'Multiple Shortcuts Test');
    await page.click('[data-testid="create-session-button"]');
    await page.waitForSelector('[data-testid="spawn-agent-button"]');

    await page.click('[data-testid="spawn-agent-button"]');
    await page.fill('[data-testid="agent-name-input"]', 'Test Agent');
    await page.click('[data-testid="confirm-spawn-agent"]');
    await page.waitForSelector('[data-testid="message-input"]');

    await page.click('div.font-semibold:has-text("Test Agent")');

    // Test A key (alternative to Y for Allow Once)
    await page.fill('[data-testid="message-input"]', 'Please read package.json');
    await page.click('[data-testid="send-message-button"]');

    await page.waitForSelector('text=Tool Approval Required');
    await page.keyboard.press('a');

    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();
    await page.waitForSelector('[data-testid="agent-response"]', { timeout: 10000 });
  });

  test('should handle session-wide approval correctly', async ({ page }) => {
    // Setup session and agent
    await page.fill('[data-testid="session-name-input"]', 'Session Approval Test');
    await page.click('[data-testid="create-session-button"]');
    await page.waitForSelector('[data-testid="spawn-agent-button"]');

    await page.click('[data-testid="spawn-agent-button"]');
    await page.fill('[data-testid="agent-name-input"]', 'Test Agent');
    await page.click('[data-testid="confirm-spawn-agent"]');
    await page.waitForSelector('[data-testid="message-input"]');

    await page.click('div.font-semibold:has-text("Test Agent")');

    // First tool call - approve for session
    await page.fill('[data-testid="message-input"]', 'Please read package.json');
    await page.click('[data-testid="send-message-button"]');

    await page.waitForSelector('text=Tool Approval Required');
    await page.keyboard.press('s'); // Allow Session

    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();
    await page.waitForSelector('[data-testid="agent-response"]', { timeout: 10000 });

    // Second tool call - should NOT show approval modal (already approved for session)
    await page.fill('[data-testid="message-input"]', 'Please read README.md');
    await page.click('[data-testid="send-message-button"]');

    // Wait a bit and verify modal does NOT appear
    await page.waitForTimeout(2000);
    await expect(page.locator('text=Tool Approval Required')).not.toBeVisible();

    // Verify tool execution continues without approval
    await page.waitForSelector('[data-testid="agent-response"]', { timeout: 10000 });
  });
});
