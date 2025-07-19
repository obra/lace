// ABOUTME: Tests for thread messaging API endpoint (POST /api/threads/{threadId}/message)
// ABOUTME: Handles sending messages to specific agent threads and emitting events via SSE

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/threads/[threadId]/message/route';
import type { ThreadId, MessageResponse } from '@/types/api';
import { asThreadId } from '@/lib/server/core-types';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

// Mock Agent interface that matches the actual Agent API
interface MockAgent {
  threadId: ThreadId;
  name: string;
  provider: string;
  model: string;
  status: string;
  createdAt: string;
  sendMessage: ReturnType<typeof vi.fn>;
}

// Mock Session interface
interface MockSession {
  getAgent: ReturnType<typeof vi.fn>;
}

// Mock business logic Agent type that has the required methods
interface MockBusinessAgent {
  threadId: ThreadId;
  sendMessage: (message: string) => Promise<void>;
  toolExecutor?: {
    getTool: (toolName: string) => unknown;
  };
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  [key: string]: unknown; // Allow additional properties for casting
}

// Error response interface
interface ErrorResponse {
  error: string;
}

// Mock SSE manager with proper types
const mockSSEManager = {
  broadcast: vi.fn(),
};

vi.mock('@/lib/sse-manager', () => ({
  SSEManager: {
    getInstance: () => mockSSEManager,
  },
}));

// Create the mock service outside so we can access it
const mockSessionService = {
  createSession: vi.fn(),
  listSessions: vi.fn(),
  getSession: vi.fn(),
  spawnAgent: vi.fn(),
  getAgent: vi.fn(),
  sendMessage: vi.fn(),
  handleAgentEvent: vi.fn(),
};

// Mock the session service
vi.mock('@/lib/server/session-service', () => ({
  getSessionService: () => mockSessionService,
}));

describe('Thread Messaging API', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setupTestPersistence();
    vi.clearAllMocks();

    // Mock console methods to prevent stderr/stdout pollution during tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    teardownTestPersistence();
  });

  describe('POST /api/threads/{threadId}/message', () => {
    const threadId = asThreadId('lace_20250113_session1.1');
    const sessionId = asThreadId('lace_20250113_session1');

    it('should accept message and queue for processing', async () => {
      const mockAgent: MockAgent = {
        threadId,
        name: 'pm',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        status: 'idle',
        createdAt: new Date().toISOString(),
        sendMessage: vi.fn().mockResolvedValue(undefined),
      };

      const mockSession: MockSession = {
        getAgent: vi.fn().mockReturnValue(mockAgent as unknown as MockBusinessAgent),
      };

      mockSessionService.getSession.mockResolvedValue(mockSession);

      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: 'Help me implement OAuth' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ threadId }) });
      const data = (await response.json()) as MessageResponse;

      expect(response.status).toBe(202);
      expect(data).toMatchObject({
        status: 'accepted',
        threadId,
        messageId: expect.any(String) as string,
      });
      expect(mockAgent.sendMessage).toHaveBeenCalledWith('Help me implement OAuth');
    });

    it('should return immediate acknowledgment', async () => {
      const mockAgent: MockAgent = {
        threadId,
        name: 'architect',
        provider: 'anthropic',
        model: 'claude-3-opus',
        status: 'idle',
        createdAt: new Date().toISOString(),
        sendMessage: vi
          .fn()
          .mockImplementation(
            () => new Promise<void>((resolve) => setTimeout(() => resolve(undefined), 1000))
          ),
      };

      mockSessionService.getAgent.mockReturnValue(mockAgent as unknown as MockBusinessAgent);

      const start = Date.now();
      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: 'Design the architecture' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ threadId }) });
      const duration = Date.now() - start;

      expect(response.status).toBe(202);
      expect(duration).toBeLessThan(100); // Should return immediately
    });

    it('should validate threadId format', async () => {
      const invalidThreadId = 'invalid_thread_id';

      const request = new NextRequest(
        `http://localhost:3000/api/threads/${invalidThreadId}/message`,
        {
          method: 'POST',
          body: JSON.stringify({ message: 'Test message' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ threadId: invalidThreadId }),
      });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid thread ID format');
    });

    it('should handle non-existent threadId', async () => {
      // Mock session that exists but has no agent with the given threadId
      const mockSession: MockSession = {
        getAgent: vi.fn().mockReturnValue(null), // Agent not found
      };

      mockSessionService.getSession.mockResolvedValue(mockSession);

      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: 'Test message' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ threadId }) });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Agent not found');
    });

    it('should emit events via session SSE stream', async () => {
      const mockAgent: MockAgent = {
        threadId,
        name: 'pm',
        provider: 'anthropic',
        model: 'claude-3-haiku',
        status: 'idle',
        createdAt: new Date().toISOString(),
        sendMessage: vi.fn().mockResolvedValue(undefined),
      };

      const mockSession: MockSession = {
        getAgent: vi.fn().mockReturnValue(mockAgent as unknown as MockBusinessAgent),
      };

      mockSessionService.getSession.mockResolvedValue(mockSession);

      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: 'Test message' }),
        headers: { 'Content-Type': 'application/json' },
      });

      await POST(request, { params: Promise.resolve({ threadId }) });

      // Should broadcast USER_MESSAGE event
      expect(mockSSEManager.broadcast).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          type: 'USER_MESSAGE',
          threadId,
          data: { content: 'Test message' },
        })
      );
    });

    it('should validate message is not empty', async () => {
      // Don't set up agent mock since we shouldn't get that far
      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: '' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ threadId }) });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Message cannot be empty');
    });

    it('should handle missing message field', async () => {
      const mockAgent: MockAgent = {
        threadId,
        name: 'pm',
        provider: 'anthropic',
        model: 'claude-3-haiku',
        status: 'idle',
        createdAt: new Date().toISOString(),
        sendMessage: vi.fn(),
      };

      mockSessionService.getAgent.mockReturnValue(mockAgent as unknown as MockBusinessAgent);

      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ threadId }) });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Required');
    });

    it('should handle agent processing errors gracefully', async () => {
      const mockAgent: MockAgent = {
        threadId,
        name: 'pm',
        provider: 'anthropic',
        model: 'claude-3-haiku',
        status: 'idle',
        createdAt: new Date().toISOString(),
        sendMessage: vi.fn().mockRejectedValue(new Error('Provider error')),
      };

      const mockSession: MockSession = {
        getAgent: vi.fn().mockReturnValue(mockAgent as unknown as MockBusinessAgent),
      };

      mockSessionService.getSession.mockResolvedValue(mockSession);

      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: 'Test message' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ threadId }) });
      await response.json();

      // Should still return 202 as processing happens async
      expect(response.status).toBe(202);
    });

    it('should support sending to agent threads', async () => {
      // Test agent thread
      const mockAgent: MockAgent = {
        threadId,
        name: 'pm',
        provider: 'anthropic',
        model: 'claude-3-haiku',
        status: 'idle',
        createdAt: new Date().toISOString(),
        sendMessage: vi.fn().mockResolvedValue(undefined),
      };

      const mockSession: MockSession = {
        getAgent: vi.fn().mockReturnValue(mockAgent as unknown as MockBusinessAgent),
      };

      mockSessionService.getSession.mockResolvedValue(mockSession);

      const agentRequest = new NextRequest(
        `http://localhost:3000/api/threads/${threadId}/message`,
        {
          method: 'POST',
          body: JSON.stringify({ message: 'Message to agent' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const agentResponse = await POST(agentRequest, { params: Promise.resolve({ threadId }) });
      expect(agentResponse.status).toBe(202);
    });
  });
});
