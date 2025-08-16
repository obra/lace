// ABOUTME: Debug test to isolate WebKit-specific messaging issues
// ABOUTME: Helps identify why sendMessage fails in WebKit but works in Chromium

import { test, expect } from './mocks/setup';
import { createPageObjects } from './page-objects';
import * as fs from 'fs';
import * as path from 'path';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  type TestEnvironment,
} from './helpers/test-utils';

test.describe('WebKit Debug Tests', () => {
  let testEnv: TestEnvironment;

  test.beforeEach(async ({ page }) => {
    testEnv = await setupTestEnvironment();
    await page.goto('/');
  });

  test.afterEach(async () => {
    await cleanupTestEnvironment(testEnv);
  });

  test('debug WebKit message sending', async ({ page }) => {
    const { projectSelector, chatInterface } = createPageObjects(page);

    // Create project
    const projectPath = path.join(testEnv.tempDir, 'webkit-debug-project');
    await fs.promises.mkdir(projectPath, { recursive: true });

    await projectSelector.createProject(testEnv.projectName, projectPath);

    // Wait for chat to be ready
    await chatInterface.waitForChatReady();

    // Debug the chat interface state before sending
    const inputElement = await chatInterface.messageInput.getAttribute('placeholder');
    const sendButtonVisible = await chatInterface.sendButton.isVisible();
    const sendButtonEnabled = await chatInterface.sendButton.isEnabled();

    console.log('WebKit Debug - Chat interface state:', {
      inputPlaceholder: inputElement,
      sendButtonVisible,
      sendButtonEnabled,
      url: page.url(),
    });

    // Try typing a message and checking button state
    await chatInterface.typeMessage('Debug test message');

    const afterTypingEnabled = await chatInterface.sendButton.isEnabled();
    console.log('WebKit Debug - After typing:', { sendButtonEnabled: afterTypingEnabled });

    // Monitor network requests and console logs during send
    const networkRequests: string[] = [];
    const consoleLogs: string[] = [];

    page.on('request', (request) => {
      if (request.url().includes('/api/')) {
        networkRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    page.on('response', (response) => {
      if (response.url().includes('/api/')) {
        networkRequests.push(`${response.status()} ${response.url()}`);
      }
    });

    page.on('console', (msg) => {
      if (
        msg.text().includes('event') ||
        msg.text().includes('message') ||
        msg.text().includes('USER_MESSAGE')
      ) {
        consoleLogs.push(msg.text());
      }
    });

    // Check agent info before sending
    const agentInfo = await page.evaluate(() => {
      // Try to access agent state from window or console
      return {
        // Any global state we can access
        location: window.location.href,
      };
    });
    console.log('WebKit Debug - Agent info before send:', agentInfo);

    // Try clicking send
    try {
      await chatInterface.clickSend();
      console.log('WebKit Debug - Send click successful');

      // Wait for API call to complete
      await page.waitForTimeout(3000);

      console.log('WebKit Debug - Network requests:', networkRequests);
      console.log('WebKit Debug - Console logs:', consoleLogs);

      // Check message visibility over time
      let messageVisible = false;
      for (let i = 0; i < 5; i++) {
        await page.waitForTimeout(1000);
        messageVisible = await page.getByText('Debug test message').isVisible();
        console.log(`WebKit Debug - Message visible after ${i + 1}s:`, messageVisible);
        if (messageVisible) break;
      }

      // Also check for any messages in the conversation area
      const messageLocator = page
        .locator('[data-testid*="message"], .message, [class*="message"]')
        .first();
      const allMessages = await page
        .locator('[data-testid*="message"], .message, [class*="message"]')
        .count();
      console.log('WebKit Debug - Total messages found:', allMessages);

      if (allMessages > 0) {
        const messageText = await messageLocator.textContent();
        const messageHTML = await messageLocator.innerHTML();
        console.log('WebKit Debug - Message text content:', JSON.stringify(messageText));
        console.log('WebKit Debug - Message HTML:', messageHTML.substring(0, 200));
      }
    } catch (error) {
      console.log('WebKit Debug - Send click failed:', error);
    }

    // Also try the alternative selectors used in test-utils
    const alternativeSendButton = page
      .locator('button[title*="Send"]')
      .or(page.locator('button:has-text("Send")'))
      .or(page.locator('button:has(svg)').last())
      .first();

    const altButtonVisible = await alternativeSendButton.isVisible();
    console.log('WebKit Debug - Alternative button selectors visible:', altButtonVisible);

    expect(true).toBe(true); // Test passes - we're just debugging
  });
});
