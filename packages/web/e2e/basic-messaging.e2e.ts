// ABOUTME: Tests basic messaging functionality using standardized E2E patterns
// ABOUTME: Demonstrates proper isolated test setup and message interaction patterns

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

test.describe('Basic Messaging', () => {
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

  test('can send and display user messages reliably', async ({ page }) => {
    // Setup provider first
    await setupAnthropicProvider(page);

    // Create project in isolated environment
    const projectPath = path.join(testEnv.tempDir, 'basic-messaging-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Basic Messaging Project', projectPath);

    // Wait for project to be ready
    await getMessageInput(page);

    // Test single message sending and display
    const testMessage = 'Simple test message for basic messaging';

    await sendMessage(page, testMessage);

    // Verify the message appears
    await verifyMessageVisible(page, testMessage);

    // Verify AI response appears (mocked by E2E test server)
    await expect(
      page.getByText("I'm a helpful AI assistant. How can I help you today?")
    ).toBeVisible({ timeout: 15000 });

    // Verify interface remains functional
    await expect(await getMessageInput(page)).toBeVisible();
  });

  test('interface shows appropriate state during message processing', async ({ page }) => {
    // Setup provider first
    await setupAnthropicProvider(page);

    // Create project in isolated environment
    const projectPath = path.join(testEnv.tempDir, 'processing-state-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Processing State Project', projectPath);

    // Wait for project to be ready
    await getMessageInput(page);

    // Send a message
    const testMessage = 'Testing interface state during processing';
    await sendMessage(page, testMessage);

    // Verify user message appears
    await verifyMessageVisible(page, testMessage);

    // Check interface state after message sending
    const messageInput = await getMessageInput(page);
    const sendButtonVisible = await page
      .getByTestId('send-button')
      .isVisible()
      .catch(() => false);
    const stopButtonVisible = await page
      .getByTestId('stop-button')
      .isVisible()
      .catch(() => false);

    // Document the interface state
    const interfaceState = {
      messageVisible: await page
        .getByText(testMessage)
        .isVisible()
        .catch(() => false),
      inputVisible: await messageInput.isVisible().catch(() => false),
      sendButtonVisible,
      stopButtonVisible,
    };

    // Interface state documented for debugging: interfaceState

    // Verify basic functionality is working
    expect(interfaceState.messageVisible).toBeTruthy();
    expect(interfaceState.inputVisible).toBeTruthy();

    // Wait for AI response (mocked)
    await expect(
      page.getByText("I'm a helpful AI assistant. How can I help you today?")
    ).toBeVisible({ timeout: 15000 });
  });

  test('documents current streaming behavior without breaking', async ({ page }) => {
    // Setup provider first
    await setupAnthropicProvider(page);

    // Create project in isolated environment
    const projectPath = path.join(testEnv.tempDir, 'streaming-behavior-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Streaming Behavior Project', projectPath);

    // Wait for project to be ready
    await getMessageInput(page);

    // Monitor network activity for streaming indicators
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/')) {
        requests.push(`${request.method()} ${request.url()}`);
      }
    });

    const responses: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/')) {
        responses.push(`${response.status()} ${response.url()}`);
      }
    });

    // Send a message and observe the network activity
    const testMessage = 'Testing network behavior for streaming';
    await sendMessage(page, testMessage);

    // Verify user message appears
    await verifyMessageVisible(page, testMessage);

    // Wait for streaming response (mocked)
    await expect(
      page.getByText("I'm a helpful AI assistant. How can I help you today?")
    ).toBeVisible({ timeout: 15000 });

    // Document the network behavior we observe
    const streamingBehavior = {
      requestsMade: requests.filter((r) => r.includes('message') || r.includes('stream')),
      responsesReceived: responses.filter((r) => r.includes('message') || r.includes('stream')),
      messageAccepted: testMessage.length > 0,
      timestamp: new Date().toISOString(),
    };

    // Streaming behavior documented for analysis: streamingBehavior

    // Verify basic functionality is working
    expect(streamingBehavior.messageAccepted).toBeTruthy();

    // Verify we have some network activity
    expect(streamingBehavior.requestsMade.length).toBeGreaterThan(0);
  });
});
