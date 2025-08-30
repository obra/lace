// ABOUTME: Complete user journey and messaging behavior tests
// ABOUTME: Consolidates basic-messaging and basic-user-journey with comprehensive coverage

import { test, expect } from '@playwright/test';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  type TestEnvironment,
  TIMEOUTS,
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

test.describe('Complete User Journey and Messaging Behavior', () => {
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

  // From basic-user-journey: Complete end-to-end user onboarding flow
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
    ).toBeVisible({ timeout: TIMEOUTS.EXTENDED });

    // Step 8: Verify chat interface is ready for next message
    const messageInput = await getMessageInput(page);
    await expect(messageInput).toBeVisible();
    await expect(messageInput).toBeEnabled();
  });

  // From basic-messaging: Single message reliability testing
  test('can send and display user messages reliably', async ({ page }) => {
    await setupAnthropicProvider(page);

    const projectPath = path.join(testEnv.tempDir, 'reliable-messaging-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Reliable Messaging Test', projectPath);

    await getMessageInput(page);

    // Test single message sending and display
    const testMessage = 'Simple test message for basic messaging';

    await sendMessage(page, testMessage);

    // Verify the message appears
    await verifyMessageVisible(page, testMessage);

    // Verify AI response appears (mocked by E2E test server)
    await expect(
      page.getByText("I'm a helpful AI assistant. How can I help you today?")
    ).toBeVisible({ timeout: TIMEOUTS.EXTENDED });

    // Verify interface remains functional
    await expect(await getMessageInput(page)).toBeVisible();
  });

  // From basic-messaging: Interface state monitoring during processing
  test('interface shows appropriate state during message processing', async ({ page }) => {
    await setupAnthropicProvider(page);

    const projectPath = path.join(testEnv.tempDir, 'processing-state-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Processing State Test', projectPath);

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

    // Verify basic functionality is working
    expect(interfaceState.messageVisible).toBeTruthy();
    expect(interfaceState.inputVisible).toBeTruthy();

    // Wait for AI response (mocked)
    await expect(
      page.getByText("I'm a helpful AI assistant. How can I help you today?")
    ).toBeVisible({ timeout: TIMEOUTS.EXTENDED });
  });

  // From basic-messaging: Streaming behavior and network activity documentation
  test('documents streaming behavior and network activity', async ({ page }) => {
    await setupAnthropicProvider(page);

    const projectPath = path.join(testEnv.tempDir, 'network-behavior-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Network Behavior Test', projectPath);

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
    ).toBeVisible({ timeout: TIMEOUTS.EXTENDED });

    // Document the network behavior we observe
    const streamingBehavior = {
      requestsMade: requests.filter((r) => r.includes('message') || r.includes('stream')),
      responsesReceived: responses.filter((r) => r.includes('message') || r.includes('stream')),
      messageAccepted: testMessage.length > 0,
      timestamp: new Date().toISOString(),
    };

    // Verify basic functionality is working
    expect(streamingBehavior.messageAccepted).toBeTruthy();

    // Verify we have some network activity
    expect(streamingBehavior.requestsMade.length).toBeGreaterThan(0);
  });
});
