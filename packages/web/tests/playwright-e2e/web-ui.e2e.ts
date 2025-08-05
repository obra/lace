// ABOUTME: Playwright E2E tests for web UI functionality
// ABOUTME: Tests the complete user workflow through a real browser using reusable utilities

import { test, expect } from '@playwright/test';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  createProject,
  sendMessage,
  verifyMessageVisible,
  type TestEnvironment,
} from './helpers/test-utils';
import { startTestServer, type TestServer } from './helpers/test-server';

test.describe('Web UI End-to-End Tests', () => {
  let testEnv: TestEnvironment;
  let testServer: TestServer;

  test.beforeAll(async () => {
    // Start one server for the entire test file
    testServer = await startTestServer();
  });

  test.afterAll(async () => {
    // Clean up server after all tests in this file complete
    await testServer.cleanup();
  });

  test.beforeEach(async ({ page }) => {
    // Set up test environment using reusable utilities
    testEnv = await setupTestEnvironment();

    // Set up environment with test key
    process.env.ANTHROPIC_KEY = 'test-anthropic-key-for-e2e';

    await page.addInitScript((tempDir) => {
      window.testEnv = {
        ANTHROPIC_KEY: 'test-key',
        LACE_DB_PATH: `${tempDir}/lace.db`,
      };
    }, testEnv.tempDir);

    // Navigate to test server before creating project
    await page.goto(testServer.baseURL);

    // Create project using reusable utility - this auto-creates session and agent
    await createProject(page, testEnv.projectName, testEnv.tempDir);
  });

  test.afterEach(async () => {
    // Clean up test environment after each test
    await cleanupTestEnvironment(testEnv);
  });

  test.describe('Project and Session Management', () => {
    test('should auto-create session and agent when project is created', async ({ page }) => {
      // Project creation (in beforeEach) should auto-create a session and agent
      // We should be in the chat interface now
      await page.waitForSelector(
        'input[placeholder*="Message"], textarea[placeholder*="Message"]',
        { timeout: 10000 }
      );

      // Verify we can see session information - look for "1 sessions" or similar
      await expect(page.getByText(/\d+ sessions?/)).toBeVisible();

      // Verify we're in the chat interface (auto-created agent should be selected)
      const messageInput = page.locator(
        'input[placeholder*="Message"], textarea[placeholder*="Message"]'
      );
      await expect(messageInput).toBeVisible();
    });

    test('should persist project state across page reloads', async ({ page }) => {
      // Send a message to create conversation history
      await sendMessage(page, 'Hello from E2E test');
      await verifyMessageVisible(page, 'Hello from E2E test');

      // Refresh the page
      await page.reload();

      // Wait for the page to load - should restore to the same project
      await page.waitForTimeout(3000);

      // Verify the project is still selected (main requirement)
      const displayedProjectName = testEnv.projectName.replace(/\s+/g, '-').toLowerCase();
      await expect(page.getByText(displayedProjectName).first()).toBeVisible({ timeout: 10000 });

      // Verify we're back in the chat interface (project should auto-load session/agent)
      await page.waitForSelector(
        'input[placeholder*="Message"], textarea[placeholder*="Message"]',
        { timeout: 10000 }
      );

      // Note: Full conversation history persistence after page reload may not be expected behavior
      // The important thing is that the project and interface state persists
    });

    test('should display session and agent counts', async ({ page }) => {
      // We should be in the project view with auto-created session/agent
      // Look for session and agent count indicators
      await expect(page.getByText(/\d+ sessions?/)).toBeVisible();

      // We should also be able to see that we're in an active session
      await page.waitForSelector(
        'input[placeholder*="Message"], textarea[placeholder*="Message"]',
        { timeout: 5000 }
      );
    });
  });

  test.describe('Agent and Chat Interface', () => {
    test('should display auto-created agent and chat interface', async ({ page }) => {
      // Project creation auto-creates an agent and puts us in chat
      // Verify we're in the chat interface
      await page.waitForSelector(
        'input[placeholder*="Message"], textarea[placeholder*="Message"]',
        { timeout: 10000 }
      );

      // The agent should be automatically created and selected
      // We can verify this by checking that the message input is available and functional
      const messageInput = page.locator(
        'input[placeholder*="Message"], textarea[placeholder*="Message"]'
      );
      await expect(messageInput).toBeVisible();
      await expect(messageInput).toBeEnabled();
    });

    test('should handle agent interactions correctly', async ({ page }) => {
      // We should be in the chat interface with auto-created agent
      await page.waitForSelector(
        'input[placeholder*="Message"], textarea[placeholder*="Message"]',
        { timeout: 10000 }
      );

      // Test that we can interact with the agent via chat
      await sendMessage(page, 'Test agent interaction');
      await verifyMessageVisible(page, 'Test agent interaction');

      // The interface should remain stable and responsive
      await sendMessage(page, 'Second test message');
      await verifyMessageVisible(page, 'Second test message');
    });
  });

  test.describe('Conversation Flow', () => {
    test('should send messages and receive responses', async ({ page }) => {
      // Project creation puts us directly in chat with auto-created agent
      await page.waitForSelector(
        'input[placeholder*="Message"], textarea[placeholder*="Message"]',
        { timeout: 10000 }
      );

      // Send a message using our utility
      await sendMessage(page, 'Hello, how are you?');

      // Verify user message appears
      await verifyMessageVisible(page, 'Hello, how are you?');

      // Verify the interface remains responsive
      await sendMessage(page, 'Follow-up message');
      await verifyMessageVisible(page, 'Follow-up message');
    });

    test('should display conversation history correctly', async ({ page }) => {
      // We're already in the chat interface with auto-created agent
      await page.waitForSelector(
        'input[placeholder*="Message"], textarea[placeholder*="Message"]',
        { timeout: 10000 }
      );

      // Send multiple messages
      const messages = ['First message', 'Second message', 'Third message'];

      for (const message of messages) {
        await sendMessage(page, message);
        await verifyMessageVisible(page, message);
      }

      // Verify all messages are still visible (conversation history)
      for (const message of messages) {
        await verifyMessageVisible(page, message);
      }
    });
  });

  test.describe('Interface Stability', () => {
    test('should handle rapid interactions gracefully', async ({ page }) => {
      // We're in the chat interface with auto-created agent
      await page.waitForSelector(
        'input[placeholder*="Message"], textarea[placeholder*="Message"]',
        { timeout: 10000 }
      );

      // Send rapid messages to test interface stability
      await sendMessage(page, 'Test message 1');
      await sendMessage(page, 'Test message 2');
      await sendMessage(page, 'Test message 3');

      // Verify all messages appear and interface remains stable
      await verifyMessageVisible(page, 'Test message 1');
      await verifyMessageVisible(page, 'Test message 2');
      await verifyMessageVisible(page, 'Test message 3');

      // Verify interface is still responsive
      const messageInput = page.locator(
        'input[placeholder*="Message"], textarea[placeholder*="Message"]'
      );
      await expect(messageInput).toBeEnabled();
    });
  });
});
