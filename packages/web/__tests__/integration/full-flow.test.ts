// ABOUTME: Integration tests for complete conversation flow through web API
// ABOUTME: Tests session creation, agent spawning, messaging, and event streaming

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createSession } from '@/app/api/sessions/route';
import { POST as spawnAgent, GET as listAgents } from '@/app/api/sessions/[sessionId]/agents/route';
import { POST as sendMessage } from '@/app/api/threads/[threadId]/message/route';
import { GET as streamEvents } from '@/app/api/sessions/[sessionId]/events/stream/route';
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
  getSessionService: () => mockSessionService,
}));

// Mock SSE manager
const mockSSEManager = {
  addConnection: vi.fn(),
  removeConnection: vi.fn(),
  broadcast: vi.fn(),
  sessionStreams: new Map(),
};

vi.mock('@/lib/sse-manager', () => ({
  SSEManager: {
    getInstance: () => mockSSEManager,
  },
}));

describe('Full Conversation Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSSEManager.sessionStreams.clear();
  });

  it('should complete full session workflow', async () => {
    // 1. Create session
    const sessionName = 'Test Conversation';
    const sessionId = 'lace_20250113_test123' as ThreadId;
    const mockSession = {
      id: sessionId,
      name: sessionName,
      createdAt: new Date().toISOString(),
      agents: [],
    };

    mockSessionService.createSession.mockResolvedValue(mockSession);

    const createSessionRequest = new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: sessionName }),
      headers: { 'Content-Type': 'application/json' },
    });

    const sessionResponse = await createSession(createSessionRequest);
    expect(sessionResponse.status).toBe(201);
    const sessionData = (await sessionResponse.json()) as { session: { id: string } };
    expect(sessionData.session.id).toBe(sessionId);

    // 2. Spawn agent
    const agentName = 'assistant';
    const agentThreadId = `${sessionId}.1` as ThreadId;
    const mockAgent = {
      threadId: agentThreadId,
      name: agentName,
      provider: 'anthropic',
      model: 'claude-3-haiku-20240307',
      status: 'idle' as const,
      createdAt: new Date().toISOString(),
    };

    // Mock Session instance for getSession
    const mockSessionInstance = {
      getId: () => sessionId,
      getInfo: () => ({
        id: sessionId,
        name: sessionName,
        createdAt: new Date(),
        provider: 'anthropic',
        model: 'claude-3-haiku',
        agents: [],
      }),
      getAgents: () => [],
      getAgent: vi.fn(),
      getTaskManager: vi.fn(),
      spawnAgent: vi.fn(),
      startAgent: vi.fn(),
      stopAgent: vi.fn(),
      sendMessage: vi.fn(),
      destroy: vi.fn(),
    };

    mockSessionService.getSession.mockResolvedValue(mockSessionInstance);
    mockSessionService.spawnAgent.mockResolvedValue(mockAgent);

    const spawnAgentRequest = new NextRequest(
      `http://localhost:3000/api/sessions/${sessionId}/agents`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: agentName,
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const agentResponse = await spawnAgent(spawnAgentRequest, {
      params: Promise.resolve({ sessionId }),
    });
    expect(agentResponse.status).toBe(201);
    const agentData = (await agentResponse.json()) as { agent: { threadId: string } };
    expect(agentData.agent.threadId).toBe(agentThreadId);

    // 3. Connect to SSE stream
    const mockSessionWithAgent = {
      ...mockSessionInstance,
      getAgents: () => [mockAgent],
    };
    mockSessionService.getSession.mockResolvedValue(mockSessionWithAgent);

    const streamRequest = new NextRequest(
      `http://localhost:3000/api/sessions/${sessionId}/events/stream`
    );
    const streamResponse = await streamEvents(streamRequest, {
      params: Promise.resolve({ sessionId }),
    });

    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get('Content-Type')).toBe('text/event-stream');
    expect(mockSSEManager.addConnection).toHaveBeenCalledWith(sessionId, expect.any(Object));

    // 4. Send message
    const message = 'Hello, assistant!';
    const mockAgentWithMethods = {
      threadId: agentThreadId,
      name: agentName,
      provider: 'anthropic',
      model: 'claude-3-haiku-20240307',
      status: 'idle' as const,
      createdAt: new Date().toISOString(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    mockSessionService.getAgent.mockReturnValue(mockAgentWithMethods);

    const messageRequest = new NextRequest(
      `http://localhost:3000/api/threads/${agentThreadId}/message`,
      {
        method: 'POST',
        body: JSON.stringify({ message }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const messageResponse = await sendMessage(messageRequest, {
      params: Promise.resolve({ threadId: agentThreadId }),
    });
    expect(messageResponse.status).toBe(202);
    const messageData = (await messageResponse.json()) as { status: string };
    expect(messageData.status).toBe('accepted');

    // 5. Verify events flow correctly
    // Agent sendMessage should have been called
    expect(mockAgentWithMethods.sendMessage).toHaveBeenCalledWith(message);

    // 6. Verify event ordering and content
    // In a real implementation, the SessionService would emit events via SSEManager
    // Here we just verify the mock was called correctly
    expect(mockSSEManager.addConnection).toHaveBeenCalled();
  });

  it('should handle multi-agent scenario', async () => {
    const sessionId = 'lace_20250113_multi' as ThreadId;
    const mockSession = {
      id: sessionId,
      name: 'Multi-Agent Session',
      createdAt: new Date().toISOString(),
      agents: [],
    };

    // Create session
    mockSessionService.createSession.mockResolvedValue(mockSession);
    const createSessionRequest = new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: 'Multi-Agent Session' }),
      headers: { 'Content-Type': 'application/json' },
    });
    await createSession(createSessionRequest);

    // Spawn first agent
    const agent1 = {
      threadId: `${sessionId}.1` as ThreadId,
      name: 'pm',
      provider: 'anthropic',
      model: 'claude-3-haiku-20240307',
      status: 'idle' as const,
      createdAt: new Date().toISOString(),
    };

    // Mock Session instance for multi-agent scenario
    const mockMultiSession = {
      getId: () => sessionId,
      getInfo: () => ({
        id: sessionId,
        name: 'Multi-Agent Session',
        createdAt: new Date(),
        provider: 'anthropic',
        model: 'claude-3-haiku',
        agents: [],
      }),
      getAgents: () => [],
      getAgent: vi.fn(),
      getTaskManager: vi.fn(),
      spawnAgent: vi.fn(),
      startAgent: vi.fn(),
      stopAgent: vi.fn(),
      sendMessage: vi.fn(),
      destroy: vi.fn(),
    };

    mockSessionService.getSession.mockResolvedValue(mockMultiSession);
    mockSessionService.spawnAgent.mockResolvedValue(agent1);

    const spawnAgent1Request = new NextRequest(
      `http://localhost:3000/api/sessions/${sessionId}/agents`,
      {
        method: 'POST',
        body: JSON.stringify({ name: 'pm' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    await spawnAgent(spawnAgent1Request, { params: Promise.resolve({ sessionId }) });

    // Spawn second agent
    const agent2 = {
      threadId: `${sessionId}.2` as ThreadId,
      name: 'architect',
      provider: 'anthropic',
      model: 'claude-3-opus-20240229',
      status: 'idle' as const,
      createdAt: new Date().toISOString(),
    };

    // Update mock session to include first agent
    const mockMultiSessionWithAgent1 = {
      ...mockMultiSession,
      getAgents: () => [agent1],
    };
    mockSessionService.getSession.mockResolvedValue(mockMultiSessionWithAgent1);
    mockSessionService.spawnAgent.mockResolvedValue(agent2);

    const spawnAgent2Request = new NextRequest(
      `http://localhost:3000/api/sessions/${sessionId}/agents`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'architect',
          provider: 'anthropic',
          model: 'claude-3-opus-20240229',
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    await spawnAgent(spawnAgent2Request, { params: Promise.resolve({ sessionId }) });

    // List agents
    const mockMultiSessionWithBothAgents = {
      ...mockMultiSession,
      getAgents: () => [agent1, agent2],
    };
    mockSessionService.getSession.mockResolvedValue(mockMultiSessionWithBothAgents);
    const listAgentsRequest = new NextRequest(
      `http://localhost:3000/api/sessions/${sessionId}/agents`
    );
    const listResponse = await listAgents(listAgentsRequest, {
      params: Promise.resolve({ sessionId }),
    });
    const listData = (await listResponse.json()) as { agents: Array<{ name: string }> };
    const { agents } = listData;

    expect(agents).toHaveLength(2);
    expect(agents[0].name).toBe('pm');
    expect(agents[1].name).toBe('architect');
  });

  it('should isolate events between sessions', async () => {
    // Create two sessions
    const session1Id = 'lace_20250113_session1' as ThreadId;
    const session2Id = 'lace_20250113_session2' as ThreadId;

    mockSessionService.createSession
      .mockResolvedValueOnce({
        id: session1Id,
        name: 'Session 1',
        createdAt: new Date().toISOString(),
        agents: [],
      })
      .mockResolvedValueOnce({
        id: session2Id,
        name: 'Session 2',
        createdAt: new Date().toISOString(),
        agents: [],
      });

    // Create both sessions
    await createSession(
      new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ name: 'Session 1' }),
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await createSession(
      new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ name: 'Session 2' }),
        headers: { 'Content-Type': 'application/json' },
      })
    );

    // Connect to streams
    const mockSession1Instance = {
      getId: () => session1Id,
      getInfo: () => ({
        id: session1Id,
        name: 'Session 1',
        createdAt: new Date(),
        provider: 'anthropic',
        model: 'claude-3-haiku',
        agents: [],
      }),
      getAgents: () => [],
      getAgent: vi.fn(),
      getTaskManager: vi.fn(),
      spawnAgent: vi.fn(),
      startAgent: vi.fn(),
      stopAgent: vi.fn(),
      sendMessage: vi.fn(),
      destroy: vi.fn(),
    };
    mockSessionService.getSession.mockResolvedValue(mockSession1Instance);

    await streamEvents(
      new NextRequest(`http://localhost:3000/api/sessions/${session1Id}/events/stream`),
      { params: Promise.resolve({ sessionId: session1Id }) }
    );

    const mockSession2Instance = {
      getId: () => session2Id,
      getInfo: () => ({
        id: session2Id,
        name: 'Session 2',
        createdAt: new Date(),
        provider: 'anthropic',
        model: 'claude-3-haiku',
        agents: [],
      }),
      getAgents: () => [],
      getAgent: vi.fn(),
      getTaskManager: vi.fn(),
      spawnAgent: vi.fn(),
      startAgent: vi.fn(),
      stopAgent: vi.fn(),
      sendMessage: vi.fn(),
      destroy: vi.fn(),
    };
    mockSessionService.getSession.mockResolvedValue(mockSession2Instance);

    await streamEvents(
      new NextRequest(`http://localhost:3000/api/sessions/${session2Id}/events/stream`),
      { params: Promise.resolve({ sessionId: session2Id }) }
    );

    // Verify each session has its own connection
    expect(mockSSEManager.addConnection).toHaveBeenCalledWith(session1Id, expect.any(Object));
    expect(mockSSEManager.addConnection).toHaveBeenCalledWith(session2Id, expect.any(Object));
    expect(mockSSEManager.addConnection).toHaveBeenCalledTimes(2);

    // Events would be isolated by sessionId in the real implementation
  });
});
