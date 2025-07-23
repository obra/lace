// ABOUTME: True E2E tests for SSE stream functionality with real API routes
// ABOUTME: Tests actual SSE connections, event streaming, and session management

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as sseStream } from '@/app/api/sessions/[sessionId]/events/stream/route';
import { POST as createProjectSession } from '@/app/api/projects/[projectId]/sessions/route';
import { POST as spawnAgent } from '@/app/api/sessions/[sessionId]/agents/route';
import { POST as sendMessage } from '@/app/api/threads/[threadId]/message/route';
import { getSessionService } from '@/lib/server/session-service';
import { Project } from '@/lib/server/lace-imports';
import type { Session } from '@/types/api';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

describe('SSE Stream E2E Tests', () => {
  let sessionService: ReturnType<typeof getSessionService>;
  let sessionId: string;
  let projectId: string;

  beforeEach(async () => {
    setupTestPersistence();

    // Set up environment for session service
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    sessionService = getSessionService();

    // Create a real project and session for testing
    const testProject = Project.create(
      'SSE E2E Test Project',
      '/test/path',
      'Test project for SSE E2E testing',
      {}
    );
    projectId = testProject.getId();

    // Create session via API route (real E2E)
    const createSessionRequest = new NextRequest(
      `http://localhost:3000/api/projects/${projectId}/sessions`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'SSE E2E Test Session',
          configuration: {
            provider: 'anthropic',
            model: 'claude-3-haiku-20240307',
          },
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const sessionResponse = await createProjectSession(createSessionRequest, {
      params: Promise.resolve({ projectId }),
    });
    expect(sessionResponse.status).toBe(201);

    const sessionData = (await sessionResponse.json()) as { session: Session };
    sessionId = sessionData.session.id as string;
  });

  afterEach(() => {
    if (sessionService) {
      sessionService.clearActiveSessions();
    }
    teardownTestPersistence();
  });

  it('should establish SSE stream connection for valid session', async () => {
    const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/events/stream`);

    const response = await sseStream(request, {
      params: Promise.resolve({ sessionId }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('Connection')).toBe('keep-alive');
  });

  it('should return 404 for non-existent session', async () => {
    const request = new NextRequest(`http://localhost/api/sessions/invalid-session/events/stream`);

    const response = await sseStream(request, {
      params: Promise.resolve({ sessionId: 'invalid-session' }),
    });

    expect(response.status).toBe(404);
    const data = (await response.json()) as { error: string };
    expect(data).toHaveProperty('error');
  });

  it('should stream real events when agent sends message', async () => {
    // First, spawn an agent in the session
    const spawnAgentRequest = new NextRequest(
      `http://localhost:3000/api/sessions/${sessionId}/agents`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'test-agent',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const agentResponse = await spawnAgent(spawnAgentRequest, {
      params: Promise.resolve({ sessionId }),
    });
    expect(agentResponse.status).toBe(201);

    const agentData = (await agentResponse.json()) as {
      agent: { threadId: string };
    };
    const agentThreadId = agentData.agent.threadId;

    // Establish SSE connection
    const sseRequest = new NextRequest(`http://localhost/api/sessions/${sessionId}/events/stream`);
    const sseResponse = await sseStream(sseRequest, {
      params: Promise.resolve({ sessionId }),
    });
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
    const request1 = new NextRequest(`http://localhost/api/sessions/${sessionId}/events/stream`);
    const request2 = new NextRequest(`http://localhost/api/sessions/${sessionId}/events/stream`);

    const [response1, response2] = await Promise.all([
      sseStream(request1, { params: Promise.resolve({ sessionId }) }),
      sseStream(request2, { params: Promise.resolve({ sessionId }) }),
    ]);

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);
    expect(response1.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response2.headers.get('Content-Type')).toBe('text/event-stream');

    // Clean up streams
    if (response1.body) await response1.body.cancel();
    if (response2.body) await response2.body.cancel();
  });

  it('should handle SSE connection cleanup on stream close', async () => {
    const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/events/stream`);

    const response = await sseStream(request, {
      params: Promise.resolve({ sessionId }),
    });

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
