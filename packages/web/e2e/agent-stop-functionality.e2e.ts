// ABOUTME: E2E test for agent stop functionality using Playwright
// ABOUTME: Tests stopping agent generation mid-stream using reusable test utilities

import { test, expect } from '@playwright/test';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  createProject,
  createSession,
  createAgent,
  selectAgent,
  sendMessage,
  waitForStopButton,
  clickStopButton,
  waitForSendButton,
  verifyMessageVisible,
  verifyNoMessage,
  type TestEnvironment
} from './helpers/test-utils';

test.describe('Agent Stop Functionality E2E Tests', () => {
  let testEnv: TestEnvironment;

  test.beforeEach(async ({ page }) => {
    // Set up test environment
    testEnv = await setupTestEnvironment();

    // Set up environment with test key
    process.env.ANTHROPIC_KEY = 'test-anthropic-key-for-e2e-stop';

    await page.addInitScript((tempDir) => {
      window.testEnv = {
        ANTHROPIC_KEY: 'test-key',
        LACE_DB_PATH: `${tempDir}/lace.db`,
      };
    }, testEnv.tempDir);

    // Create project using reusable utility
    await createProject(page, testEnv.projectName, testEnv.tempDir);
  });

  test.afterEach(async () => {
    await cleanupTestEnvironment(testEnv);
  });

  test('should stop agent generation when stop button is clicked', async ({ page }) => {
    // Create a session
    await createSession(page, 'Stop Test Session');

    // Create an agent (will use default test provider)
    await createAgent(page, 'Slow Test Agent');

    // Select the agent for chat
    await selectAgent(page, 'Slow Test Agent');

    // Send a message that will trigger a response
    await sendMessage(page, 'Hello, please respond slowly');

    // Wait a moment for the request to start processing
    await page.waitForTimeout(500);

    // Verify the UI is in processing state (stop button should appear)
    await waitForStopButton(page, 2000);

    // Click the stop button to abort the response
    await clickStopButton(page);

    // Verify the stop worked - UI should return to idle state
    await waitForSendButton(page, 2000);

    // Verify our user message is visible
    await verifyMessageVisible(page, 'Hello, please respond slowly');

    // Note: We can't easily verify that a response was NOT received without 
    // more complex mocking, but we've verified the stop button flow works
  });

  test('should stop agent generation when ESC key is pressed', async ({ page }) => {
    // Create a session
    await createSession(page, 'ESC Stop Test Session');

    // Create an agent
    await createAgent(page, 'ESC Test Agent');

    // Select the agent for chat
    await selectAgent(page, 'ESC Test Agent');

    // Send a message
    await sendMessage(page, 'Test ESC key stopping');

    // Wait for processing to start
    await page.waitForTimeout(500);
    await waitForStopButton(page, 2000);

    // Press ESC key to stop
    await page.keyboard.press('Escape');

    // Verify stop worked
    await waitForSendButton(page, 2000);

    // Verify the request was stopped
    await verifyMessageVisible(page, 'Test ESC key stopping');
  });

  test('should handle multiple stop attempts gracefully', async ({ page }) => {
    // Create a session
    await createSession(page, 'Multi Stop Test');

    // Create an agent
    await createAgent(page, 'Multi Stop Agent');

    // Select the agent for chat
    await selectAgent(page, 'Multi Stop Agent');

    // Send a message
    await sendMessage(page, 'Test multiple stops');

    // Wait for processing to start
    await page.waitForTimeout(500);
    await waitForStopButton(page, 2000);

    // Click stop multiple times rapidly
    await clickStopButton(page);
    await clickStopButton(page);
    await page.keyboard.press('Escape');

    // Verify system handles multiple stops gracefully
    await waitForSendButton(page, 2000);
    await verifyMessageVisible(page, 'Test multiple stops');
  });
});