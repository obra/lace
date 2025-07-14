// ABOUTME: Tests for thread messaging API endpoint (POST /api/threads/{threadId}/message)
// ABOUTME: Handles sending messages to specific agent threads and emitting events via SSE

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/threads/[threadId]/message/route';
import type { ThreadId, SessionEvent, MessageResponse } from '@/types/api';
import type { Agent } from '@/lib/server/lace-imports';

// Mock Agent interface
interface MockAgent {
  threadId: ThreadId;
  name: string;
  provider: string;
  model: string;
  status: string;
  createdAt: string;
  sendMessage: ReturnType<typeof vi.fn>;
}

// Error response interface
interface ErrorResponse {
  error: string;
}

// Mock SSE manager with proper types
const mockSSEManager = {
  broadcast: vi.fn<[ThreadId, SessionEvent], void>(),
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
  getAgent: vi.fn<[ThreadId], Agent | null>(),
  sendMessage: vi.fn(),
  handleAgentEvent: vi.fn(),
};

// Mock the session service
vi.mock('@/lib/server/session-service', () => ({
  getSessionService: () => mockSessionService,
}));

describe('Thread Messaging API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/threads/{threadId}/message', () => {
    const threadId = 'lace_20250113_session1.1' as ThreadId;

    const sessionId = 'lace_20250113_session1' as ThreadId;

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

      mockSessionService.getAgent.mockReturnValue(mockAgent as Agent);

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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        messageId: expect.any(String),
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
            () => new Promise((resolve) => setTimeout(() => resolve(undefined), 1000))
          ),
      };

      mockSessionService.getAgent.mockReturnValue(mockAgent as Agent);

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
      expect(data.error).toBe('Invalid thread ID format');
    });

    it('should handle non-existent threadId', async () => {
      mockSessionService.getAgent.mockReturnValue(null);

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

      mockSessionService.getAgent.mockReturnValue(mockAgent as Agent);

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
      expect(data.error).toBe('Message is required');
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

      mockSessionService.getAgent.mockReturnValue(mockAgent as Agent);

      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ threadId }) });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Message is required');
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

      mockSessionService.getAgent.mockReturnValue(mockAgent as Agent);

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

      mockSessionService.getAgent.mockReturnValue(mockAgent as Agent);

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
