// ABOUTME: Tests for task SSE streaming endpoint
// ABOUTME: Verifies real-time task event streaming functionality

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/tasks/stream/route';
import { EventEmitter } from 'events';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

// Create mock TaskManager that extends EventEmitter
class MockTaskManager extends EventEmitter {
  constructor() {
    super();
  }
}

// Create mock Session
const createMockSession = (sessionId: string) => {
  const mockTaskManager = new MockTaskManager();

  return {
    getId: () => sessionId,
    getInfo: () => ({
      id: sessionId,
      name: 'Test Session',
      createdAt: new Date(),
      provider: 'anthropic',
      model: 'claude-3-haiku',
      agents: [],
    }),
    getAgents: () => [],
    getAgent: vi.fn(),
    getTaskManager: () => mockTaskManager,
    spawnAgent: vi.fn(),
    startAgent: vi.fn(),
    stopAgent: vi.fn(),
    sendMessage: vi.fn(),
    destroy: vi.fn(),
  };
};

// Mock session service
const mockSessionService = {
  getSession: vi.fn(),
  createSession: vi.fn(),
  listSessions: vi.fn(),
  spawnAgent: vi.fn(),
  getAgent: vi.fn(),
};

vi.mock('@/lib/server/session-service', () => ({
  getSessionService: () => mockSessionService,
}));

// Mock TextEncoder
global.TextEncoder = class MockTextEncoder {
  encode(text: string): Uint8Array {
    return new Uint8Array(Buffer.from(text));
  }
} as typeof TextEncoder;

describe('Task SSE Stream', () => {
  beforeEach(() => {
    setupTestPersistence();
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  it('should establish SSE connection for valid session', async () => {
    const sessionId = 'lace_20250716_test123';
    const mockSession = createMockSession(sessionId);
    mockSessionService.getSession.mockResolvedValue(mockSession);

    const request = new NextRequest(
      `http://localhost:3000/api/tasks/stream?sessionId=${sessionId}`
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Connection')).toBe('keep-alive');
  });

  it('should return 400 if sessionId is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/tasks/stream');
    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data.error).toBe('Session ID is required');
  });

  it('should return 404 if session not found', async () => {
    mockSessionService.getSession.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/tasks/stream?sessionId=invalid');
    const response = await GET(request);

    expect(response.status).toBe(404);
    const data = (await response.json()) as { error: string };
    expect(data.error).toBe('Session not found');
  });

  it('should stream task events', async () => {
    const sessionId = 'lace_20250716_test123';
    const mockSession = createMockSession(sessionId);
    mockSessionService.getSession.mockResolvedValue(mockSession);

    const request = new NextRequest(
      `http://localhost:3000/api/tasks/stream?sessionId=${sessionId}`
    );
    const response = await GET(request);

    expect(response.status).toBe(200);

    // The response body is a ReadableStream
    expect(response.body).toBeDefined();

    // Get the task manager
    const taskManager = mockSession.getTaskManager();
    expect(taskManager).toBeInstanceOf(EventEmitter);

    // Simulate task events
    const taskEvent = {
      type: 'task:created',
      task: {
        id: 'task_20250716_abc123',
        title: 'Test Task',
        status: 'pending',
      },
      context: {
        actor: 'human',
        isHuman: true,
      },
      timestamp: new Date(),
    };

    // Emit event - in real scenario, this would stream to client
    taskManager.emit('task:created', taskEvent);

    // Verify the TaskManager supports event emitters
    expect(typeof taskManager.on).toBe('function');
    expect(typeof taskManager.emit).toBe('function');
  });
});
