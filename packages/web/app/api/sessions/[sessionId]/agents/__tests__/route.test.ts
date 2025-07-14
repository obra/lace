// ABOUTME: Tests for agent spawning API endpoints (POST/GET /api/sessions/{sessionId}/agents)
// ABOUTME: Agents are child threads within a session, identified by threadId like sessionId.N

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '../route';
import type { ThreadId } from '@/types/api';

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
  getSessionService: () => mockSessionService
}));

describe('Agent Spawning API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/sessions/{sessionId}/agents', () => {
    const sessionId = 'lace_20250113_session1' as ThreadId;

    it('should create agent with threadId like {sessionId}.{n}', async () => {
      // Mock session exists with existing agents
      mockSessionService.getSession.mockResolvedValue({
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: [
          { threadId: `${sessionId}.1` as ThreadId, name: 'agent1', provider: 'anthropic', model: 'claude-3-haiku', status: 'idle', createdAt: new Date().toISOString() },
          { threadId: `${sessionId}.2` as ThreadId, name: 'agent2', provider: 'anthropic', model: 'claude-3-haiku', status: 'idle', createdAt: new Date().toISOString() }
        ]
      });
      
      const newThreadId = `${sessionId}.3` as ThreadId;
      const newAgent = {
        threadId: newThreadId,
        name: 'architect',
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
        status: 'idle' as const,
        createdAt: new Date().toISOString()
      };
      mockSessionService.spawnAgent.mockResolvedValue(newAgent);

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'architect',
          provider: 'anthropic',
          model: 'claude-3-opus-20240229'
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId }) });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.agent).toMatchObject({
        threadId: newThreadId,
        name: 'architect',
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
        status: 'idle'
      });
      expect(mockSessionService.spawnAgent).toHaveBeenCalledWith(
        sessionId,
        'architect',
        'anthropic',
        'claude-3-opus-20240229'
      );
    });

    it('should support provider/model specification', async () => {
      mockSessionService.getSession.mockResolvedValue({
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: []
      });
      const newAgent = {
        threadId: `${sessionId}.1` as ThreadId,
        name: 'reviewer',
        provider: 'openai',
        model: 'gpt-4',
        status: 'idle' as const,
        createdAt: new Date().toISOString()
      };
      mockSessionService.spawnAgent.mockResolvedValue(newAgent);

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'reviewer',
          provider: 'openai',
          model: 'gpt-4'
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId }) });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.agent.provider).toBe('openai');
      expect(data.agent.model).toBe('gpt-4');
    });

    it('should return agent threadId and metadata', async () => {
      const threadId = `${sessionId}.1` as ThreadId;
      mockSessionService.getSession.mockResolvedValue({
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: []
      });
      const newAgent = {
        threadId,
        name: 'pm',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        status: 'idle' as const,
        createdAt: new Date().toISOString()
      };
      mockSessionService.spawnAgent.mockResolvedValue(newAgent);

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({ name: 'pm' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId }) });
      const data = await response.json();

      expect(data.agent).toMatchObject({
        threadId,
        name: 'pm',
        status: 'idle',
        createdAt: expect.any(String)
      });
    });

    it('should increment agent numbers sequentially', async () => {
      // First call - no existing agents
      mockSessionService.getSession.mockResolvedValueOnce({
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: []
      });
      const firstAgent = {
        threadId: `${sessionId}.1` as ThreadId,
        name: 'agent1',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        status: 'idle' as const,
        createdAt: new Date().toISOString()
      };
      mockSessionService.spawnAgent.mockResolvedValueOnce(firstAgent);

      const request1 = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({ name: 'agent1' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response1 = await POST(request1, { params: Promise.resolve({ sessionId }) });
      const data1 = await response1.json();
      expect(data1.agent.threadId).toBe(`${sessionId}.1`);

      // Second call - one existing agent
      mockSessionService.getSession.mockResolvedValueOnce({
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: [firstAgent]
      });
      const secondAgent = {
        threadId: `${sessionId}.2` as ThreadId,
        name: 'agent2',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        status: 'idle' as const,
        createdAt: new Date().toISOString()
      };
      mockSessionService.spawnAgent.mockResolvedValueOnce(secondAgent);

      const request2 = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({ name: 'agent2' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response2 = await POST(request2, { params: Promise.resolve({ sessionId }) });
      const data2 = await response2.json();
      expect(data2.agent.threadId).toBe(`${sessionId}.2`);
    });

    it('should return 404 for invalid sessionId', async () => {
      mockSessionService.spawnAgent.mockRejectedValue(new Error('Session not found'));

      const request = new NextRequest(`http://localhost:3000/api/sessions/invalid/agents`, {
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId: 'invalid' }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should validate required agent name', async () => {
      mockSessionService.getSession.mockResolvedValue({
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: []
      });

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Agent name is required');
    });
  });

  describe('GET /api/sessions/{sessionId}/agents', () => {
    const sessionId = 'lace_20250113_session1' as ThreadId;

    it('should list all agents in session', async () => {
      const agents = [
        {
          threadId: `${sessionId}.1` as ThreadId,
          name: 'pm',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
          status: 'idle' as const,
          createdAt: new Date().toISOString()
        },
        {
          threadId: `${sessionId}.2` as ThreadId,
          name: 'architect',
          provider: 'anthropic',
          model: 'claude-3-opus-20240229',
          status: 'idle' as const,
          createdAt: new Date().toISOString()
        }
      ];
      
      mockSessionService.getSession.mockResolvedValue({
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents
      });

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`);
      const response = await GET(request, { params: Promise.resolve({ sessionId }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.agents).toHaveLength(2);
      expect(data.agents[0]).toMatchObject({
        threadId: `${sessionId}.1`,
        name: 'pm',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307'
      });
      expect(data.agents[1]).toMatchObject({
        threadId: `${sessionId}.2`,
        name: 'architect',
        provider: 'anthropic',
        model: 'claude-3-opus-20240229'
      });
    });

    it('should include agent threadIds and metadata', async () => {
      const testAgent = {
        threadId: `${sessionId}.1` as ThreadId,
        name: 'pm',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        status: 'thinking' as const,
        createdAt: '2025-01-13T10:00:00Z'
      };
      
      mockSessionService.getSession.mockResolvedValue({
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: [testAgent]
      });

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`);
      const response = await GET(request, { params: Promise.resolve({ sessionId }) });
      const data = await response.json();

      expect(data.agents[0]).toMatchObject({
        threadId: testAgent.threadId,
        name: 'pm',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        status: 'thinking',
        createdAt: '2025-01-13T10:00:00Z'
      });
    });

    it('should return empty array for session with no agents', async () => {
      mockSessionService.getSession.mockResolvedValue({
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: []
      });

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`);
      const response = await GET(request, { params: Promise.resolve({ sessionId }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.agents).toEqual([]);
    });

    it('should return 404 for non-existent session', async () => {
      mockSessionService.getSession.mockResolvedValue(null);

      const request = new NextRequest(`http://localhost:3000/api/sessions/invalid/agents`);
      const response = await GET(request, { params: Promise.resolve({ sessionId: 'invalid' }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });
  });
});