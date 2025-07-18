// ABOUTME: Playwright E2E tests for web UI functionality
// ABOUTME: Tests the complete user workflow through a real browser

import { test, expect } from '@playwright/test';

// Define the test environment type
interface TestEnvironment {
  ANTHROPIC_KEY: string;
  LACE_DB_PATH: string;
}

// Extend the Window interface to include our test environment
declare global {
  interface Window {
    testEnv?: TestEnvironment;
  }
}

test.describe('Web UI End-to-End Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test environment
    await page.addInitScript(() => {
      window.testEnv = {
        ANTHROPIC_KEY: 'test-key',
        LACE_DB_PATH: ':memory:',
      };
    });

    // Go to home page and create/select a project for all tests
    await page.goto('/');

    // Create a test project by clicking the "New Project" button
    await page.click('text=New Project');

    // Fill in the project form
    await page.fill('#name', 'E2E Test Project');
    await page.fill('#description', 'Project for E2E testing');
    await page.fill('#workingDirectory', '/tmp/e2e-test');

    // Submit the form
    await page.click('button[type="submit"]');

    // Wait for project to be created and selected
    await expect(page.getByText('E2E Test Project')).toBeVisible();
  });

  test.describe('Session Management', () => {
    test('should create a new session and display it in the UI', async ({ page }) => {
      // Test session creation (project already selected in beforeEach)
      await page.fill('input[placeholder="Session name..."]', 'E2E Test Session');
      await page.click('button:has-text("Create")');

      // Verify session appears in the UI
      await expect(page.getByText('E2E Test Session')).toBeVisible();

      // Verify session has agents
      await expect(page.getByText('0 agents')).toBeVisible();
    });

    test('should persist sessions and load them on page refresh', async ({ page }) => {
      // Create a session (project already selected in beforeEach)
      await page.fill('input[placeholder="Session name..."]', 'Persistent Session');
      await page.click('button:has-text("Create")');

      // Click on the session to select it
      await page.click('text=Persistent Session');

      // Wait for session to be selected and agents to load
      await expect(page.getByText('Agents')).toBeVisible();

      // Select the first agent to enable messaging
      const firstAgent = page.locator('.space-y-2 > div').first();
      await firstAgent.click();

      // Send a message to create conversation history
      await page.fill('input[placeholder="Type your message..."]', 'Hello from E2E test');
      await page.click('button:has-text("Send")');

      // Wait for message to appear
      await expect(page.getByText('Hello from E2E test')).toBeVisible();

      // Refresh the page
      await page.reload();

      // Re-select the project after refresh (if needed)
      await page.click('text=E2E Test Project');

      // Verify session still exists
      await expect(page.getByText('Persistent Session')).toBeVisible();

      // Click on the session again to load history
      await page.click('text=Persistent Session');

      // Verify conversation history is loaded
      await expect(page.getByText('Hello from E2E test')).toBeVisible();
    });

    test('should list all created sessions', async ({ page }) => {
      // Create multiple sessions (project already selected in beforeEach)
      const sessionNames = ['Session 1', 'Session 2', 'Session 3'];

      for (const sessionName of sessionNames) {
        await page.fill('input[placeholder="Session name..."]', sessionName);
        await page.click('button:has-text("Create")');
      }

      // Verify all sessions appear in the sessions list
      for (const sessionName of sessionNames) {
        await expect(page.getByText(sessionName)).toBeVisible();
      }
    });
  });

  test.describe('Agent Management', () => {
    test('should spawn agents and display them in the UI', async ({ page }) => {
      // Create a session first (project already selected in beforeEach)
      await page.fill('input[placeholder="Session name..."]', 'Agent Test Session');
      await page.click('button:has-text("Create")');

      // Click on the session to select it
      await page.click('text=Agent Test Session');

      // Wait for Agents section to appear
      await expect(page.getByText('Agents')).toBeVisible();

      // Spawn a new agent
      await page.click('[data-testid="spawn-agent-button"]');
      await page.fill('[data-testid="agent-name-input"]', 'Test Agent');
      await page.click('[data-testid="confirm-spawn-agent"]');

      // Verify agent appears in the UI
      await expect(page.getByText('Test Agent')).toBeVisible();

      // Verify the agent shows provider and model info
      await expect(page.getByText('anthropic')).toBeVisible();
    });

    test('should allow switching between agents', async ({ page }) => {
      // Create a session and spawn an agent (project already selected in beforeEach)
      await page.fill('input[placeholder="Session name..."]', 'Multi-Agent Session');
      await page.click('button:has-text("Create")');

      // Click on the session to select it
      await page.click('text=Multi-Agent Session');

      // Spawn a new agent
      await page.click('[data-testid="spawn-agent-button"]');
      await page.fill('[data-testid="agent-name-input"]', 'Helper Agent');
      await page.click('[data-testid="confirm-spawn-agent"]');

      // Test switching between agents by clicking on them
      const firstAgent = page.locator('.space-y-2 > div').first();
      await firstAgent.click();
      await expect(firstAgent).toHaveClass(/bg-green-600/);

      const secondAgent = page.locator('.space-y-2 > div').nth(1);
      await secondAgent.click();
      await expect(secondAgent).toHaveClass(/bg-green-600/);
    });
  });

  test.describe('Conversation Flow', () => {
    test('should send messages and receive responses', async ({ page }) => {
      // Create a session (project already selected in beforeEach)
      await page.fill('input[placeholder="Session name..."]', 'Conversation Test');
      await page.click('button:has-text("Create")');

      // Click on the session to select it
      await page.click('text=Conversation Test');

      // Select the first agent to enable messaging
      const firstAgent = page.locator('.space-y-2 > div').first();
      await firstAgent.click();

      // Send a message
      await page.fill('input[placeholder="Type your message..."]', 'Hello, how are you?');
      await page.click('button:has-text("Send")');

      // Verify user message appears
      await expect(page.getByText('Hello, how are you?')).toBeVisible();

      // Wait for agent response (with timeout)
      await page.waitForSelector('.bg-gray-800', { timeout: 10000 });

      // Verify some response content appears (even if it's just the agent thinking)
      await expect(page.locator('.bg-gray-800')).toBeVisible();
    });

    test('should display conversation history correctly', async ({ page }) => {
      // Create a session (project already selected in beforeEach)
      await page.fill('input[placeholder="Session name..."]', 'History Test');
      await page.click('button:has-text("Create")');

      // Click on the session to select it
      await page.click('text=History Test');

      // Select the first agent to enable messaging
      const firstAgent = page.locator('.space-y-2 > div').first();
      await firstAgent.click();

      // Send multiple messages
      const messages = ['First message', 'Second message', 'Third message'];

      for (const message of messages) {
        await page.fill('input[placeholder="Type your message..."]', message);
        await page.click('button:has-text("Send")');
        await expect(page.getByText(message)).toBeVisible();
      }

      // Verify all messages are visible
      for (const message of messages) {
        await expect(page.getByText(message)).toBeVisible();
      }
    });
  });

  test.describe('Basic Error Handling', () => {
    test('should handle basic UI errors gracefully', async ({ page }) => {
      // Create a session (project already selected in beforeEach)
      await page.fill('input[placeholder="Session name..."]', 'Error Test');
      await page.click('button:has-text("Create")');

      // Click on the session to select it
      await page.click('text=Error Test');

      // Try to send a message without selecting an agent
      await page.fill('input[placeholder="Type your message..."]', 'Test message');
      await page.click('button:has-text("Send")');

      // The message input should remain (button should be disabled without agent)
      await expect(page.getByText('Test message')).toBeVisible();
    });
  });
});
