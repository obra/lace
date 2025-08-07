// ABOUTME: Tests for agent API endpoints - GET, PUT for agent management
// ABOUTME: Covers agent retrieval, updates with validation and error handling

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from '@/app/api/agents/[agentId]/route';
import { parseResponse } from '@/lib/serialization';
import { setupWebTest } from '@/test-utils/web-test-setup';
import {
  Session,
  createTestProviderInstance,
  cleanupTestProviderInstances,
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '@/lib/server/lace-imports';

// Type interfaces for API responses
interface AgentResponse {
  agent: {
    threadId: string;
    name: string;
    provider: string;
    modelId: string;
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
  model: 'claude-3-sonnet',
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

vi.mock('@/types/core', () => ({
  asThreadId: vi.fn((id: string) => id),
  isThreadId: vi.fn((id: string) => id.match(/^lace_\d{8}_[a-z0-9]{6}(\.\d+)?$/)),
}));

// Using real validation with valid threadId formats

describe('Agent API', () => {
  const _tempDir = setupWebTest();
  // Declare provider instance IDs at describe level
  let testProviderInstanceId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    setupTestProviderDefaults();
    Session.clearProviderCache();

    // Create real provider instance for testing
    testProviderInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022'],
      displayName: 'Test Provider Instance',
      apiKey: 'test-key',
    });

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

  afterEach(async () => {
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([testProviderInstanceId]);
    vi.clearAllMocks();
  });

  describe('GET /api/agents/:agentId', () => {
    it('should return agent details when found', async () => {
      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1');
      const response = await GET(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });
      const data = await parseResponse<AgentResponse>(response);

      expect(response.status).toBe(200);
      expect(data.agent).toEqual({
        threadId: 'lace_20241122_abc123.1',
        name: 'Test Agent',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        providerInstanceId: '',
        modelId: 'claude-3-sonnet',
        status: 'idle',
        createdAt: expect.any(Date) as Date,
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
      const data = await parseResponse<AgentResponse>(response);

      expect(response.status).toBe(200);
      expect(data.agent.name).toBe('Agent lace_20241122_abc123.1');
      expect(data.agent.provider).toBe('anthropic');
      expect(data.agent.modelId).toBe('claude-3-sonnet');
    });

    it('should return 400 for invalid agent ID', async () => {
      const request = new NextRequest('http://localhost/api/agents/invalid-id');
      const response = await GET(request, { params: Promise.resolve({ agentId: 'invalid-id' }) });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid agent ID');
    });

    it('should return 404 when session not found', async () => {
      mockSessionService.getSession.mockResolvedValue(null);

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1');
      const response = await GET(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should return 404 when agent not found in session', async () => {
      mockSession.getAgent.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.99');
      const response = await GET(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.99' }),
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Agent not found');
    });

    it('should handle errors gracefully', async () => {
      mockSessionService.getSession.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1');
      const response = await GET(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });

  describe('PUT /api/agents/:agentId', () => {
    it('should update agent successfully', async () => {
      const updateData = {
        name: 'Updated Agent',
        providerInstanceId: testProviderInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
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
      const data = await parseResponse<AgentResponse>(response);

      expect(response.status).toBe(200);
      expect(mockAgent.updateThreadMetadata).toHaveBeenCalledWith({
        name: 'Updated Agent',
        providerInstanceId: testProviderInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      });
      expect(data.agent).toEqual({
        threadId: 'lace_20241122_abc123.1',
        name: 'Test Agent',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        providerInstanceId: '',
        modelId: 'claude-3-sonnet',
        status: 'idle',
        createdAt: expect.any(Date) as Date,
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
        body: JSON.stringify({
          name: 'Test',
          providerInstanceId: testProviderInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, { params: Promise.resolve({ agentId: 'invalid-id' }) });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid agent ID');
    });

    it('should return 400 for invalid request data', async () => {
      const invalidData = {
        // Provide only one of the provider fields - should fail validation
        providerInstanceId: testProviderInstanceId,
        // Missing modelId
      };

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1', {
        method: 'PUT',
        body: JSON.stringify(invalidData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toContain('Both providerInstanceId and modelId must be provided together');
      expect(data.details).toBeDefined();
    });

    it('should return 404 when session not found', async () => {
      mockSessionService.getSession.mockResolvedValue(null);

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1', {
        method: 'PUT',
        body: JSON.stringify({
          name: 'Test',
          providerInstanceId: 'test-provider',
          modelId: 'test-model',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should return 404 when agent not found', async () => {
      mockSession.getAgent.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.99', {
        method: 'PUT',
        body: JSON.stringify({
          name: 'Test',
          providerInstanceId: testProviderInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.99' }),
      });
      const data = await parseResponse<ErrorResponse>(response);

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
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(500);
      expect(data.error).toContain('Unexpected token');
    });

    it('should handle update errors gracefully', async () => {
      mockAgent.updateThreadMetadata.mockImplementation(() => {
        throw new Error('Update failed');
      });

      const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1', {
        method: 'PUT',
        body: JSON.stringify({
          name: 'Test',
          providerInstanceId: testProviderInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, {
        params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Update failed');
    });
  });
});
