// ABOUTME: Playwright E2E tests for web UI functionality
// ABOUTME: Tests the complete user workflow through a real browser

import { test, expect, Page } from '@playwright/test';

// Mock environment for testing
const TEST_ENV = {
  ANTHROPIC_KEY: 'test-key',
  LACE_DB_PATH: ':memory:',
};

test.describe('Web UI End-to-End Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test environment
    await page.addInitScript(() => {
      (window as any).testEnv = {
        ANTHROPIC_KEY: 'test-key',
        LACE_DB_PATH: ':memory:',
      };
    });
  });

  test.describe('Session Management', () => {
    test('should create a new session and display it in the UI', async ({ page }) => {
      await page.goto('/');

      // Test session creation
      await page.fill('[data-testid="session-name-input"]', 'E2E Test Session');
      await page.click('[data-testid="create-session-button"]');

      // Verify session appears in the UI
      await expect(page.getByText('E2E Test Session')).toBeVisible();
      
      // Verify coordinator agent is displayed
      await expect(page.getByText('Coordinator')).toBeVisible();
    });

    test('should persist sessions and load them on page refresh', async ({ page }) => {
      await page.goto('/');

      // Create a session
      await page.fill('[data-testid="session-name-input"]', 'Persistent Session');
      await page.click('[data-testid="create-session-button"]');

      // Send a message to create conversation history
      await page.fill('[data-testid="message-input"]', 'Hello from E2E test');
      await page.click('[data-testid="send-message-button"]');

      // Wait for response
      await expect(page.getByText('Hello from E2E test')).toBeVisible();

      // Refresh the page
      await page.reload();

      // Verify session still exists
      await expect(page.getByText('Persistent Session')).toBeVisible();
      
      // Verify conversation history is loaded
      await expect(page.getByText('Hello from E2E test')).toBeVisible();
    });

    test('should list all created sessions', async ({ page }) => {
      await page.goto('/');

      // Create multiple sessions
      const sessionNames = ['Session 1', 'Session 2', 'Session 3'];
      
      for (const sessionName of sessionNames) {
        await page.fill('[data-testid="session-name-input"]', sessionName);
        await page.click('[data-testid="create-session-button"]');
      }

      // Verify all sessions appear in the sessions list
      for (const sessionName of sessionNames) {
        await expect(page.getByText(sessionName)).toBeVisible();
      }
    });
  });

  test.describe('Agent Management', () => {
    test('should spawn agents and display them in the UI', async ({ page }) => {
      await page.goto('/');

      // Create a session first
      await page.click('[data-testid="create-session-button"]');
      await page.fill('[data-testid="session-name-input"]', 'Agent Test Session');
      await page.click('[data-testid="confirm-create-session"]');

      // Spawn a new agent
      await page.click('[data-testid="spawn-agent-button"]');
      await page.fill('[data-testid="agent-name-input"]', 'Test Agent');
      await page.click('[data-testid="confirm-spawn-agent"]');

      // Verify agent appears in the UI
      await expect(page.getByText('Test Agent')).toBeVisible();
      
      // Verify both coordinator and spawned agent are visible
      await expect(page.getByText('Coordinator')).toBeVisible();
      await expect(page.getByText('Test Agent')).toBeVisible();
    });

    test('should allow switching between agents', async ({ page }) => {
      await page.goto('/');

      // Create a session and spawn an agent
      await page.click('[data-testid="create-session-button"]');
      await page.fill('[data-testid="session-name-input"]', 'Multi-Agent Session');
      await page.click('[data-testid="confirm-create-session"]');

      await page.click('[data-testid="spawn-agent-button"]');
      await page.fill('[data-testid="agent-name-input"]', 'Helper Agent');
      await page.click('[data-testid="confirm-spawn-agent"]');

      // Test switching between agents
      await page.click('[data-testid="agent-coordinator"]');
      await expect(page.getByText('Coordinator')).toHaveClass(/active/);

      await page.click('[data-testid="agent-helper"]');
      await expect(page.getByText('Helper Agent')).toHaveClass(/active/);
    });
  });

  test.describe('Conversation Flow', () => {
    test('should send messages and receive responses', async ({ page }) => {
      await page.goto('/');

      // Create a session
      await page.click('[data-testid="create-session-button"]');
      await page.fill('[data-testid="session-name-input"]', 'Conversation Test');
      await page.click('[data-testid="confirm-create-session"]');

      // Send a message
      await page.fill('[data-testid="message-input"]', 'Hello, how are you?');
      await page.click('[data-testid="send-message-button"]');

      // Verify user message appears
      await expect(page.getByText('Hello, how are you?')).toBeVisible();

      // Wait for agent response (with timeout)
      await page.waitForSelector('[data-testid="agent-response"]', { timeout: 10000 });
      
      // Verify response appears
      await expect(page.locator('[data-testid="agent-response"]')).toBeVisible();
    });

    test('should display conversation history correctly', async ({ page }) => {
      await page.goto('/');

      // Create a session
      await page.click('[data-testid="create-session-button"]');
      await page.fill('[data-testid="session-name-input"]', 'History Test');
      await page.click('[data-testid="confirm-create-session"]');

      // Send multiple messages
      const messages = ['First message', 'Second message', 'Third message'];
      
      for (const message of messages) {
        await page.fill('[data-testid="message-input"]', message);
        await page.click('[data-testid="send-message-button"]');
        await expect(page.getByText(message)).toBeVisible();
      }

      // Verify all messages are visible in order
      const messageElements = await page.locator('[data-testid="message"]').all();
      expect(messageElements.length).toBeGreaterThanOrEqual(messages.length);
    });

    test('should handle real-time updates via SSE', async ({ page }) => {
      await page.goto('/');

      // Create a session
      await page.click('[data-testid="create-session-button"]');
      await page.fill('[data-testid="session-name-input"]', 'SSE Test');
      await page.click('[data-testid="confirm-create-session"]');

      // Send a message
      await page.fill('[data-testid="message-input"]', 'Test SSE streaming');
      await page.click('[data-testid="send-message-button"]');

      // Wait for thinking indicator
      await expect(page.locator('[data-testid="thinking-indicator"]')).toBeVisible();

      // Wait for streaming response
      await page.waitForSelector('[data-testid="streaming-response"]', { timeout: 10000 });
      
      // Verify thinking indicator disappears
      await expect(page.locator('[data-testid="thinking-indicator"]')).not.toBeVisible();
    });
  });

  test.describe('Session Restoration', () => {
    test('should restore conversation history after page refresh', async ({ page }) => {
      await page.goto('/');

      // Create a session with conversation history
      await page.click('[data-testid="create-session-button"]');
      await page.fill('[data-testid="session-name-input"]', 'Restoration Test');
      await page.click('[data-testid="confirm-create-session"]');

      // Build conversation history
      await page.fill('[data-testid="message-input"]', 'Message 1');
      await page.click('[data-testid="send-message-button"]');
      await expect(page.getByText('Message 1')).toBeVisible();

      await page.fill('[data-testid="message-input"]', 'Message 2');
      await page.click('[data-testid="send-message-button"]');
      await expect(page.getByText('Message 2')).toBeVisible();

      // Refresh the page
      await page.reload();

      // Verify session is restored
      await expect(page.getByText('Restoration Test')).toBeVisible();
      
      // Verify conversation history is loaded
      await expect(page.getByText('Message 1')).toBeVisible();
      await expect(page.getByText('Message 2')).toBeVisible();
    });

    test('should allow continuing conversation after restoration', async ({ page }) => {
      await page.goto('/');

      // Create a session with some history
      await page.click('[data-testid="create-session-button"]');
      await page.fill('[data-testid="session-name-input"]', 'Continue Test');
      await page.click('[data-testid="confirm-create-session"]');

      await page.fill('[data-testid="message-input"]', 'Initial message');
      await page.click('[data-testid="send-message-button"]');
      await expect(page.getByText('Initial message')).toBeVisible();

      // Refresh and continue
      await page.reload();
      
      await page.fill('[data-testid="message-input"]', 'Continuation message');
      await page.click('[data-testid="send-message-button"]');
      
      // Verify both messages are visible
      await expect(page.getByText('Initial message')).toBeVisible();
      await expect(page.getByText('Continuation message')).toBeVisible();
    });
  });

  test.describe('Error Handling', () => {
    test('should handle agent startup errors gracefully', async ({ page }) => {
      await page.goto('/');

      // Create a session
      await page.click('[data-testid="create-session-button"]');
      await page.fill('[data-testid="session-name-input"]', 'Error Test');
      await page.click('[data-testid="confirm-create-session"]');

      // Try to send a message (this might trigger the "Agent is not started" error)
      await page.fill('[data-testid="message-input"]', 'Test message');
      await page.click('[data-testid="send-message-button"]');

      // Check for error handling in UI
      const errorMessage = page.locator('[data-testid="error-message"]');
      if (await errorMessage.isVisible()) {
        await expect(errorMessage).toContainText('Agent is not started');
      }
    });

    test('should handle network errors gracefully', async ({ page }) => {
      await page.goto('/');

      // Create a session
      await page.click('[data-testid="create-session-button"]');
      await page.fill('[data-testid="session-name-input"]', 'Network Test');
      await page.click('[data-testid="confirm-create-session"]');

      // Simulate network failure
      await page.route('**/api/threads/*/message', route => route.abort());

      // Try to send a message
      await page.fill('[data-testid="message-input"]', 'Network test message');
      await page.click('[data-testid="send-message-button"]');

      // Verify error handling
      await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
    });
  });
});