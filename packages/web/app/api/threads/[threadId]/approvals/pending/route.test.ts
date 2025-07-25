// ABOUTME: Tests for pending approvals API route
// ABOUTME: Verifies recovery query integration with core ThreadManager

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { getSessionService } from '@/lib/server/session-service';

// Mock the session service
vi.mock('@/lib/server/session-service');
const mockGetSessionService = vi.mocked(getSessionService);

interface MockThreadManager {
  getPendingApprovals: ReturnType<typeof vi.fn>;
}

interface MockToolExecutor {
  getTool?: ReturnType<typeof vi.fn>;
}

interface MockAgent {
  threadManager: MockThreadManager;
  toolExecutor: MockToolExecutor;
}

interface MockSession {
  getAgent: ReturnType<typeof vi.fn>;
}

interface MockSessionService {
  getSession: ReturnType<typeof vi.fn>;
}

describe('GET /api/threads/[threadId]/approvals/pending', () => {
  let mockAgent: MockAgent;
  let mockThreadManager: MockThreadManager;
  let mockSession: MockSession;
  let mockSessionService: MockSessionService;

  beforeEach(() => {
    // Create mock ThreadManager
    mockThreadManager = {
      getPendingApprovals: vi.fn(),
    };

    // Create mock Agent
    mockAgent = {
      threadManager: mockThreadManager,
      toolExecutor: {
        getTool: vi.fn().mockReturnValue({
          description: 'Mock tool description',
          annotations: { readOnlyHint: false }
        })
      },
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

  it('should return pending approvals from ThreadManager', async () => {
    const threadId = 'thread_123';
    const mockPendingApprovals = [
      {
        toolCallId: 'call_456',
        toolCall: { name: 'bash', arguments: { command: 'ls' } },
        requestedAt: new Date('2025-01-24T12:00:00Z'),
      },
      {
        toolCallId: 'call_789',
        toolCall: { name: 'file-write', arguments: { path: '/test.txt', content: 'test' } },
        requestedAt: new Date('2025-01-24T12:01:00Z'),
      },
    ];

    // Expected JSON response (dates become ISO strings, includes requestData)
    const expectedJsonResponse = [
      {
        toolCallId: 'call_456',
        toolCall: { name: 'bash', arguments: { command: 'ls' } },
        requestedAt: '2025-01-24T12:00:00.000Z',
        requestData: {
          requestId: 'call_456',
          toolName: 'bash',
          input: { command: 'ls' },
          isReadOnly: false,
          toolDescription: 'Mock tool description',
          toolAnnotations: { readOnlyHint: false },
          riskLevel: 'moderate',
        },
      },
      {
        toolCallId: 'call_789',
        toolCall: { name: 'file-write', arguments: { path: '/test.txt', content: 'test' } },
        requestedAt: '2025-01-24T12:01:00.000Z',
        requestData: {
          requestId: 'call_789',
          toolName: 'file-write',
          input: { path: '/test.txt', content: 'test' },
          isReadOnly: false,
          toolDescription: 'Mock tool description',
          toolAnnotations: { readOnlyHint: false },
          riskLevel: 'moderate',
        },
      },
    ];

    mockThreadManager.getPendingApprovals.mockReturnValue(mockPendingApprovals);

    const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/approvals/pending`);
    const params = { threadId };

    const response = await GET(request, { params });

    // Verify ThreadManager.getPendingApprovals was called
    expect(mockThreadManager.getPendingApprovals).toHaveBeenCalledWith(threadId);

    // Verify response
    expect(response.status).toBe(200);
    const data = (await response.json()) as { pendingApprovals: unknown[] };
    expect(data).toEqual({ pendingApprovals: expectedJsonResponse });
  });

  it('should return empty array when no pending approvals', async () => {
    const threadId = 'thread_empty';
    
    mockThreadManager.getPendingApprovals.mockReturnValue([]);

    const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/approvals/pending`);
    const params = { threadId };

    const response = await GET(request, { params });

    expect(mockThreadManager.getPendingApprovals).toHaveBeenCalledWith(threadId);
    expect(response.status).toBe(200);
    
    const data = (await response.json()) as { pendingApprovals: unknown[] };
    expect(data).toEqual({ pendingApprovals: [] });
  });

  it('should return error if agent not found', async () => {
    const threadId = 'nonexistent_thread';

    // Mock agent not found
    mockSession.getAgent.mockReturnValue(null);

    const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/approvals/pending`);
    const params = { threadId };

    const response = await GET(request, { params });

    // Should not call getPendingApprovals if agent not found
    expect(mockThreadManager.getPendingApprovals).not.toHaveBeenCalled();

    expect(response.status).toBe(404);
    const data = (await response.json()) as { error: string };
    expect(data).toEqual({ error: 'Agent not found for thread' });
  });

  it('should handle multiple pending approvals with different tool types', async () => {
    const threadId = 'thread_multi';
    const mockPendingApprovals = [
      {
        toolCallId: 'call_bash',
        toolCall: { 
          name: 'bash', 
          arguments: { command: 'rm -rf /important' } 
        },
        requestedAt: new Date('2025-01-24T10:00:00Z'),
      },
      {
        toolCallId: 'call_file_write',
        toolCall: { 
          name: 'file-write', 
          arguments: { path: '/etc/passwd', content: 'malicious' } 
        },
        requestedAt: new Date('2025-01-24T10:01:00Z'),
      },
      {
        toolCallId: 'call_url_fetch',
        toolCall: { 
          name: 'url-fetch', 
          arguments: { url: 'https://malicious.com/data' } 
        },
        requestedAt: new Date('2025-01-24T10:02:00Z'),
      },
    ];

    // Expected JSON response (dates become ISO strings, includes requestData)
    const expectedJsonResponse = [
      {
        toolCallId: 'call_bash',
        toolCall: { 
          name: 'bash', 
          arguments: { command: 'rm -rf /important' } 
        },
        requestedAt: '2025-01-24T10:00:00.000Z',
        requestData: {
          requestId: 'call_bash',
          toolName: 'bash',
          input: { command: 'rm -rf /important' },
          isReadOnly: false,
          toolDescription: 'Mock tool description',
          toolAnnotations: { readOnlyHint: false },
          riskLevel: 'moderate',
        },
      },
      {
        toolCallId: 'call_file_write',
        toolCall: { 
          name: 'file-write', 
          arguments: { path: '/etc/passwd', content: 'malicious' } 
        },
        requestedAt: '2025-01-24T10:01:00.000Z',
        requestData: {
          requestId: 'call_file_write',
          toolName: 'file-write',
          input: { path: '/etc/passwd', content: 'malicious' },
          isReadOnly: false,
          toolDescription: 'Mock tool description',
          toolAnnotations: { readOnlyHint: false },
          riskLevel: 'moderate',
        },
      },
      {
        toolCallId: 'call_url_fetch',
        toolCall: { 
          name: 'url-fetch', 
          arguments: { url: 'https://malicious.com/data' } 
        },
        requestedAt: '2025-01-24T10:02:00.000Z',
        requestData: {
          requestId: 'call_url_fetch',
          toolName: 'url-fetch',
          input: { url: 'https://malicious.com/data' },
          isReadOnly: false,
          toolDescription: 'Mock tool description',
          toolAnnotations: { readOnlyHint: false },
          riskLevel: 'moderate',
        },
      },
    ];

    mockThreadManager.getPendingApprovals.mockReturnValue(mockPendingApprovals);

    const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/approvals/pending`);
    const params = { threadId };

    const response = await GET(request, { params });

    expect(response.status).toBe(200);
    const data = (await response.json()) as { pendingApprovals: unknown[] };
    expect(data.pendingApprovals).toHaveLength(3);
    expect(data.pendingApprovals).toEqual(expectedJsonResponse);
  });

  it('should handle ThreadManager errors gracefully', async () => {
    const threadId = 'thread_error';
    
    mockThreadManager.getPendingApprovals.mockImplementation(() => {
      throw new Error('Database connection failed');
    });

    const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/approvals/pending`);
    const params = { threadId };

    const response = await GET(request, { params });

    expect(response.status).toBe(500);
    const data = (await response.json()) as { error: string };
    expect(data).toEqual({ error: 'Failed to get pending approvals' });
  });
});