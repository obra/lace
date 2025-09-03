// ABOUTME: E2E test to reproduce and verify fix for streaming content duplication
// ABOUTME: Tests that streaming content appears only once, not doubled/multiplied

import { test, expect } from '@playwright/test';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  type TestEnvironment,
} from './helpers/test-utils';
import {
  createProject,
  setupAnthropicProvider,
  getMessageInput,
  sendMessage,
  verifyMessageVisible,
} from './helpers/ui-interactions';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Streaming Content Duplication Bug', () => {
  let testEnv: TestEnvironment;

  test.beforeEach(async ({ page }) => {
    testEnv = await setupTestEnvironment();
    await page.goto(testEnv.serverUrl);
  });

  test.afterEach(async () => {
    if (testEnv) {
      await cleanupTestEnvironment(testEnv);
    }
  });

  test('should not display duplicate streaming content', async ({ page }) => {
    // Setup provider and project
    await setupAnthropicProvider(page);

    const projectPath = path.join(testEnv.tempDir, 'duplication-test-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Duplication Test', projectPath);

    await getMessageInput(page);

    // Send message to trigger streaming
    const userMessage = 'Tell me a short story about a cat';
    await sendMessage(page, userMessage);
    await verifyMessageVisible(page, userMessage);

    // Wait for streaming to begin
    await page.waitForTimeout(1000);

    // Wait for some streaming content to appear
    await expect(page.getByText('This').first()).toBeVisible({ timeout: 5000 });

    // Wait a bit more for potential duplication to manifest
    await page.waitForTimeout(2000);

    // Assert only one streaming snippet is visible at a time
    await expect(page.locator('.timeline-message:has-text("streaming")')).toHaveCount(1);

    // Wait for streaming to complete
    await expect(
      page.getByText('This is a streaming response that demonstrates real-time token generation', {
        exact: false,
      })
    ).toBeVisible({ timeout: 10000 });

    // Final check after streaming completes
    const completeResponseText =
      'This is a streaming response that demonstrates real-time token generation';

    // Assert the complete response appears exactly once
    await expect(page.getByText(completeResponseText, { exact: false })).toHaveCount(1);

    // Assert no duplicate streaming content
    await expect(page.locator('text=This is a streaming')).toHaveCount(1);

    // Additional check: look for duplicate message blocks
    const messageBlocks = await page.locator('.timeline-message, [data-testid="message"]').count();
    const uniqueMessages = new Set();

    // Get text content of each message to check for duplicates
    for (let i = 0; i < messageBlocks; i++) {
      const messageLocator = page.locator('.timeline-message, [data-testid="message"]').nth(i);
      const messageText = await messageLocator.textContent();
      if (messageText && messageText.includes('This is a streaming')) {
        uniqueMessages.add(messageText.trim());
      }
    }

    // Should only have one unique streaming message
    expect(uniqueMessages.size).toBeLessThanOrEqual(1);

    // Verify interface is ready for next interaction
    const messageInput = await getMessageInput(page);
    await expect(messageInput).toBeEnabled();
  });

  test('should transition cleanly from streaming to final message', async ({ page }) => {
    // Setup provider and project
    await setupAnthropicProvider(page);

    const projectPath = path.join(testEnv.tempDir, 'transition-test-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Transition Test', projectPath);

    await getMessageInput(page);

    // Send message to trigger streaming
    const userMessage = 'Write one sentence';
    await sendMessage(page, userMessage);
    await verifyMessageVisible(page, userMessage);

    // Wait for streaming to begin
    await page.waitForTimeout(500);

    // Assert initial streaming content is visible
    await expect(page.getByText('This').first()).toBeVisible();

    // Wait for streaming to complete by waiting for final response
    await expect(
      page.getByText('This is a streaming response that demonstrates real-time token generation', {
        exact: false,
      })
    ).toBeVisible({ timeout: 10000 });

    // After streaming completes, verify clean state
    const finalResponseText =
      'This is a streaming response that demonstrates real-time token generation';

    // Should have exactly one final message, not multiple versions
    const finalMessageCount = await page.getByText(finalResponseText, { exact: false }).count();
    expect(finalMessageCount).toBe(1);

    // No lingering streaming indicators should remain
    const streamingIndicators = await page
      .locator('[data-testid="streaming-content"], .streaming-indicator')
      .count();
    expect(streamingIndicators).toBe(0);

    // Verify clean UI state
    const messageInput = await getMessageInput(page);
    await expect(messageInput).toBeEnabled();
  });
});
