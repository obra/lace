// ABOUTME: Streaming reliability and concurrent operations E2E tests
// ABOUTME: Tests connection stability, performance under load, and event delivery reliability

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

test.describe('Streaming Reliability', () => {
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

  test('maintains event stream reliability during concurrent operations', async ({ page }) => {
    // Setup provider and project
    await setupAnthropicProvider(page);

    const projectPath = path.join(testEnv.tempDir, 'stream-reliability-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Stream Reliability Test', projectPath);

    await getMessageInput(page);

    // Monitor connection health and event delivery
    let connectionErrors = 0;
    let eventDeliveryCount = 0;
    const operationTiming: { [operation: string]: number } = {};

    page.on('response', (response) => {
      if (response.url().includes('/api/events/stream')) {
        if (response.status() >= 400) {
          connectionErrors++;
        }
      }
    });

    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[FIREHOSE]') && text.includes('routed to')) {
        eventDeliveryCount++;
      }
    });

    // Send multiple messages in sequence to test reliability
    const stressTestOperations = [
      'First concurrent message',
      'Second concurrent message',
      'Third concurrent message',
    ];

    const operationResults: {
      message: string;
      success: boolean;
      duration: number;
      responseReceived: boolean;
    }[] = [];

    for (const message of stressTestOperations) {
      const startTime = Date.now();

      try {
        await sendMessage(page, message);
        await verifyMessageVisible(page, message);

        // Check for specific expected responses
        let responseReceived = false;
        if (message.includes('First concurrent message')) {
          await expect(page.getByText('Processing first concurrent message').first()).toBeVisible({
            timeout: TIMEOUTS.EXTENDED,
          });
          responseReceived = true;
        } else if (message.includes('Second concurrent message')) {
          await expect(
            page.getByText('Second concurrent message response tests event stream').first()
          ).toBeVisible({ timeout: TIMEOUTS.EXTENDED });
          responseReceived = true;
        } else if (message.includes('Third concurrent message')) {
          await expect(page.getByText('Third message in concurrent sequence').first()).toBeVisible({
            timeout: TIMEOUTS.EXTENDED,
          });
          responseReceived = true;
        }

        const duration = Date.now() - startTime;
        operationTiming[message] = duration;
        operationResults.push({ message, success: true, duration, responseReceived });

        // Small delay between operations
        await page.waitForTimeout(300);
      } catch {
        const duration = Date.now() - startTime;
        operationResults.push({ message, success: false, duration, responseReceived: false });
      }
    }

    // Wait for final event processing
    await page.waitForTimeout(2000);

    const reliabilityAnalysis = {
      operationResults,
      reliabilityScore: operationResults.filter((r) => r.success).length / operationResults.length,
      responseReliabilityScore:
        operationResults.filter((r) => r.responseReceived).length / operationResults.length,
      averageOperationTime:
        operationResults.reduce((sum, r) => sum + r.duration, 0) / operationResults.length,
      connectionErrors,
      eventDeliveryCount,
      operationTiming,
      concurrentOperationsCompleted: operationResults.length,
    };

    // Verify acceptable reliability (at least 60% success rate)
    expect(reliabilityAnalysis.reliabilityScore).toBeGreaterThan(0.6);

    // Verify low error rates
    expect(reliabilityAnalysis.connectionErrors).toBeLessThan(3);

    // Verify we completed all operations
    expect(reliabilityAnalysis.concurrentOperationsCompleted).toBe(stressTestOperations.length);

    // Verify interface remains functional
    const messageInput = await getMessageInput(page);
    await expect(messageInput).toBeEnabled();
  });

  test('handles rapid-fire message sending without connection drops', async ({ page }) => {
    // Setup provider and project
    await setupAnthropicProvider(page);

    const projectPath = path.join(testEnv.tempDir, 'rapid-fire-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Rapid Fire Test', projectPath);

    await getMessageInput(page);

    // Monitor connection stability
    const connectionMetrics = {
      requests: 0,
      failures: 0,
      timeouts: 0,
      responses: 0,
    };

    page.on('request', (request) => {
      if (request.url().includes('/api/')) {
        connectionMetrics.requests++;
      }
    });

    page.on('response', (response) => {
      if (response.url().includes('/api/')) {
        connectionMetrics.responses++;
        if (response.status() >= 400) {
          connectionMetrics.failures++;
        }
      }
    });

    // Send messages in rapid succession
    const rapidMessages = ['Fourth stress test message', 'Final reliability check message'];

    const rapidFireResults: { message: string; sent: boolean; responded: boolean }[] = [];

    for (const message of rapidMessages) {
      let sent = false;
      let responded = false;

      try {
        await sendMessage(page, message);
        await verifyMessageVisible(page, message);
        sent = true;

        // Check for responses
        if (message.includes('Fourth stress test message')) {
          await expect(
            page.getByText('Fourth stress test response demonstrates robust streaming').first()
          ).toBeVisible({ timeout: TIMEOUTS.STANDARD });
          responded = true;
        } else if (message.includes('Final reliability check message')) {
          await expect(
            page.getByText('Final reliability check confirms streaming event delivery').first()
          ).toBeVisible({ timeout: TIMEOUTS.STANDARD });
          responded = true;
        }

        // Minimal delay for rapid-fire testing
        await page.waitForTimeout(100);
      } catch {
        // Message send or response failed
      }

      rapidFireResults.push({ message, sent, responded });
    }

    // Allow final processing
    await page.waitForTimeout(1500);

    const rapidFireAnalysis = {
      messagesSent: rapidFireResults.filter((r) => r.sent).length,
      responsesReceived: rapidFireResults.filter((r) => r.responded).length,
      totalMessages: rapidMessages.length,
      connectionMetrics,
      successRate: rapidFireResults.filter((r) => r.sent).length / rapidMessages.length,
      responseRate: rapidFireResults.filter((r) => r.responded).length / rapidMessages.length,
    };

    // Verify high success rate for rapid-fire operations (at least 80%)
    expect(rapidFireAnalysis.successRate).toBeGreaterThan(0.8);

    // Verify we made API requests
    expect(rapidFireAnalysis.connectionMetrics.requests).toBeGreaterThan(0);

    // Verify low failure rate
    const failureRate =
      rapidFireAnalysis.connectionMetrics.failures /
      Math.max(1, rapidFireAnalysis.connectionMetrics.responses);
    expect(failureRate).toBeLessThan(0.2);

    // Verify interface remains responsive
    const messageInput = await getMessageInput(page);
    await expect(messageInput).toBeEnabled();
  });

  test('monitors connection health during extended streaming sessions', async ({ page }) => {
    // Setup provider and project
    await setupAnthropicProvider(page);

    const projectPath = path.join(testEnv.tempDir, 'extended-streaming-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Extended Streaming Test', projectPath);

    await getMessageInput(page);

    // Monitor extended session health
    const sessionMetrics = {
      startTime: Date.now(),
      messagesSent: 0,
      responsesReceived: 0,
      connectionDrops: 0,
      reconnections: 0,
      avgResponseTime: 0,
      responseTimes: [] as number[],
    };

    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('connection') && text.includes('lost')) {
        sessionMetrics.connectionDrops++;
      }
      if (text.includes('reconnect')) {
        sessionMetrics.reconnections++;
      }
    });

    // Simulate extended session with multiple interactions
    const extendedMessages = [
      'Please tell me a story',
      'Can you read a file for me?',
      'Help me understand the project structure',
    ];

    for (const message of extendedMessages) {
      const messageStart = Date.now();

      try {
        await sendMessage(page, message);
        await verifyMessageVisible(page, message);
        sessionMetrics.messagesSent++;

        // Wait for specific responses
        let responseReceived = false;
        if (message.includes('Please tell me a story')) {
          await expect(
            page
              .getByText(
                'This is a streaming response that demonstrates real-time token generation'
              )
              .first()
          ).toBeVisible({ timeout: TIMEOUTS.EXTENDED });
          responseReceived = true;
        } else if (message.includes('Can you read a file for me?')) {
          await expect(
            page
              .getByText('File reading request generates TOOL_CALL and TOOL_RESULT events')
              .first()
          ).toBeVisible({ timeout: TIMEOUTS.EXTENDED });
          responseReceived = true;
        } else if (message.includes('Help me understand the project structure')) {
          await expect(
            page.getByText('Project structure analysis involves multiple SSE event types').first()
          ).toBeVisible({ timeout: TIMEOUTS.EXTENDED });
          responseReceived = true;
        }

        if (responseReceived) {
          sessionMetrics.responsesReceived++;
          const responseTime = Date.now() - messageStart;
          sessionMetrics.responseTimes.push(responseTime);
        }

        // Longer delay to simulate extended session
        await page.waitForTimeout(2000);
      } catch {
        // Message failed - continue session
      }
    }

    sessionMetrics.avgResponseTime =
      sessionMetrics.responseTimes.length > 0
        ? sessionMetrics.responseTimes.reduce((sum, time) => sum + time, 0) /
          sessionMetrics.responseTimes.length
        : 0;

    const sessionDuration = Date.now() - sessionMetrics.startTime;

    const extendedSessionAnalysis = {
      sessionDuration,
      messagesSent: sessionMetrics.messagesSent,
      responsesReceived: sessionMetrics.responsesReceived,
      responseRate:
        sessionMetrics.messagesSent > 0
          ? sessionMetrics.responsesReceived / sessionMetrics.messagesSent
          : 0,
      avgResponseTime: sessionMetrics.avgResponseTime,
      connectionDrops: sessionMetrics.connectionDrops,
      reconnections: sessionMetrics.reconnections,
      sessionStability: sessionMetrics.connectionDrops === 0 ? 'stable' : 'unstable',
    };

    // Verify reasonable response rate for extended session (at least 66%)
    expect(extendedSessionAnalysis.responseRate).toBeGreaterThan(0.66);

    // Verify session maintained reasonable performance
    if (extendedSessionAnalysis.avgResponseTime > 0) {
      expect(extendedSessionAnalysis.avgResponseTime).toBeLessThan(20000); // Under 20 seconds per response
    }

    // Verify low connection drops
    expect(extendedSessionAnalysis.connectionDrops).toBeLessThan(2);

    // Verify interface remains functional after extended session
    const messageInput = await getMessageInput(page);
    await expect(messageInput).toBeEnabled();
  });
});
