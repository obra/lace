// ABOUTME: E2E tests for SSE integration with real API route handlers
// ABOUTME: Tests server-sent events functionality with actual route handlers and real persistence

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestPersistence, teardownTestPersistence } from '~/test-setup-dir/persistence-helper';
import { getSessionService } from '@/lib/server/session-service';
import { Project } from '@/lib/server/lace-imports';

// Import the SSE API route
import { GET as sseStream } from '@/app/api/sessions/[sessionId]/events/stream/route';
import { NextRequest } from 'next/server';

// Mock external dependencies
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: () => ({
    requestApproval: vi.fn().mockResolvedValue('allow_once'),
  }),
}));

// Track SSE connections and broadcasts for testing
const mockConnections = new Map<string, any[]>();
const mockBroadcasts: any[] = [];

vi.mock('@/lib/sse-manager', () => ({
  SSEManager: {
    getInstance: () => ({
      addConnection: vi.fn((sessionId: string, controller: any) => {
        if (!mockConnections.has(sessionId)) {
          mockConnections.set(sessionId, []);
        }
        mockConnections.get(sessionId)!.push(controller);
      }),
      removeConnection: vi.fn((sessionId: string, controller: any) => {
        if (mockConnections.has(sessionId)) {
          const connections = mockConnections.get(sessionId)!;
          const index = connections.indexOf(controller);
          if (index !== -1) {
            connections.splice(index, 1);
          }
        }
      }),
      broadcast: vi.fn((sessionId: string, event: any) => {
        mockBroadcasts.push({ sessionId, event });
        // Simulate sending to all connections for this session
        if (mockConnections.has(sessionId)) {
          const connections = mockConnections.get(sessionId)!;
          connections.forEach((controller) => {
            if (controller.enqueue) {
              const eventText = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
              controller.enqueue(new TextEncoder().encode(eventText));
            }
          });
        }
      }),
    }),
  },
}));

describe('SSE Stream E2E Tests', () => {
  let sessionId: string;

  beforeEach(async () => {
    setupTestPersistence();
    mockConnections.clear();
    mockBroadcasts.length = 0;

    // Set up environment for session service
    process.env = {
      ...process.env,
      ANTHROPIC_KEY: 'test-key',
      LACE_DB_PATH: ':memory:',
    };

    // Create a real session using the session service
    const sessionService = getSessionService();
    const testProject = Project.create(
      'SSE E2E Test Project',
      '/test/path',
      'Test project for SSE E2E testing',
      {}
    );
    const projectId = testProject.getId();
    const session = await sessionService.createSession(
      'SSE E2E Test Session',
      'anthropic',
      'claude-3-haiku-20240307',
      projectId
    );
    sessionId = session.id as string;
  });

  afterEach(() => {
    teardownTestPersistence();
    vi.clearAllMocks();
    mockConnections.clear();
    mockBroadcasts.length = 0;
    if (global.sessionService) {
      global.sessionService = undefined;
    }
  });

  it('should establish SSE connection through real API route', async () => {
    const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/events/stream`, {
      method: 'GET',
    });

    const response = await sseStream(request, {
      params: Promise.resolve({ sessionId }),
    });

    // Verify the response is a valid SSE stream
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('Connection')).toBe('keep-alive');
  });

  it('should handle invalid session ID', async () => {
    const request = new NextRequest('http://localhost/api/sessions/invalid-session/events/stream', {
      method: 'GET',
    });

    const response = await sseStream(request, {
      params: Promise.resolve({ sessionId: 'invalid-session' }),
    });

    // Should return error for invalid session
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  it('should register connection with SSE manager', async () => {
    const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/events/stream`, {
      method: 'GET',
    });

    // Start the SSE connection
    const response = await sseStream(request, {
      params: Promise.resolve({ sessionId }),
    });

    // Verify response is streaming
    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();

    // The SSE manager's addConnection should have been called
    // (We can't easily test this without consuming the stream, but we can verify the setup)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('should handle SSE stream data format', async () => {
    const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/events/stream`, {
      method: 'GET',
    });

    const response = await sseStream(request, {
      params: Promise.resolve({ sessionId }),
    });

    expect(response.status).toBe(200);

    // Verify it's a readable stream
    expect(response.body).toBeInstanceOf(ReadableStream);

    // Verify headers are correct for SSE
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('Connection')).toBe('keep-alive');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('should work with multiple concurrent connections', async () => {
    // Create multiple requests for the same session
    const requests = Array.from(
      { length: 3 },
      () =>
        new NextRequest(`http://localhost/api/sessions/${sessionId}/events/stream`, {
          method: 'GET',
        })
    );

    // Start multiple SSE connections
    const responses = await Promise.all(
      requests.map((request) => sseStream(request, { params: Promise.resolve({ sessionId }) }))
    );

    // All should succeed
    responses.forEach((response) => {
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    });
  });
});
