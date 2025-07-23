// ABOUTME: Integration tests for thread messaging API endpoint
// ABOUTME: Tests sending messages to agents with real functionality and mocked network layer

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/threads/[threadId]/message/route';
import type { MessageResponse } from '@/types/api';
import { Project } from '@/lib/server/lace-imports';
import { asThreadId } from '@/lib/server/core-types';
import { getSessionService } from '@/lib/server/session-service';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

// Mock SSE manager to capture events
const mockSSEManager = {
  broadcast: vi.fn(),
  getInstance: vi.fn(),
};

vi.mock('@/lib/sse-manager', () => ({
  SSEManager: {
    getInstance: () => mockSSEManager,
  },
}));

describe('Thread Messaging API', () => {
  let sessionService: ReturnType<typeof getSessionService>;
  let testProjectId: string;
  let realSessionId: string;
  let realThreadId: string;

  beforeEach(async () => {
    setupTestPersistence();
    vi.clearAllMocks();

    // Set up environment
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    sessionService = getSessionService();

    // Create a real test project
    testProjectId = 'test-project-1';
    const project = Project.create('Test Project', process.cwd(), 'Project for testing');
    testProjectId = project.getId();

    // Create a real session
    const session = await sessionService.createSession(
      'Test Session',
      'anthropic',
      'claude-3-haiku-20240307',
      testProjectId
    );
    realSessionId = session.id;
    realThreadId = session.id; // Session ID equals coordinator thread ID
  });

  afterEach(() => {
    sessionService.clearActiveSessions();
    teardownTestPersistence();
  });

  it('should accept and process messages', async () => {
    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello, agent!' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ threadId: realThreadId }),
    });

    expect(response.status).toBe(202);
    const data = (await response.json()) as MessageResponse;
    expect(data.status).toBe('accepted');
    expect(data.messageId).toBeDefined();
    expect(data.threadId).toBe(realThreadId);
  });

  it('should return 400 for invalid thread ID', async () => {
    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello!' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ threadId: 'invalid-thread-id' }),
    });

    expect(response.status).toBe(400);
  });

  it('should return 404 for non-existent session', async () => {
    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello!' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ threadId: 'lace_20240101_nonexistent' }),
    });

    expect(response.status).toBe(404);
  });

  it('should return 400 for missing message', async () => {
    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(request, {
      params: Promise.resolve({ threadId: realThreadId }),
    });

    expect(response.status).toBe(400);
  });

  it('should return 400 for empty message', async () => {
    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ threadId: realThreadId }),
    });

    expect(response.status).toBe(400);
  });

  it('should broadcast user message event via SSE', async () => {
    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test message' }),
    });

    await POST(request, {
      params: Promise.resolve({ threadId: realThreadId }),
    });

    // Should broadcast the user message event
    expect(mockSSEManager.broadcast).toHaveBeenCalledWith(
      realSessionId,
      expect.objectContaining({
        type: 'USER_MESSAGE',
        data: { content: 'Test message' },
      })
    );
  });

  it('should handle malformed JSON gracefully', async () => {
    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json',
    });

    const response = await POST(request, {
      params: Promise.resolve({ threadId: realThreadId }),
    });

    expect(response.status).toBe(500);
  });

  it('should work with delegate agents', async () => {
    // Create a delegate agent
    const session = await sessionService.getSession(asThreadId(realSessionId));
    expect(session).toBeDefined();

    const delegateAgent = session!.spawnAgent('Test Delegate');
    const delegateThreadId = delegateAgent.threadId;

    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello delegate!' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ threadId: delegateThreadId }),
    });

    expect(response.status).toBe(202);
    const data = (await response.json()) as MessageResponse;
    expect(data.status).toBe('accepted');
  });

  it('should handle agent startup correctly', async () => {
    // This test verifies that the auto-start functionality works
    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test auto-start' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ threadId: realThreadId }),
    });

    expect(response.status).toBe(202);

    // Verify agent is running after message
    const session = await sessionService.getSession(asThreadId(realSessionId));
    const agent = session!.getAgent(asThreadId(realThreadId));
    expect(agent!.isRunning).toBe(true);
  });
});
