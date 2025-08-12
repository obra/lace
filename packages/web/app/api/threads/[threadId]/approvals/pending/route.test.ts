// ABOUTME: Tests for pending approvals API route
// ABOUTME: Verifies recovery query integration with core ThreadManager

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { getSessionService } from '@/lib/server/session-service';
import { parseResponse } from '@/lib/serialization';

// Mock the session service
vi.mock('@/lib/server/session-service');
const mockGetSessionService = vi.mocked(getSessionService);

interface MockToolExecutor {
  getTool?: ReturnType<typeof vi.fn>;
}

interface MockAgent {
  getPendingApprovals: ReturnType<typeof vi.fn>;
  toolExecutor: MockToolExecutor;
}

interface MockSession {
  getAgent: ReturnType<typeof vi.fn>;
}

interface MockSessionService {
  createSession: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  setupAgentEventHandlers: ReturnType<typeof vi.fn>;
  updateSession: ReturnType<typeof vi.fn>;
  stopAllAgents: ReturnType<typeof vi.fn>;
  clearActiveSessions: ReturnType<typeof vi.fn>;
}

describe('GET /api/threads/[threadId]/approvals/pending', () => {
  let mockAgent: MockAgent;
  let mockSession: MockSession;
  let mockSessionService: MockSessionService;

  beforeEach(() => {
    // Create mock Agent
    mockAgent = {
      getPendingApprovals: vi.fn(),
      toolExecutor: {
        getTool: vi.fn().mockReturnValue({
          description: 'Mock tool description',
          annotations: { readOnlyHint: false },
        }),
      },
    };

    // Create mock Session
    mockSession = {
      getAgent: vi.fn().mockReturnValue(mockAgent),
    };

    // Create mock SessionService
    mockSessionService = {
      createSession: vi.fn(),
      listSessions: vi.fn(),
      getSession: vi.fn().mockReturnValue(mockSession),
      setupAgentEventHandlers: vi.fn(),
      updateSession: vi.fn(),
      stopAllAgents: vi.fn(),
      clearActiveSessions: vi.fn(),
    };

    mockGetSessionService.mockReturnValue(
      mockSessionService as unknown as ReturnType<typeof getSessionService>
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return pending approvals from ThreadManager', async () => {
    const threadId = 'lace_20250101_test12';
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
        requestedAt: new Date('2025-01-24T12:00:00.000Z'),
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
        requestedAt: new Date('2025-01-24T12:01:00.000Z'),
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

    mockAgent.getPendingApprovals.mockReturnValue(mockPendingApprovals);

    const request = new NextRequest(
      `http://localhost:3000/api/threads/${threadId}/approvals/pending`
    );
    const params = Promise.resolve({ threadId });

    const response = await GET(request, { params });

    // Verify Agent.getPendingApprovals was called
    expect(mockAgent.getPendingApprovals).toHaveBeenCalledWith();

    // Verify response
    expect(response.status).toBe(200);
    const data = await parseResponse<{ pendingApprovals: unknown[] }>(response);
    expect(data).toEqual({ pendingApprovals: expectedJsonResponse });
  });

  it('should return empty array when no pending approvals', async () => {
    const threadId = 'lace_20250101_test45';

    mockAgent.getPendingApprovals.mockReturnValue([]);

    const request = new NextRequest(
      `http://localhost:3000/api/threads/${threadId}/approvals/pending`
    );
    const params = Promise.resolve({ threadId });

    const response = await GET(request, { params });

    expect(mockAgent.getPendingApprovals).toHaveBeenCalledWith();
    expect(response.status).toBe(200);

    const data = await parseResponse<{ pendingApprovals: unknown[] }>(response);
    expect(data).toEqual({ pendingApprovals: [] });
  });

  it('should return error if agent not found', async () => {
    const threadId = 'lace_20250101_fake01';

    // Mock agent not found
    mockSession.getAgent.mockReturnValue(null);

    const request = new NextRequest(
      `http://localhost:3000/api/threads/${threadId}/approvals/pending`
    );
    const params = Promise.resolve({ threadId });

    const response = await GET(request, { params });

    // Should not call getPendingApprovals if agent not found
    expect(mockAgent.getPendingApprovals).not.toHaveBeenCalled();

    expect(response.status).toBe(404);
    const data = await parseResponse<{ error: string; code?: string }>(response);
    expect(data).toEqual({ error: 'Agent not found for thread', code: 'RESOURCE_NOT_FOUND' });
  });

  it('should handle multiple pending approvals with different tool types', async () => {
    const threadId = 'lace_20250101_test78';
    const mockPendingApprovals = [
      {
        toolCallId: 'call_bash',
        toolCall: {
          name: 'bash',
          arguments: { command: 'rm -rf /important' },
        },
        requestedAt: new Date('2025-01-24T10:00:00Z'),
      },
      {
        toolCallId: 'call_file_write',
        toolCall: {
          name: 'file-write',
          arguments: { path: '/etc/passwd', content: 'malicious' },
        },
        requestedAt: new Date('2025-01-24T10:01:00Z'),
      },
      {
        toolCallId: 'call_url_fetch',
        toolCall: {
          name: 'url-fetch',
          arguments: { url: 'https://malicious.com/data' },
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
          arguments: { command: 'rm -rf /important' },
        },
        requestedAt: new Date('2025-01-24T10:00:00Z'),
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
          arguments: { path: '/etc/passwd', content: 'malicious' },
        },
        requestedAt: new Date('2025-01-24T10:01:00Z'),
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
          arguments: { url: 'https://malicious.com/data' },
        },
        requestedAt: new Date('2025-01-24T10:02:00Z'),
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

    mockAgent.getPendingApprovals.mockReturnValue(mockPendingApprovals);

    const request = new NextRequest(
      `http://localhost:3000/api/threads/${threadId}/approvals/pending`
    );
    const params = Promise.resolve({ threadId });

    const response = await GET(request, { params });

    expect(response.status).toBe(200);
    const data = await parseResponse<{ pendingApprovals: unknown[] }>(response);
    expect(data.pendingApprovals).toHaveLength(3);
    expect(data.pendingApprovals).toEqual(expectedJsonResponse);
  });

  it('should handle Agent errors gracefully', async () => {
    const threadId = 'lace_20250101_test99';

    mockAgent.getPendingApprovals.mockImplementation(() => {
      throw new Error('Database connection failed');
    });

    const request = new NextRequest(
      `http://localhost:3000/api/threads/${threadId}/approvals/pending`
    );
    const params = Promise.resolve({ threadId });

    const response = await GET(request, { params });

    expect(response.status).toBe(500);
    const data = await parseResponse<{ error: string; code?: string }>(response);
    expect(data).toEqual({
      error: 'Failed to get pending approvals',
      code: 'INTERNAL_SERVER_ERROR',
    });
  });
});
