// ABOUTME: Tests for tool approval response API route
// ABOUTME: Verifies integration with core ThreadManager approval system

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { action as POST } from '@/app/routes/api.threads.$threadId.approvals.$toolCallId';
import { getSessionService } from '@/lib/server/session-service';
import { parseResponse } from '@/lib/serialization';

// Mock the session service
vi.mock('@/lib/server/session-service');
const mockGetSessionService = vi.mocked(getSessionService);

interface MockAgent {
  handleApprovalResponse: ReturnType<typeof vi.fn>;
}

interface MockSession {
  getAgent: ReturnType<typeof vi.fn>;
}

interface MockSessionService {
  getSession: ReturnType<typeof vi.fn>;
  setupAgentEventHandlers: ReturnType<typeof vi.fn>;
  updateSession: ReturnType<typeof vi.fn>;
  clearActiveSessions: ReturnType<typeof vi.fn>;
}

describe('POST /api/threads/[threadId]/approvals/[toolCallId]', () => {
  let mockAgent: MockAgent;
  let mockSession: MockSession;
  let mockSessionService: MockSessionService;

  beforeEach(() => {
    // Create mock Agent
    mockAgent = {
      handleApprovalResponse: vi.fn(),
    };

    // Create mock Session
    mockSession = {
      getAgent: vi.fn().mockReturnValue(mockAgent),
    };

    // Create mock SessionService
    mockSessionService = {
      getSession: vi.fn().mockReturnValue(mockSession),
      setupAgentEventHandlers: vi.fn(),
      updateSession: vi.fn(),
      clearActiveSessions: vi.fn(),
    };

    mockGetSessionService.mockReturnValue(
      mockSessionService as unknown as ReturnType<typeof getSessionService>
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create TOOL_APPROVAL_RESPONSE event with correct data', async () => {
    const threadId = 'lace_20250101_test12';
    const toolCallId = 'call_456';
    const decision = 'allow_once';

    // Create mock request
    const request = new Request(
      `http://localhost:3000/api/threads/${threadId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    // Mock params
    const params = Promise.resolve({ threadId, toolCallId });

    // Call the API route
    const response = await POST(request, { params });

    // Verify Agent.handleApprovalResponse was called correctly
    expect(mockAgent.handleApprovalResponse).toHaveBeenCalledWith(toolCallId, decision);

    // Verify response
    expect(response.status).toBe(200);
    const data = await parseResponse<{ success: boolean }>(response);
    expect(data).toEqual({ success: true });
  });

  it('should handle different approval decisions', async () => {
    const threadId = 'lace_20250101_test12';
    const toolCallId = 'call_456';
    const decisions = ['allow_once', 'allow_session', 'deny'];

    for (const decision of decisions) {
      const request = new Request(
        `http://localhost:3000/api/threads/${threadId}/approvals/${toolCallId}`,
        {
          method: 'POST',
          body: JSON.stringify({ decision }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const params = Promise.resolve({ threadId, toolCallId });
      const response = await POST(request, { params });

      expect(mockAgent.handleApprovalResponse).toHaveBeenCalledWith(toolCallId, decision);

      expect(response.status).toBe(200);
      const data = await parseResponse<{ success: boolean }>(response);
      expect(data).toEqual({ success: true });

      // Clear mocks between iterations
      vi.clearAllMocks();
      mockGetSessionService.mockReturnValue(
        mockSessionService as unknown as ReturnType<typeof getSessionService>
      );
      mockSessionService.getSession.mockReturnValue(mockSession);
      mockSession.getAgent.mockReturnValue(mockAgent);
    }
  });

  it('should return error if agent not found', async () => {
    const threadId = 'lace_20250101_test12';
    const toolCallId = 'call_456';
    const decision = 'allow_once';

    // Mock agent not found
    mockSession.getAgent.mockReturnValue(null);

    const request = new Request(
      `http://localhost:3000/api/threads/${threadId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const params = Promise.resolve({ threadId, toolCallId });
    const response = await POST(request, { params });

    // Should not call handleApprovalResponse if agent not found
    expect(mockAgent.handleApprovalResponse).not.toHaveBeenCalled();

    expect(response.status).toBe(404);
    const data = await parseResponse<{ error: string; code?: string }>(response);
    expect(data).toEqual({ error: 'Agent not found for thread', code: 'RESOURCE_NOT_FOUND' });
  });

  it('should return error for invalid JSON', async () => {
    const threadId = 'lace_20250101_test12';
    const toolCallId = 'call_456';

    const request = new Request(
      `http://localhost:3000/api/threads/${threadId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: 'invalid json',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const params = Promise.resolve({ threadId, toolCallId });
    const response = await POST(request, { params });

    expect(response.status).toBe(400);
    const data = await parseResponse<{ error: string }>(response);
    expect(data).toHaveProperty('error');
  });

  it('should return error for missing decision', async () => {
    const threadId = 'lace_20250101_test12';
    const toolCallId = 'call_456';

    const request = new Request(
      `http://localhost:3000/api/threads/${threadId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({}), // Missing decision
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const params = Promise.resolve({ threadId, toolCallId });
    const response = await POST(request, { params });

    expect(response.status).toBe(400);
    const data = await parseResponse<{ error: string }>(response);
    expect(data).toHaveProperty('error');
  });

  it('should handle duplicate approval requests gracefully', async () => {
    const threadId = 'lace_20250101_test12';
    const toolCallId = 'call_456';
    const decision = 'allow_once';

    // Mock the first call to succeed (agent handles it gracefully)
    mockAgent.handleApprovalResponse.mockResolvedValueOnce(undefined);

    // Mock the second call to also succeed (agent handles duplicates)
    mockAgent.handleApprovalResponse.mockResolvedValueOnce(undefined);

    // First request should succeed
    const request1 = new Request(
      `http://localhost:3000/api/threads/${threadId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const params = Promise.resolve({ threadId, toolCallId });
    const response1 = await POST(request1, { params });

    expect(response1.status).toBe(200);
    const data1 = await parseResponse<{ success: boolean }>(response1);
    expect(data1).toEqual({ success: true });

    // Second request (duplicate) should also succeed
    const request2 = new Request(
      `http://localhost:3000/api/threads/${threadId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response2 = await POST(request2, { params });

    expect(response2.status).toBe(200);
    const data2 = await parseResponse<{ success: boolean }>(response2);
    expect(data2).toEqual({ success: true });

    // Verify handleApprovalResponse was called twice
    expect(mockAgent.handleApprovalResponse).toHaveBeenCalledTimes(2);
  });

  it('should throw non-constraint errors normally', async () => {
    const threadId = 'lace_20250101_test12';
    const toolCallId = 'call_456';
    const decision = 'allow_once';

    // Mock handleApprovalResponse to throw a non-constraint error
    mockAgent.handleApprovalResponse.mockRejectedValueOnce(new Error('Some other agent error'));

    const request = new Request(
      `http://localhost:3000/api/threads/${threadId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const params = Promise.resolve({ threadId, toolCallId });
    const response = await POST(request, { params });

    expect(response.status).toBe(500);
    const data = await parseResponse<{ error: string; code?: string }>(response);
    expect(data).toEqual({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  });
});
