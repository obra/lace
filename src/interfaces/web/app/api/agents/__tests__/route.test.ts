// ABOUTME: Tests for agents API endpoint with proper Agent service mocking
// ABOUTME: Ensures agent creation, listing, and error handling work correctly

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, DELETE } from '../route';
import { sharedAgentService } from '~/interfaces/web/lib/agent-service';

// Mock the shared agent service
vi.mock('~/interfaces/web/lib/agent-service', () => ({
  sharedAgentService: {
    createAgentForThread: vi.fn(),
    getThreadHistory: vi.fn(),
  },
}));

// Use real logger - we want to see actual log output in tests

describe('/api/agents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET endpoint', () => {
    it('should return agent info when agentId provided', async () => {
      const agentId = 'lace_20250713_abc123.1';
      const mockMessages = [
        { id: '1', type: 'usermessage', content: 'Hello', timestamp: '2025-07-13T00:00:00Z' },
        { id: '2', type: 'agentmessage', content: 'Hi there!', timestamp: '2025-07-13T00:01:00Z' },
      ];

      vi.mocked(sharedAgentService.getThreadHistory).mockReturnValue(mockMessages);

      const request = new NextRequest(`http://localhost:3000/api/agents?agentId=${agentId}`);
      
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.agentId).toBe(agentId);
      expect(data.sessionId).toBe('lace_20250713_abc123');
      expect(data.status).toBe('active');
      expect(data.messageCount).toBe(mockMessages.length);
      expect(sharedAgentService.getThreadHistory).toHaveBeenCalledWith(agentId);
    });

    it('should return 501 for session-based agent listing', async () => {
      const sessionId = 'lace_20250713_abc123';
      const request = new NextRequest(`http://localhost:3000/api/agents?sessionId=${sessionId}`);
      
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(501);
      expect(data.error).toBe('Session-based agent listing not yet implemented');
    });

    it('should return 501 for general agent listing', async () => {
      const request = new NextRequest('http://localhost:3000/api/agents');
      
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(501);
      expect(data.error).toBe('Agent listing not yet implemented');
    });

    it('should handle thread not found error', async () => {
      const agentId = 'nonexistent-agent';
      
      vi.mocked(sharedAgentService.getThreadHistory).mockImplementation(() => {
        throw new Error('Thread not found');
      });

      const request = new NextRequest(`http://localhost:3000/api/agents?agentId=${agentId}`);
      
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Agent not found');
    });
  });

  describe('POST endpoint', () => {
    it('should create a new agent successfully', async () => {
      const sessionId = 'lace_20250713_abc123';
      const mockThreadInfo = {
        threadId: `${sessionId}.1`,
        isNew: true,
      };

      vi.mocked(sharedAgentService.createAgentForThread).mockReturnValue({
        agent: {} as any,
        threadInfo: mockThreadInfo,
      });

      const requestBody = {
        sessionId,
        name: 'Test Agent',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        role: 'assistant',
        metadata: { test: 'data' },
      };

      const request = new NextRequest('http://localhost:3000/api/agents', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.agentId).toBe(mockThreadInfo.threadId);
      expect(data.sessionId).toBe(sessionId);
      expect(data.name).toBe(requestBody.name);
      expect(data.provider).toBe(requestBody.provider);
      expect(data.model).toBe(requestBody.model);
      expect(data.role).toBe(requestBody.role);
      expect(data.status).toBe('active');
      expect(data.messageCount).toBe(0);
      expect(data.metadata).toEqual(requestBody.metadata);
      expect(sharedAgentService.createAgentForThread).toHaveBeenCalledWith(sessionId);
    });

    it('should create standalone agent when no sessionId provided', async () => {
      const mockThreadInfo = {
        threadId: 'lace_20250713_standalone',
        isNew: true,
      };

      vi.mocked(sharedAgentService.createAgentForThread).mockReturnValue({
        agent: {} as any,
        threadInfo: mockThreadInfo,
      });

      const requestBody = {
        name: 'Standalone Agent',
        provider: 'openai',
        model: 'gpt-4',
      };

      const request = new NextRequest('http://localhost:3000/api/agents', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.agentId).toBe(mockThreadInfo.threadId);
      expect(data.sessionId).toBe(mockThreadInfo.threadId); // Should be the same for standalone
      expect(sharedAgentService.createAgentForThread).toHaveBeenCalledWith(undefined);
    });

    it('should handle agent creation errors', async () => {
      vi.mocked(sharedAgentService.createAgentForThread).mockImplementation(() => {
        throw new Error('Failed to create agent thread');
      });

      const request = new NextRequest('http://localhost:3000/api/agents', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Agent' }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to create agent thread');
    });
  });

  describe('DELETE endpoint', () => {
    it('should return 400 when agentId not provided', async () => {
      const request = new NextRequest('http://localhost:3000/api/agents', {
        method: 'DELETE',
      });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('agentId parameter is required');
    });

    it('should return 501 for not implemented functionality', async () => {
      const agentId = 'test-agent-123';
      const request = new NextRequest(`http://localhost:3000/api/agents?agentId=${agentId}`, {
        method: 'DELETE',
      });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(501);
      expect(data.error).toBe('Agent deletion not yet implemented');
      expect(data.note).toBe('This feature needs to be added to the Agent interface');
    });
  });
});