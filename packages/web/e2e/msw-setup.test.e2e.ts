// ABOUTME: Tests MSW (Mock Service Worker) setup and API interception functionality
// ABOUTME: Verifies that external API calls are properly mocked in E2E test environment

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

test.describe('MSW Setup', () => {
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

  test('HTTP mocking intercepts Anthropic API calls in server', async ({ page }) => {
    // Setup provider and create project to trigger API calls through the server
    await setupAnthropicProvider(page);

    const projectPath = path.join(testEnv.tempDir, 'api-mock-test-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'API Mock Test Project', projectPath);

    // Wait for project to be fully loaded
    await getMessageInput(page);

    // Send a message that will trigger an API call - this should be intercepted by our HTTP mocks
    await sendMessage(page, 'test message to verify API mocking');

    // Verify the message appears (proves the test infrastructure is working)
    await verifyMessageVisible(page, 'test message to verify API mocking');

    // Wait for AI response which proves the mocking intercepted the API call
    await expect(
      page.getByText("I'm a helpful AI assistant. How can I help you today?").first()
    ).toBeVisible({ timeout: 15000 });

    // If we get here, it means the HTTP mocking system is working correctly
    expect(true).toBeTruthy(); // Test passes - mocking is functional
  });
});
