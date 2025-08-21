// ABOUTME: End-to-end test for basic user onboarding and first message workflow using standardized patterns
// ABOUTME: Tests complete journey from landing page to receiving AI response with proper isolation

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

test.describe('Basic User Journey', () => {
  let testEnv: TestEnvironment;

  test.beforeEach(async ({ page }) => {
    // Setup isolated test environment with proper mocking
    testEnv = await setupTestEnvironment();
    await page.goto(testEnv.serverUrl);
  });

  test.afterEach(async () => {
    if (testEnv) {
      await cleanupTestEnvironment(testEnv);
    }
  });

  test('complete flow: onboarding → project creation → first message', async ({ page }) => {
    // Step 1: User lands on the application (already done in beforeEach)

    // Step 2: Setup provider first
    await setupAnthropicProvider(page);

    // Step 3: Create a new project in isolated environment
    const projectPath = path.join(testEnv.tempDir, 'basic-journey-project');
    await fs.promises.mkdir(projectPath, { recursive: true });

    await createProject(page, 'Basic Journey Project', projectPath);

    // Step 4: Verify we're now in the chat interface
    await getMessageInput(page);

    // Step 5: Send a message to the AI
    const testMessage = 'Hello, this is my first message!';
    await sendMessage(page, testMessage);

    // Step 6: Verify our message appears in the conversation
    await verifyMessageVisible(page, testMessage);

    // Step 7: Verify AI response appears (mocked by E2E test server)
    await expect(
      page.getByText("I'm a helpful AI assistant. How can I help you today?")
    ).toBeVisible({ timeout: 15000 });

    // Step 8: Verify chat interface is ready for next message
    const messageInput = await getMessageInput(page);
    await expect(messageInput).toBeVisible();
    await expect(messageInput).toBeEnabled();
  });
});
