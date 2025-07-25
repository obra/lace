// ABOUTME: Tests for tool approval response API route
// ABOUTME: Verifies integration with core ThreadManager approval system

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { getSessionService } from '@/lib/server/session-service';

// Mock the session service
vi.mock('@/lib/server/session-service');
const mockGetSessionService = vi.mocked(getSessionService);

interface MockThreadManager {
  addEvent: ReturnType<typeof vi.fn>;
}

interface MockAgent {
  threadManager: MockThreadManager;
  emit: ReturnType<typeof vi.fn>;
}

interface MockSession {
  getAgent: ReturnType<typeof vi.fn>;
}

interface MockSessionService {
  getSession: ReturnType<typeof vi.fn>;
}

describe('POST /api/threads/[threadId]/approvals/[toolCallId]', () => {
  let mockAgent: MockAgent;
  let mockThreadManager: MockThreadManager;
  let mockSession: MockSession;
  let mockSessionService: MockSessionService;

  beforeEach(() => {
    // Create mock ThreadManager
    mockThreadManager = {
      addEvent: vi.fn(),
    };

    // Create mock Agent
    mockAgent = {
      threadManager: mockThreadManager,
      emit: vi.fn(),
    };

    // Create mock Session
    mockSession = {
      getAgent: vi.fn().mockReturnValue(mockAgent),
    };

    // Create mock SessionService
    mockSessionService = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    mockGetSessionService.mockReturnValue(mockSessionService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create TOOL_APPROVAL_RESPONSE event with correct data', async () => {
    const threadId = 'thread_123';
    const toolCallId = 'call_456';
    const decision = 'allow_once';

    // Create mock request
    const request = new NextRequest('http://localhost:3000/api/threads/thread_123/approvals/call_456', {
      method: 'POST',
      body: JSON.stringify({ decision }),
      headers: { 'Content-Type': 'application/json' },
    });

    // Mock params
    const params = { threadId, toolCallId };

    // Call the API route
    const response = await POST(request, { params });

    // Verify ThreadManager.addEvent was called correctly
    expect(mockThreadManager.addEvent).toHaveBeenCalledWith(
      threadId,
      'TOOL_APPROVAL_RESPONSE',
      {
        toolCallId,
        decision,
      }
    );

    // Verify response
    expect(response.status).toBe(200);
    const data = (await response.json()) as { success: boolean };
    expect(data).toEqual({ success: true });
  });

  it('should handle different approval decisions', async () => {
    const threadId = 'thread_123';
    const toolCallId = 'call_456';
    const decisions = ['allow_once', 'allow_session', 'deny'];

    for (const decision of decisions) {
      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/approvals/${toolCallId}`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
        headers: { 'Content-Type': 'application/json' },
      });

      const params = { threadId, toolCallId };
      const response = await POST(request, { params });

      expect(mockThreadManager.addEvent).toHaveBeenCalledWith(
        threadId,
        'TOOL_APPROVAL_RESPONSE',
        {
          toolCallId,
          decision,
        }
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as { success: boolean };
      expect(data).toEqual({ success: true });

      // Clear mocks between iterations
      vi.clearAllMocks();
      mockGetSessionService.mockReturnValue(mockSessionService);
      mockSessionService.getSession.mockReturnValue(mockSession);
      mockSession.getAgent.mockReturnValue(mockAgent);
    }
  });

  it('should return error if agent not found', async () => {
    const threadId = 'nonexistent_thread';
    const toolCallId = 'call_456';
    const decision = 'allow_once';

    // Mock agent not found
    mockSession.getAgent.mockReturnValue(null);

    const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/approvals/${toolCallId}`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
      headers: { 'Content-Type': 'application/json' },
    });

    const params = { threadId, toolCallId };
    const response = await POST(request, { params });

    // Should not call addEvent if agent not found
    expect(mockThreadManager.addEvent).not.toHaveBeenCalled();

    expect(response.status).toBe(404);
    const data = (await response.json()) as { error: string };
    expect(data).toEqual({ error: 'Agent not found for thread' });
  });

  it('should return error for invalid JSON', async () => {
    const threadId = 'thread_123';
    const toolCallId = 'call_456';

    const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/approvals/${toolCallId}`, {
      method: 'POST',
      body: 'invalid json',
      headers: { 'Content-Type': 'application/json' },
    });

    const params = { threadId, toolCallId };
    const response = await POST(request, { params });

    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data).toHaveProperty('error');
  });

  it('should return error for missing decision', async () => {
    const threadId = 'thread_123';
    const toolCallId = 'call_456';

    const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/approvals/${toolCallId}`, {
      method: 'POST',
      body: JSON.stringify({}), // Missing decision
      headers: { 'Content-Type': 'application/json' },
    });

    const params = { threadId, toolCallId };
    const response = await POST(request, { params });

    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data).toEqual({ error: 'Missing decision in request body' });
  });
});