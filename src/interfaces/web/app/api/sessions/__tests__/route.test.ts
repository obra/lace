// ABOUTME: Tests for sessions API endpoint with proper Agent service mocking
// ABOUTME: Ensures session creation, listing, and error handling work correctly

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, DELETE } from '../route';
import { sharedAgentService } from '~/interfaces/web/lib/agent-service';

// Mock the shared agent service
vi.mock('~/interfaces/web/lib/agent-service', () => ({
  sharedAgentService: {
    createAgentForThread: vi.fn(),
    getSharedAgent: vi.fn(),
  },
}));

// Use real logger - we want to see actual log output in tests

describe('/api/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET endpoint', () => {
    it('should list all sessions when no sessionId provided', async () => {
      const request = new NextRequest('http://localhost:3000/api/sessions');
      
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ sessions: [] });
    });

    it('should return specific session when sessionId provided', async () => {
      const sessionId = 'test-session-123';
      const request = new NextRequest(`http://localhost:3000/api/sessions?sessionId=${sessionId}`);
      
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe(sessionId);
      expect(data.name).toBe(`Session ${sessionId}`);
      expect(data.status).toBe('active');
      expect(data.agents).toEqual([]);
    });

    it('should handle errors gracefully', async () => {
      // Mock an error in the request processing
      const request = new NextRequest('http://localhost:3000/api/sessions');
      
      // Simulate error by providing invalid URL
      const mockGet = vi.spyOn(URL.prototype, 'searchParams', 'get').mockImplementation(() => {
        throw new Error('Invalid URL');
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Invalid URL');
      
      // Clean up the mock
      mockGet.mockRestore();
    });
  });

  describe('POST endpoint', () => {
    it('should create a new session successfully', async () => {
      const mockThreadInfo = {
        threadId: 'lace_20250713_abc123',
        isNew: true,
      };

      // Mock the agent service
      vi.mocked(sharedAgentService.createAgentForThread).mockReturnValue({
        agent: {} as any,
        threadInfo: mockThreadInfo,
      });

      const requestBody = {
        name: 'Test Session',
        metadata: { project: 'test' },
      };

      const request = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.id).toBe(mockThreadInfo.threadId);
      expect(data.name).toBe(requestBody.name);
      expect(data.status).toBe('active');
      expect(data.agents).toEqual([]);
      expect(data.metadata).toEqual(requestBody.metadata);
      expect(sharedAgentService.createAgentForThread).toHaveBeenCalledWith();
    });

    it('should create session with default name when none provided', async () => {
      const mockThreadInfo = {
        threadId: 'lace_20250713_def456',
        isNew: true,
      };

      vi.mocked(sharedAgentService.createAgentForThread).mockReturnValue({
        agent: {} as any,
        threadInfo: mockThreadInfo,
      });

      const request = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.name).toBe('New Session');
    });

    it('should fail when agent service is not initialized', async () => {
      // Mock agent service to throw error
      vi.mocked(sharedAgentService.createAgentForThread).mockImplementation(() => {
        throw new Error('Shared agent not initialized');
      });

      const request = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Session' }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Shared agent not initialized');
    });

    it('should handle invalid JSON in request body', async () => {
      const request = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        body: 'invalid json',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain('Unexpected token');
    });
  });

  describe('DELETE endpoint', () => {
    it('should return 400 when sessionId not provided', async () => {
      const request = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'DELETE',
      });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('sessionId parameter is required');
    });

    it('should return 501 for not implemented functionality', async () => {
      const sessionId = 'test-session-123';
      const request = new NextRequest(`http://localhost:3000/api/sessions?sessionId=${sessionId}`, {
        method: 'DELETE',
      });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(501);
      expect(data.error).toBe('Session deletion not yet implemented');
      expect(data.note).toBe('This feature needs to be added to the Agent interface');
    });
  });
});