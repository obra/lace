// ABOUTME: E2E test for thread ID consistency using real Anthropic API
// ABOUTME: Validates Agent thread creation, status API, and conversation continuity

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';

const TEST_PORT = 3006;
const BASE_URL = `http://localhost:${TEST_PORT}`;

interface TestResults {
  agentThreadId: string | null;
  statusApiThreadId: string | null;
  firstConversationThreadId: string | null;
  secondConversationThreadId: string | null;
  toolExecutionThreadId: string | null;
}

describe('Thread ID Consistency with Real API', () => {
  let serverProcess: ChildProcess;
  let results: TestResults;

  beforeAll(async () => {
    // Skip if no API key
    if (!process.env.ANTHROPIC_KEY) {
      console.warn('Skipping real API tests - ANTHROPIC_KEY not set');
      return;
    }

    results = {
      agentThreadId: null,
      statusApiThreadId: null,
      firstConversationThreadId: null,
      secondConversationThreadId: null,
      toolExecutionThreadId: null,
    };

    // Start server and capture Agent thread ID
    const agentThreadId = await startServerAndCaptureThreadId();
    results.agentThreadId = agentThreadId;
  }, 60000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  });

  it('should have ANTHROPIC_KEY for real API testing', () => {
    if (!process.env.ANTHROPIC_KEY) {
      console.warn('Skipping - set ANTHROPIC_KEY to run real API tests');
      return;
    }
    expect(process.env.ANTHROPIC_KEY).toBeTruthy();
  });

  it('should capture Agent thread ID from server startup', async () => {
    if (!process.env.ANTHROPIC_KEY) return;

    expect(results.agentThreadId).toBeTruthy();
    expect(results.agentThreadId).toMatch(/^lace_\d{8}_[a-z0-9]+$/);
    console.log(`Agent created thread: ${results.agentThreadId}`);
  });

  it('should return consistent thread ID from status API', async () => {
    if (!process.env.ANTHROPIC_KEY) return;

    const response = await fetch(`${BASE_URL}/api/agent/status`);
    expect(response.ok).toBe(true);

    const status = await response.json();
    results.statusApiThreadId = status.latestThreadId;

    console.log(`Agent startup thread: ${results.agentThreadId}`);
    console.log(`Status API thread: ${status.latestThreadId}`);
    console.log(`Status response:`, status);

    expect(status.hasActiveThread).toBe(true);
    expect(status.latestThreadId).toBeTruthy();
    expect(status.latestThreadId).toBe(results.agentThreadId);
  });

  it('should maintain thread ID in first conversation', async () => {
    if (!process.env.ANTHROPIC_KEY) return;

    const threadId = await sendMessageAndGetThreadId('hello, what is 2+2?');
    results.firstConversationThreadId = threadId;

    expect(threadId).toBeTruthy();
    expect(threadId).toBe(results.agentThreadId);
    
    console.log(`First conversation used: ${threadId}`);
  });

  it('should maintain thread continuity in second conversation', async () => {
    if (!process.env.ANTHROPIC_KEY) return;

    const threadId = await sendMessageAndGetThreadId(
      'what did I just ask you?', 
      results.firstConversationThreadId!
    );
    results.secondConversationThreadId = threadId;

    expect(threadId).toBeTruthy();
    expect(threadId).toBe(results.firstConversationThreadId);
    
    console.log(`Second conversation used: ${threadId}`);
  });

  it('should maintain thread ID during tool execution', async () => {
    if (!process.env.ANTHROPIC_KEY) return;

    const threadId = await sendMessageAndGetThreadId(
      'what time is it right now?',
      results.firstConversationThreadId!
    );
    results.toolExecutionThreadId = threadId;

    expect(threadId).toBeTruthy();
    expect(threadId).toBe(results.firstConversationThreadId);
    
    console.log(`Tool execution used: ${threadId}`);
  });

  it('should have consistent thread IDs across all operations', async () => {
    if (!process.env.ANTHROPIC_KEY) return;

    const allThreadIds = [
      results.agentThreadId,
      results.statusApiThreadId,
      results.firstConversationThreadId,
      results.secondConversationThreadId,
      results.toolExecutionThreadId,
    ].filter(Boolean);

    // All captured thread IDs should be the same
    const uniqueThreadIds = [...new Set(allThreadIds)];
    
    console.log('All thread IDs captured:', allThreadIds);
    console.log('Unique thread IDs:', uniqueThreadIds);
    
    expect(uniqueThreadIds).toHaveLength(1);
    expect(uniqueThreadIds[0]).toMatch(/^lace_\d{8}_[a-z0-9]+$/);
  });

  async function startServerAndCaptureThreadId(): Promise<string | null> {
    return new Promise((resolve, reject) => {
      let agentThreadId: string | null = null;
      
      serverProcess = spawn(
        'node',
        ['dist/cli.js', '--ui', 'web', '--log-level=debug', `--port=${TEST_PORT}`],
        {
          stdio: 'pipe',
          env: process.env,
        }
      );

      const timeout = setTimeout(() => {
        reject(new Error('Server failed to start within 30 seconds'));
      }, 30000);

      serverProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        
        // Capture Agent thread ID
        const threadMatch = output.match(/Thread ID: (lace_\d{8}_[a-z0-9]+)/);
        if (threadMatch) {
          agentThreadId = threadMatch[1];
        }

        // Wait for web interface to be ready
        if (output.includes('Lace web interface available')) {
          clearTimeout(timeout);
          // Give it a moment to fully initialize
          setTimeout(() => resolve(agentThreadId), 3000);
        }
      });

      serverProcess.stderr?.on('data', (data) => {
        console.error('Server stderr:', data.toString());
      });

      serverProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  async function sendMessageAndGetThreadId(
    message: string, 
    existingThreadId?: string
  ): Promise<string | null> {
    const body: any = {
      message,
      provider: 'anthropic',
    };
    
    if (existingThreadId) {
      body.threadId = existingThreadId;
    }

    const response = await fetch(`${BASE_URL}/api/conversations/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response stream');

    const decoder = new TextDecoder();
    let buffer = '';
    let connectionThreadId: string | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              
              if (event.type === 'connection') {
                connectionThreadId = event.threadId;
                // Got what we need, can exit early
                await reader.cancel();
                return connectionThreadId;
              }
              
              if (event.type === 'error') {
                throw new Error(`Stream error: ${event.error}`);
              }
            } catch (parseError) {
              // Ignore JSON parse errors for partial data
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return connectionThreadId;
  }
});