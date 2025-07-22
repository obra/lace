// ABOUTME: Tests for agent API endpoints - GET, PUT for agent management
// ABOUTME: Covers agent retrieval, updates with validation and error handling

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from '@/app/api/agents/[agentId]/route';

// Type interfaces for API responses
interface AgentResponse {
  agent: {
    threadId: string;
    name: string;
    provider: string;
    model: string;
    status: string;
    createdAt: string;
  };
}

interface ErrorResponse {
  error: string;
  details?: unknown;
}

// Valid threadId format matching the validation pattern
const validSessionId = 'lace_20241122_abc123';
const validAgentId = 'lace_20241122_abc123.1';

// Mock agent instance
const mockAgent = {
  threadId: validAgentId,
  providerName: 'anthropic',
  getCurrentState: vi.fn().mockReturnValue('idle'),
  getThreadMetadata: vi.fn().mockReturnValue({
    name: 'Test Agent',
    provider: 'anthropic',
    model: 'claude-3-sonnet',
    isAgent: true,
    parentSessionId: validSessionId,
  }),
  updateThreadMetadata: vi.fn(),
};

// Mock session instance
const mockSession = {
  getId: vi.fn().mockReturnValue(validSessionId),
  getAgent: vi.fn().mockReturnValue(mockAgent),
};

// Mock SessionService
const mockSessionService = {
  getSession: vi.fn().mockResolvedValue(mockSession),
};

vi.mock('@/lib/server/session-service', () => ({
  getSessionService: vi.fn(() => mockSessionService),
}));

vi.mock('@/lib/server/core-types', () => ({
  asThreadId: vi.fn((id: string) => id),
}));

// Using real validation with valid threadId formats

describe('Agent API', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset service mocks to default behaviors
    mockSessionService.getSession.mockResolvedValue(mockSession);
    mockSession.getAgent.mockReturnValue(mockAgent);
    mockAgent.getThreadMetadata.mockReturnValue({
      name: 'Test Agent',
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      isAgent: true,
      parentSessionId: 'lace_20241122_abc123',
    });
    mockAgent.getCurrentState.mockReturnValue('idle');
  });

  describe('GET /api/agents/:agentId', () => {
    it('should return agent details when found', async () => {
      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1');
      const response = await GET(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });
      const data = (await response.json()) as AgentResponse;

      expect(response.status).toBe(200);
      expect(data.agent).toEqual({
        threadId: 'lace_20241122_abc123.1',
        name: 'Test Agent',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        status: 'idle',
        createdAt: expect.any(String) as string,
      });
      expect(mockSessionService.getSession).toHaveBeenCalledWith('lace_20241122_abc123');
      expect(mockSession.getAgent).toHaveBeenCalledWith('lace_20241122_abc123.1');
      expect(mockAgent.getThreadMetadata).toHaveBeenCalled();
    });

    it('should use fallback values when metadata is missing', async () => {
      mockAgent.getThreadMetadata.mockReturnValue({
        isAgent: true,
        parentSessionId: 'lace_20241122_abc123',
      });

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1');
      const response = await GET(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });
      const data = (await response.json()) as AgentResponse;

      expect(response.status).toBe(200);
      expect(data.agent.name).toBe('Agent lace_20241122_abc123.1');
      expect(data.agent.provider).toBe('anthropic');
      expect(data.agent.model).toBe('unknown');
    });

    it('should return 400 for invalid agent ID', async () => {
      const request = new NextRequest('http://localhost/api/agents/invalid-id');
      const response = await GET(request, { params: Promise.resolve({ agentId: 'invalid-id' }) });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid agent ID');
    });

    it('should return 404 when session not found', async () => {
      mockSessionService.getSession.mockResolvedValue(null);

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1');
      const response = await GET(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should return 404 when agent not found in session', async () => {
      mockSession.getAgent.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.99');
      const response = await GET(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.99' }),
      });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Agent not found');
    });

    it('should handle errors gracefully', async () => {
      mockSessionService.getSession.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1');
      const response = await GET(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });

  describe('PUT /api/agents/:agentId', () => {
    it('should update agent successfully', async () => {
      const updateData = {
        name: 'Updated Agent',
        provider: 'openai',
        model: 'gpt-4',
      };

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1', {
        method: 'PUT',
        body: JSON.stringify(updateData),
        headers: { 'Content-Type': 'application/json' },
      });

      // Reset mocks to ensure fresh state
      mockSessionService.getSession.mockResolvedValue(mockSession);
      mockSession.getAgent.mockReturnValue(mockAgent);

      const response = await PUT(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });
      const data = (await response.json()) as AgentResponse;

      expect(response.status).toBe(200);
      expect(mockAgent.updateThreadMetadata).toHaveBeenCalledWith({
        name: 'Updated Agent',
        provider: 'openai',
        model: 'gpt-4',
      });
      expect(data.agent).toEqual({
        threadId: 'lace_20241122_abc123.1',
        name: 'Test Agent',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        status: 'idle',
        createdAt: expect.any(String) as string,
      });
    });

    it('should update only provided fields', async () => {
      const updateData = {
        name: 'Updated Agent Only',
      };

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1', {
        method: 'PUT',
        body: JSON.stringify(updateData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });

      expect(response.status).toBe(200);
      expect(mockAgent.updateThreadMetadata).toHaveBeenCalledWith({
        name: 'Updated Agent Only',
      });
    });

    it('should skip update when no fields provided', async () => {
      const updateData = {};

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1', {
        method: 'PUT',
        body: JSON.stringify(updateData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });

      expect(response.status).toBe(200);
      expect(mockAgent.updateThreadMetadata).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid agent ID', async () => {
      const request = new NextRequest('http://localhost/api/agents/invalid-id', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, { params: Promise.resolve({ agentId: 'invalid-id' }) });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid agent ID');
    });

    it('should return 400 for invalid request data', async () => {
      const invalidData = {
        provider: 'invalid-provider', // Not in enum
      };

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1', {
        method: 'PUT',
        body: JSON.stringify(invalidData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
      expect(data.details).toBeDefined();
    });

    it('should return 404 when session not found', async () => {
      mockSessionService.getSession.mockResolvedValue(null);

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should return 404 when agent not found', async () => {
      mockSession.getAgent.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.99', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.99' }),
      });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Agent not found');
    });

    it('should handle JSON parsing errors', async () => {
      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1', {
        method: 'PUT',
        body: 'invalid json',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(500);
      expect(data.error).toContain('Unexpected token');
    });

    it('should handle update errors gracefully', async () => {
      mockAgent.updateThreadMetadata.mockImplementation(() => {
        throw new Error('Update failed');
      });

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(500);
      expect(data.error).toBe('Update failed');
    });
  });
});
