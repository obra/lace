// ABOUTME: True E2E tests for SSE stream functionality with real API routes
// ABOUTME: Tests actual SSE connections, event streaming, and session management

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as sseStream } from '@/app/routes/api.events.stream';
import { POST as createProjectSession } from '@/app/routes/api.projects.$projectId.sessions';
import { POST as spawnAgent } from '@/app/routes/api.sessions.$sessionId.agents';
import { POST as sendMessage } from '@/app/routes/api.threads.$threadId.message';
import { getSessionService } from '@/lib/server/session-service';
import { Project } from '@/lib/server/lace-imports';
import type { SessionInfo } from '@/types/core';
import { parseResponse } from '@/lib/serialization';
import { setupWebTest } from '@/test-utils/web-test-setup';
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '@/lib/server/lace-imports';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';

describe('SSE Stream E2E Tests', () => {
  const _tempLaceDir = setupWebTest();
  let sessionService: ReturnType<typeof getSessionService>;
  let sessionId: string;
  let projectId: string;
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Set up environment for session service
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    // Create provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    sessionService = getSessionService();

    // Create a real project and session for testing
    const testProject = Project.create(
      'SSE E2E Test Project',
      '/test/path',
      'Test project for SSE E2E testing',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );
    projectId = testProject.getId();

    // Create session via API route (real E2E)
    const createSessionRequest = new NextRequest(
      `http://localhost:3000/api/projects/${projectId}/sessions`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'SSE E2E Test Session',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const sessionResponse = await createProjectSession(createSessionRequest, {
      params: Promise.resolve({ projectId }),
    });
    expect(sessionResponse.status).toBe(201);

    const sessionData = await parseResponse<SessionInfo>(sessionResponse);
    sessionId = sessionData.id as string;
  });

  afterEach(async () => {
    if (sessionService) {
      // Clear session registry to prevent async operations after database closure
      sessionService.clearActiveSessions();
    }
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    // Wait a moment for any pending operations to abort
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it('should establish SSE stream connection for valid session', async () => {
    const request = new NextRequest(`http://localhost/api/events/stream?sessions=${sessionId}`);

    const response = await sseStream(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate');
    expect(response.headers.get('Connection')).toBe('keep-alive');
  });

  it('should handle invalid session gracefully', async () => {
    const request = new NextRequest(`http://localhost/api/events/stream?sessions=invalid-session`);

    const response = await sseStream(request);

    // The event stream should still work but won't receive events for invalid sessions
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('should stream real events when agent sends message', async () => {
    // First, spawn an agent in the session
    const spawnAgentRequest = new NextRequest(
      `http://localhost:3000/api/sessions/${sessionId}/agents`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'test-agent',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const agentResponse = await spawnAgent(spawnAgentRequest, {
      params: Promise.resolve({ sessionId }),
    });
    expect(agentResponse.status).toBe(201);

    const agentData = await parseResponse<{ threadId: string }>(agentResponse);
    const agentThreadId = agentData.threadId;

    // Establish SSE connection
    const sseRequest = new NextRequest(`http://localhost/api/events/stream?sessions=${sessionId}`);
    const sseResponse = await sseStream(sseRequest);
    expect(sseResponse.status).toBe(200);

    // Get the stream reader
    if (!sseResponse.body) {
      throw new Error('Response body is null');
    }

    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();

    // Send a message to trigger events
    const messageRequest = new NextRequest(
      `http://localhost:3000/api/threads/${agentThreadId}/message`,
      {
        method: 'POST',
        body: JSON.stringify({ message: 'Hello test agent' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    // Send the message (this should trigger SSE events)
    const messagePromise = sendMessage(messageRequest, {
      params: Promise.resolve({ threadId: agentThreadId }),
    });

    // Read from the SSE stream with timeout
    const streamPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('SSE stream timeout'));
      }, 5000);

      const readStream = async () => {
        try {
          const { value, done } = await reader.read();
          clearTimeout(timeout);

          if (done) {
            resolve('');
            return;
          }

          const chunk = decoder.decode(value, { stream: true });
          resolve(chunk);
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      };

      void readStream();
    });

    // Wait for both the message response and stream data
    const [messageResponse, streamData] = await Promise.all([messagePromise, streamPromise]);

    // Verify message was sent successfully (202 = Accepted for async processing)
    expect(messageResponse.status).toBe(202);

    // Verify we received SSE data
    expect(streamData).toBeTruthy();

    // Clean up the reader
    await reader.cancel();
  });

  it('should handle multiple concurrent SSE connections', async () => {
    // Create multiple SSE connections
    const request1 = new NextRequest(`http://localhost/api/events/stream?sessions=${sessionId}`);
    const request2 = new NextRequest(`http://localhost/api/events/stream?sessions=${sessionId}`);

    const [response1, response2] = await Promise.all([sseStream(request1), sseStream(request2)]);

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);
    expect(response1.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response2.headers.get('Content-Type')).toBe('text/event-stream');

    // Clean up streams
    if (response1.body) await response1.body.cancel();
    if (response2.body) await response2.body.cancel();
  });

  it('should handle SSE connection cleanup on stream close', async () => {
    const request = new NextRequest(`http://localhost/api/events/stream?sessions=${sessionId}`);

    const response = await sseStream(request);

    expect(response.status).toBe(200);

    // Simulate closing the stream
    if (response.body) {
      const reader = response.body.getReader();
      await reader.cancel(); // This should trigger cleanup
    }

    // The cleanup should happen automatically when the stream is cancelled
    // We can't easily verify internal cleanup in this E2E test, but we can
    // ensure the operation completes without errors
    expect(response.status).toBe(200);
  });
});
