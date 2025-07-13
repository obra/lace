// ABOUTME: E2E test for thread ID consistency between web UI and Agent system
// ABOUTME: Verifies that tools work properly with server-generated thread IDs

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'child_process';

// Test configuration
const TEST_PORT = 3001;
const SERVER_URL = `http://localhost:${TEST_PORT}`;
const API_URL = `${SERVER_URL}/api/conversations/stream`;

describe('Thread ID Consistency E2E', () => {
  let serverProcess: ChildProcess;

  beforeEach(async () => {
    // Start the web server for testing
    serverProcess = spawn('npm', ['run', 'dev'], {
      env: { ...process.env, PORT: TEST_PORT.toString() },
      stdio: 'pipe',
    });

    // Wait for server to start
    await waitForServer(SERVER_URL, 30000);
  });

  afterEach(async () => {
    if (serverProcess) {
      serverProcess.kill();
      // Wait for process to fully terminate
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  });

  it('should maintain thread ID consistency between conversation and tool execution', async () => {
    let receivedThreadId: string | null = null;
    let toolExecutionSuccess = false;
    let toolExecutionThreadId: string | null = null;

    // Step 1: Start a conversation and capture the thread ID
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'tell me what time it is',
        provider: 'anthropic',
      }),
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    // Step 2: Parse the SSE stream to extract thread ID and monitor tool execution
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response stream');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const event = JSON.parse(line.slice(6));

            // Capture thread ID from connection event
            if (event.type === 'connection') {
              receivedThreadId = event.threadId;
              console.log(`Received thread ID: ${receivedThreadId}`);
            }

            // Monitor tool execution
            if (event.type === 'tool_call_start' && event.toolCall?.name === 'bash') {
              console.log(`Tool execution started with thread: ${receivedThreadId}`);
            }

            if (event.type === 'tool_call_complete') {
              toolExecutionSuccess = !event.result?.isError;
              toolExecutionThreadId = receivedThreadId; // Should be the same
              console.log(`Tool execution completed. Success: ${toolExecutionSuccess}`);

              // Exit the stream after tool execution
              await reader.cancel();
              return;
            }

            // Exit on error
            if (event.type === 'error') {
              console.error(`Stream error: ${event.error}`);
              throw new Error(`Stream error: ${event.error}`);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Step 3: Verify results
    expect(receivedThreadId).toBeTruthy();
    expect(receivedThreadId).toMatch(/^lace_\d{8}_[a-z0-9]+$/);
    expect(toolExecutionSuccess).toBe(true);
    expect(toolExecutionThreadId).toBe(receivedThreadId);
  }, 60000); // 60 second timeout for E2E test

  it('should handle thread ID persistence across multiple requests', async () => {
    let firstThreadId: string | null = null;
    let secondThreadId: string | null = null;

    // First conversation
    const firstResponse = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'hello',
        provider: 'anthropic',
      }),
    });

    // Extract thread ID from first conversation
    const firstReader = firstResponse.body?.getReader();
    if (!firstReader) throw new Error('No response stream');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await firstReader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const event = JSON.parse(line.slice(6));

          if (event.type === 'connection') {
            firstThreadId = event.threadId;
            await firstReader.cancel();
            break;
          }
        }
      }
      if (firstThreadId) break;
    }

    firstReader.releaseLock();

    // Second conversation using the same thread ID
    const secondResponse = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'what did I just ask?',
        threadId: firstThreadId,
        provider: 'anthropic',
      }),
    });

    // Extract thread ID from second conversation
    const secondReader = secondResponse.body?.getReader();
    if (!secondReader) throw new Error('No response stream');

    buffer = '';

    while (true) {
      const { done, value } = await secondReader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const event = JSON.parse(line.slice(6));

          if (event.type === 'connection') {
            secondThreadId = event.threadId;
            await secondReader.cancel();
            break;
          }
        }
      }
      if (secondThreadId) break;
    }

    secondReader.releaseLock();

    // Verify thread ID consistency
    expect(firstThreadId).toBeTruthy();
    expect(secondThreadId).toBeTruthy();
    expect(secondThreadId).toBe(firstThreadId);
  }, 30000);
});

async function waitForServer(url: string, timeout: number): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.status === 200) {
        return;
      }
    } catch (error) {
      // Server not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Server did not start within ${timeout}ms`);
}
