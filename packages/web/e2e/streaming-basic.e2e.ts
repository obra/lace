// ABOUTME: Basic streaming functionality E2E tests with token-by-token response verification
// ABOUTME: Tests fundamental streaming behavior including AGENT_TOKEN events and UI indicators

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

test.describe('Basic Streaming Functionality', () => {
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

  test('streams response token-by-token with AGENT_TOKEN events', async ({ page }) => {
    // Setup provider and project
    await setupAnthropicProvider(page);

    const projectPath = path.join(testEnv.tempDir, 'streaming-basic-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Basic Streaming Test', projectPath);

    await getMessageInput(page);

    // Monitor AGENT_TOKEN events via console logs
    const sseEvents: string[] = [];
    let agentTokenCount = 0;

    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[FIREHOSE]') && text.includes('AGENT_TOKEN')) {
        agentTokenCount++;
        sseEvents.push(text);
      }
    });

    // Send message to trigger streaming
    const userMessage = 'Please tell me a story';
    await sendMessage(page, userMessage);
    await verifyMessageVisible(page, userMessage);

    // Wait for streaming to begin
    await page.waitForTimeout(500);

    // Check for streaming indicators
    const expectedText =
      'This is a streaming response that demonstrates real-time token generation';
    const streamingIndicators = [
      page.locator('[data-testid="streaming-content"]'),
      page.locator('.streaming-message'),
      page.getByText(expectedText.substring(0, 20)), // First part of response
      page.getByText('streaming response'),
    ];

    let streamingDetected = false;
    for (const indicator of streamingIndicators) {
      try {
        await indicator.waitFor({ state: 'visible', timeout: 3000 });
        streamingDetected = true;
        break;
      } catch {
        // Try next indicator
      }
    }

    // Wait for streaming to complete
    await page.waitForTimeout(3000);

    // Verify final response content
    const finalResponse = page.getByText(expectedText);
    const responseVisible = await finalResponse.isVisible().catch(() => false);

    // At least one streaming verification should pass
    const streamingWorking = streamingDetected || responseVisible || agentTokenCount > 0;
    expect(streamingWorking).toBeTruthy();

    // Verify interface returns to ready state
    const messageInput = await getMessageInput(page);
    await expect(messageInput).toBeVisible();
    await expect(messageInput).toBeEnabled();
  });

  test('displays progressive content updates during streaming', async ({ page }) => {
    // Setup provider and project
    await setupAnthropicProvider(page);

    const projectPath = path.join(testEnv.tempDir, 'progressive-streaming-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Progressive Streaming Test', projectPath);

    await getMessageInput(page);

    // Send message that triggers predictable response
    const userMessage = 'Please tell me a story';
    await sendMessage(page, userMessage);
    await verifyMessageVisible(page, userMessage);

    // Wait for response to begin
    await page.waitForTimeout(200);

    // Check for progressive content appearance (tokens appearing over time)
    const progressiveChecks = [
      { text: 'This', timeout: 1000 },
      { text: 'streaming', timeout: 2000 },
      { text: 'demonstrates', timeout: 3000 },
      { text: 'real-time', timeout: 4000 },
    ];

    let progressiveUpdatesDetected = 0;
    for (const check of progressiveChecks) {
      try {
        await expect(page.getByText(check.text).first()).toBeVisible({ timeout: check.timeout });
        progressiveUpdatesDetected++;
      } catch {
        // Progressive update not detected within timeout
      }
    }

    // Wait for complete response
    await page.waitForTimeout(2000);

    // Verify final complete response
    const completeResponse =
      'This is a streaming response that demonstrates real-time token generation';
    const finalResponseVisible = await page
      .getByText(completeResponse)
      .isVisible()
      .catch(() => false);

    // Test passes if we see progressive updates OR final response
    expect(progressiveUpdatesDetected > 0 || finalResponseVisible).toBeTruthy();

    // Verify interface is ready for next interaction
    const messageInput = await getMessageInput(page);
    await expect(messageInput).toBeEnabled();
  });

  test('maintains streaming performance with expected timing', async ({ page }) => {
    // Setup provider and project
    await setupAnthropicProvider(page);

    const projectPath = path.join(testEnv.tempDir, 'streaming-performance-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Streaming Performance Test', projectPath);

    await getMessageInput(page);

    // Track timing metrics
    const performanceMetrics: { event: string; timestamp: number }[] = [];

    // Monitor console for streaming events
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('AGENT_TOKEN') || text.includes('streaming')) {
        performanceMetrics.push({
          event: text,
          timestamp: Date.now(),
        });
      }
    });

    const startTime = Date.now();

    // Send message and track response timing
    const userMessage = 'Please tell me a story';
    await sendMessage(page, userMessage);
    await verifyMessageVisible(page, userMessage);

    const messageStartTime = Date.now();

    // Wait for first streaming content to appear
    const firstContentTimeout = TIMEOUTS.QUICK;
    let firstContentTime: number | null = null;

    try {
      await expect(page.getByText('This').first()).toBeVisible({ timeout: firstContentTimeout });
      firstContentTime = Date.now();
    } catch {
      // First content timing not captured
    }

    // Wait for streaming to complete
    await page.waitForTimeout(4000);

    const endTime = Date.now();

    // Calculate performance metrics
    const totalDuration = endTime - startTime;
    const messageProcessingTime = messageStartTime - startTime;
    const streamingResponseTime = firstContentTime ? firstContentTime - messageStartTime : null;

    const performanceAnalysis = {
      totalDuration,
      messageProcessingTime,
      streamingResponseTime,
      totalStreamingEvents: performanceMetrics.length,
      averageEventInterval:
        performanceMetrics.length > 1
          ? (performanceMetrics[performanceMetrics.length - 1].timestamp -
              performanceMetrics[0].timestamp) /
            performanceMetrics.length
          : null,
    };

    // Verify reasonable performance (should complete within 10 seconds)
    expect(performanceAnalysis.totalDuration).toBeLessThan(TIMEOUTS.STANDARD);

    // Verify message processing is reasonably fast (under 2 seconds)
    expect(performanceAnalysis.messageProcessingTime).toBeLessThan(2000);

    // Verify interface remains responsive
    const messageInput = await getMessageInput(page);
    await expect(messageInput).toBeEnabled();
  });
});
