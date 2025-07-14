// ABOUTME: Tests for agent spawning API endpoints (POST/GET /api/sessions/{sessionId}/agents)
// ABOUTME: Agents are child threads within a session, identified by threadId like sessionId.N

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '../route';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ThreadId } from '~/types/threads';
import { ProviderRegistry } from '~/providers/provider-registry';
import { ProviderManager } from '~/providers/provider-manager';
import { ToolExecutor } from '~/tools/tool-executor';

// Mock dependencies
vi.mock('~/agents/agent');
vi.mock('~/threads/thread-manager');
vi.mock('~/providers/provider-registry');
vi.mock('~/providers/provider-manager');
vi.mock('~/tools/tool-executor');
vi.mock('~/config/runtime-config', () => ({
  getRuntimeConfig: vi.fn(() => ({
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307'
  }))
}));

describe('Agent Spawning API', () => {
  let mockThreadManager: any;
  let mockProviderManager: any;
  let mockToolExecutor: any;
  let mockAgent: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockThreadManager = {
      createThread: vi.fn(),
      listThreads: vi.fn(),
      getThread: vi.fn(),
      addEvent: vi.fn()
    };
    
    mockProviderManager = {
      getProvider: vi.fn()
    };
    
    mockToolExecutor = {
      registerTool: vi.fn(),
      executeTool: vi.fn()
    };
    
    mockAgent = {
      threadId: 'lace_20250113_session1.1' as ThreadId,
      getProviderInfo: vi.fn(() => ({ provider: 'anthropic', model: 'claude-3-haiku-20240307' })),
      getState: vi.fn(() => 'idle'),
      on: vi.fn(),
      off: vi.fn(),
      abort: vi.fn()
    };

    (ThreadManager as any).mockImplementation(() => mockThreadManager);
    (ProviderManager as any).mockImplementation(() => mockProviderManager);
    (ToolExecutor as any).mockImplementation(() => mockToolExecutor);
    (Agent as any).mockImplementation(() => mockAgent);
    (ProviderRegistry.getInstance as any) = vi.fn(() => ({
      listProviders: vi.fn(() => ['anthropic', 'openai'])
    }));
  });

  describe('POST /api/sessions/{sessionId}/agents', () => {
    const sessionId = 'lace_20250113_session1';

    it('should create agent with threadId like {sessionId}.{n}', async () => {
      // Mock session exists
      mockThreadManager.getThread.mockResolvedValue({
        id: sessionId,
        created: new Date().toISOString(),
        metadata: { isSession: true, name: 'Test Session' }
      });
      
      // Mock existing agents to determine next number
      mockThreadManager.listThreads.mockResolvedValue([
        { id: sessionId },
        { id: `${sessionId}.1` },
        { id: `${sessionId}.2` }
      ]);
      
      const newThreadId = `${sessionId}.3` as ThreadId;
      mockThreadManager.createThread.mockResolvedValue(newThreadId);

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'architect',
          provider: 'anthropic',
          model: 'claude-3-opus-20240229'
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: { sessionId } });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.agent).toMatchObject({
        threadId: newThreadId,
        name: 'architect',
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
        status: 'idle'
      });
      expect(mockThreadManager.createThread).toHaveBeenCalledWith(
        expect.objectContaining({
          parentThreadId: sessionId,
          metadata: {
            agentName: 'architect',
            provider: 'anthropic',
            model: 'claude-3-opus-20240229'
          }
        })
      );
    });

    it('should support provider/model specification', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: sessionId,
        created: new Date().toISOString(),
        metadata: { isSession: true }
      });
      mockThreadManager.listThreads.mockResolvedValue([{ id: sessionId }]);
      mockThreadManager.createThread.mockResolvedValue(`${sessionId}.1` as ThreadId);

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'reviewer',
          provider: 'openai',
          model: 'gpt-4'
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: { sessionId } });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.agent.provider).toBe('openai');
      expect(data.agent.model).toBe('gpt-4');
    });

    it('should return agent threadId and metadata', async () => {
      const threadId = `${sessionId}.1` as ThreadId;
      mockThreadManager.getThread.mockResolvedValue({
        id: sessionId,
        created: new Date().toISOString(),
        metadata: { isSession: true }
      });
      mockThreadManager.listThreads.mockResolvedValue([{ id: sessionId }]);
      mockThreadManager.createThread.mockResolvedValue(threadId);

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({ name: 'pm' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: { sessionId } });
      const data = await response.json();

      expect(data.agent).toMatchObject({
        threadId,
        name: 'pm',
        status: 'idle',
        createdAt: expect.any(String)
      });
    });

    it('should increment agent numbers sequentially', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: sessionId,
        created: new Date().toISOString(),
        metadata: { isSession: true }
      });
      
      // First call - no existing agents
      mockThreadManager.listThreads.mockResolvedValueOnce([{ id: sessionId }]);
      mockThreadManager.createThread.mockResolvedValueOnce(`${sessionId}.1` as ThreadId);

      const request1 = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({ name: 'agent1' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response1 = await POST(request1, { params: { sessionId } });
      const data1 = await response1.json();
      expect(data1.agent.threadId).toBe(`${sessionId}.1`);

      // Second call - one existing agent
      mockThreadManager.listThreads.mockResolvedValueOnce([
        { id: sessionId },
        { id: `${sessionId}.1` }
      ]);
      mockThreadManager.createThread.mockResolvedValueOnce(`${sessionId}.2` as ThreadId);

      const request2 = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({ name: 'agent2' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response2 = await POST(request2, { params: { sessionId } });
      const data2 = await response2.json();
      expect(data2.agent.threadId).toBe(`${sessionId}.2`);
    });

    it('should return 404 for invalid sessionId', async () => {
      mockThreadManager.getThread.mockResolvedValue(null);

      const request = new NextRequest(`http://localhost:3000/api/sessions/invalid/agents`, {
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: { sessionId: 'invalid' } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should validate required agent name', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: sessionId,
        created: new Date().toISOString(),
        metadata: { isSession: true }
      });

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: { sessionId } });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Agent name is required');
    });
  });

  describe('GET /api/sessions/{sessionId}/agents', () => {
    const sessionId = 'lace_20250113_session1';

    it('should list all agents in session', async () => {
      const agents = [
        {
          id: `${sessionId}.1` as ThreadId,
          created: new Date().toISOString(),
          metadata: {
            agentName: 'pm',
            provider: 'anthropic',
            model: 'claude-3-haiku-20240307'
          }
        },
        {
          id: `${sessionId}.2` as ThreadId,
          created: new Date().toISOString(),
          metadata: {
            agentName: 'architect',
            provider: 'anthropic',
            model: 'claude-3-opus-20240229'
          }
        }
      ];
      
      mockThreadManager.listThreads.mockResolvedValue([
        { id: sessionId, metadata: { isSession: true } },
        ...agents
      ]);

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`);
      const response = await GET(request, { params: { sessionId } });
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
      const agentThread = {
        id: `${sessionId}.1` as ThreadId,
        created: '2025-01-13T10:00:00Z',
        metadata: {
          agentName: 'pm',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
          customField: 'value'
        }
      };
      
      mockThreadManager.listThreads.mockResolvedValue([
        { id: sessionId, metadata: { isSession: true } },
        agentThread
      ]);

      // Mock agent instance for status
      mockAgent.threadId = agentThread.id;
      mockAgent.getState.mockReturnValue('thinking');

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`);
      const response = await GET(request, { params: { sessionId } });
      const data = await response.json();

      expect(data.agents[0]).toMatchObject({
        threadId: agentThread.id,
        name: 'pm',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        status: 'idle', // Default status when agent not active
        createdAt: '2025-01-13T10:00:00Z'
      });
    });

    it('should return empty array for session with no agents', async () => {
      mockThreadManager.listThreads.mockResolvedValue([
        { id: sessionId, metadata: { isSession: true } }
      ]);

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`);
      const response = await GET(request, { params: { sessionId } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.agents).toEqual([]);
    });

    it('should return 404 for non-existent session', async () => {
      mockThreadManager.listThreads.mockResolvedValue([]);

      const request = new NextRequest(`http://localhost:3000/api/sessions/invalid/agents`);
      const response = await GET(request, { params: { sessionId: 'invalid' } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });
  });
});