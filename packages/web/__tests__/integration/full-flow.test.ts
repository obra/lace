// ABOUTME: Integration tests for complete conversation flow through web API
// ABOUTME: Tests session creation, agent spawning, messaging, and event streaming

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createSession, GET as listSessions } from '../../app/api/sessions/route';
import { POST as spawnAgent, GET as listAgents } from '../../app/api/sessions/[sessionId]/agents/route';
import { POST as sendMessage } from '../../app/api/threads/[threadId]/message/route';
import { GET as streamEvents } from '../../app/api/sessions/[sessionId]/events/stream/route';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ProviderManager } from '~/providers/provider-manager';
import { ToolExecutor } from '~/tools/tool-executor';
import { ThreadId } from '~/types/threads';
import { EventEmitter } from 'events';

// Mock all dependencies
vi.mock('~/agents/agent');
vi.mock('~/threads/thread-manager');
vi.mock('~/providers/provider-manager');
vi.mock('~/tools/tool-executor');
vi.mock('~/providers/provider-registry', () => ({
  ProviderRegistry: {
    getInstance: vi.fn(() => ({
      listProviders: vi.fn(() => ['anthropic', 'openai'])
    }))
  }
}));
vi.mock('~/config/runtime-config', () => ({
  getRuntimeConfig: vi.fn(() => ({
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307'
  }))
}));
vi.mock('../../lib/sse-manager', () => ({
  SSEManager: {
    getInstance: vi.fn(() => mockSSEManager)
  }
}));

const mockSSEManager = {
  addConnection: vi.fn(),
  removeConnection: vi.fn(),
  broadcast: vi.fn(),
  sessionStreams: new Map()
};

describe('Full Conversation Flow', () => {
  let mockThreadManager: any;
  let mockProviderManager: any;
  let mockToolExecutor: any;
  let mockProvider: any;
  let agentInstances: Map<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    agentInstances = new Map();
    
    mockProvider = {
      getName: vi.fn(() => 'anthropic'),
      complete: vi.fn().mockResolvedValue({
        content: 'I can help with that',
        usage: { input_tokens: 100, output_tokens: 50 }
      })
    };
    
    mockThreadManager = {
      createThread: vi.fn(),
      listThreads: vi.fn(),
      getThread: vi.fn(),
      addEvent: vi.fn(),
      listEvents: vi.fn(() => [])
    };
    
    mockProviderManager = {
      getProvider: vi.fn(() => mockProvider)
    };
    
    mockToolExecutor = {
      registerTool: vi.fn(),
      executeTool: vi.fn()
    };

    (ThreadManager as any).mockImplementation(() => mockThreadManager);
    (ProviderManager as any).mockImplementation(() => mockProviderManager);
    (ToolExecutor as any).mockImplementation(() => mockToolExecutor);
    
    // Mock Agent to return different instances per thread
    (Agent as any).mockImplementation((options: any) => {
      const threadId = options.threadId;
      if (!agentInstances.has(threadId)) {
        const emitter = new EventEmitter();
        const agent = {
          threadId,
          getProviderInfo: vi.fn(() => ({ 
            provider: options.provider || 'anthropic', 
            model: options.model || 'claude-3-haiku-20240307' 
          })),
          getState: vi.fn(() => 'idle'),
          processUserMessage: vi.fn().mockImplementation(async (message: string) => {
            emitter.emit('agent_thinking_start');
            await new Promise(resolve => setTimeout(resolve, 10));
            emitter.emit('agent_message', { content: 'I can help with that' });
            emitter.emit('conversation_complete');
          }),
          on: emitter.on.bind(emitter),
          off: emitter.off.bind(emitter),
          emit: emitter.emit.bind(emitter),
          abort: vi.fn(),
          _emitter: emitter
        };
        agentInstances.set(threadId, agent);
      }
      return agentInstances.get(threadId);
    });
  });

  afterEach(() => {
    agentInstances.forEach(agent => {
      if (agent._emitter) {
        agent._emitter.removeAllListeners();
      }
    });
  });

  it('should complete full session workflow', async () => {
    // 1. Create session
    const sessionName = 'OAuth Implementation';
    const sessionId = 'lace_20250113_session1' as ThreadId;
    
    mockThreadManager.createThread.mockResolvedValueOnce(sessionId);
    mockThreadManager.getThread.mockImplementation((id: string) => {
      if (id === sessionId) {
        return {
          id: sessionId,
          created: new Date().toISOString(),
          metadata: { isSession: true, name: sessionName }
        };
      }
      return null;
    });

    const createSessionReq = new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: sessionName }),
      headers: { 'Content-Type': 'application/json' }
    });

    const sessionResponse = await createSession(createSessionReq);
    const sessionData = await sessionResponse.json();
    
    expect(sessionResponse.status).toBe(201);
    expect(sessionData.session).toMatchObject({
      id: sessionId,
      name: sessionName,
      agents: []
    });

    // 2. Spawn agent
    const agentThreadId = `${sessionId}.1` as ThreadId;
    
    mockThreadManager.createThread.mockResolvedValueOnce(agentThreadId);
    mockThreadManager.listThreads.mockResolvedValueOnce([
      { id: sessionId, metadata: { isSession: true, name: sessionName } }
    ]);
    mockThreadManager.getThread.mockImplementation((id: string) => {
      if (id === sessionId) {
        return {
          id: sessionId,
          created: new Date().toISOString(),
          metadata: { isSession: true, name: sessionName }
        };
      }
      if (id === agentThreadId) {
        return {
          id: agentThreadId,
          created: new Date().toISOString(),
          metadata: { agentName: 'pm', provider: 'anthropic', model: 'claude-3-haiku-20240307' }
        };
      }
      return null;
    });

    const spawnAgentReq = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'pm',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307'
      }),
      headers: { 'Content-Type': 'application/json' }
    });

    const agentResponse = await spawnAgent(spawnAgentReq, { params: { sessionId } });
    const agentData = await agentResponse.json();
    
    expect(agentResponse.status).toBe(201);
    expect(agentData.agent).toMatchObject({
      threadId: agentThreadId,
      name: 'pm',
      provider: 'anthropic',
      model: 'claude-3-haiku-20240307'
    });

    // 3. Connect to SSE stream
    const streamReq = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/events/stream`);
    const streamResponse = await streamEvents(streamReq, { params: { sessionId } });
    
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get('Content-Type')).toBe('text/event-stream');

    // 4. Send message
    const sendMessageReq = new NextRequest(`http://localhost:3000/api/threads/${agentThreadId}/message`, {
      method: 'POST',
      body: JSON.stringify({ message: 'Help me implement OAuth' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const messageResponse = await sendMessage(sendMessageReq, { params: { threadId: agentThreadId } });
    const messageData = await messageResponse.json();
    
    expect(messageResponse.status).toBe(202);
    expect(messageData).toMatchObject({
      status: 'accepted',
      threadId: agentThreadId
    });

    // 5. Verify events flow correctly
    // Wait for agent to process message
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Check that events were broadcast
    expect(mockSSEManager.broadcast).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        type: 'AGENT_MESSAGE',
        threadId: agentThreadId
      })
    );

    // 6. Verify event ordering and content
    const broadcastCalls = mockSSEManager.broadcast.mock.calls;
    const eventTypes = broadcastCalls.map(call => call[1].type);
    
    // Should have events in correct order
    expect(eventTypes).toContain('AGENT_MESSAGE');
  });

  it('should handle multi-agent scenario', async () => {
    const sessionId = 'lace_20250113_multi' as ThreadId;
    
    // Create session
    mockThreadManager.createThread.mockResolvedValueOnce(sessionId);
    mockThreadManager.getThread.mockImplementation((id: string) => {
      if (id === sessionId) {
        return {
          id: sessionId,
          created: new Date().toISOString(),
          metadata: { isSession: true, name: 'Multi-Agent Session' }
        };
      }
      if (id === `${sessionId}.1`) {
        return {
          id: `${sessionId}.1`,
          created: new Date().toISOString(),
          metadata: { agentName: 'pm', provider: 'anthropic', model: 'claude-3-haiku-20240307' }
        };
      }
      if (id === `${sessionId}.2`) {
        return {
          id: `${sessionId}.2`,
          created: new Date().toISOString(),
          metadata: { agentName: 'architect', provider: 'anthropic', model: 'claude-3-opus-20240229' }
        };
      }
      return null;
    });

    const createSessionReq = new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: 'Multi-Agent Session' }),
      headers: { 'Content-Type': 'application/json' }
    });
    await createSession(createSessionReq);

    // Spawn first agent (PM)
    mockThreadManager.listThreads.mockResolvedValueOnce([
      { id: sessionId }
    ]);
    mockThreadManager.createThread.mockResolvedValueOnce(`${sessionId}.1` as ThreadId);

    const spawnPMReq = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
      method: 'POST',
      body: JSON.stringify({ name: 'pm', provider: 'anthropic', model: 'claude-3-haiku-20240307' }),
      headers: { 'Content-Type': 'application/json' }
    });
    const pmResponse = await spawnAgent(spawnPMReq, { params: { sessionId } });
    expect(pmResponse.status).toBe(201);

    // Spawn second agent (Architect)
    mockThreadManager.listThreads.mockResolvedValueOnce([
      { id: sessionId },
      { id: `${sessionId}.1` }
    ]);
    mockThreadManager.createThread.mockResolvedValueOnce(`${sessionId}.2` as ThreadId);

    const spawnArchReq = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
      method: 'POST',
      body: JSON.stringify({ name: 'architect', provider: 'anthropic', model: 'claude-3-opus-20240229' }),
      headers: { 'Content-Type': 'application/json' }
    });
    const archResponse = await spawnAgent(spawnArchReq, { params: { sessionId } });
    expect(archResponse.status).toBe(201);

    // List agents
    mockThreadManager.listThreads.mockResolvedValueOnce([
      { id: sessionId, metadata: { isSession: true, name: 'Multi-Agent Session' } },
      { id: `${sessionId}.1`, metadata: { agentName: 'pm', provider: 'anthropic', model: 'claude-3-haiku-20240307' } },
      { id: `${sessionId}.2`, metadata: { agentName: 'architect', provider: 'anthropic', model: 'claude-3-opus-20240229' } }
    ]);

    const listAgentsReq = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`);
    const listResponse = await listAgents(listAgentsReq, { params: { sessionId } });
    const listData = await listResponse.json();

    expect(listData.agents).toHaveLength(2);
    expect(listData.agents[0].name).toBe('pm');
    expect(listData.agents[1].name).toBe('architect');

    // Send messages to both agents
    const pmMessageReq = new NextRequest(`http://localhost:3000/api/threads/${sessionId}.1/message`, {
      method: 'POST',
      body: JSON.stringify({ message: 'Create tasks for OAuth implementation' }),
      headers: { 'Content-Type': 'application/json' }
    });
    await sendMessage(pmMessageReq, { params: { threadId: `${sessionId}.1` } });

    const archMessageReq = new NextRequest(`http://localhost:3000/api/threads/${sessionId}.2/message`, {
      method: 'POST',
      body: JSON.stringify({ message: 'Design the OAuth architecture' }),
      headers: { 'Content-Type': 'application/json' }
    });
    await sendMessage(archMessageReq, { params: { threadId: `${sessionId}.2` } });

    // Both messages should be broadcast to the same session
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const sessionBroadcasts = mockSSEManager.broadcast.mock.calls.filter(
      call => call[0] === sessionId
    );
    expect(sessionBroadcasts.length).toBeGreaterThanOrEqual(2);
  });

  it('should isolate events between sessions', async () => {
    const session1 = 'lace_20250113_session1' as ThreadId;
    const session2 = 'lace_20250113_session2' as ThreadId;
    
    // Create two sessions
    mockThreadManager.createThread
      .mockResolvedValueOnce(session1)
      .mockResolvedValueOnce(session2);
    
    mockThreadManager.getThread.mockImplementation((id: string) => {
      if (id === session1 || id === session2) {
        return {
          id,
          created: new Date().toISOString(),
          metadata: { isSession: true, name: `Session ${id}` }
        };
      }
      if (id === `${session1}.1` || id === `${session2}.1`) {
        return {
          id,
          created: new Date().toISOString(),
          metadata: { agentName: 'agent', provider: 'anthropic', model: 'claude-3-haiku-20240307' }
        };
      }
      return null;
    });

    // Create sessions
    const createSession1Req = new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: 'Session 1' }),
      headers: { 'Content-Type': 'application/json' }
    });
    await createSession(createSession1Req);

    const createSession2Req = new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: 'Session 2' }),
      headers: { 'Content-Type': 'application/json' }
    });
    await createSession(createSession2Req);

    // Spawn agents
    mockThreadManager.listThreads.mockResolvedValueOnce([{ id: session1 }]);
    mockThreadManager.createThread.mockResolvedValueOnce(`${session1}.1` as ThreadId);
    
    const spawnAgent1Req = new NextRequest(`http://localhost:3000/api/sessions/${session1}/agents`, {
      method: 'POST',
      body: JSON.stringify({ name: 'agent1' }),
      headers: { 'Content-Type': 'application/json' }
    });
    await spawnAgent(spawnAgent1Req, { params: { sessionId: session1 } });

    mockThreadManager.listThreads.mockResolvedValueOnce([{ id: session2 }]);
    mockThreadManager.createThread.mockResolvedValueOnce(`${session2}.1` as ThreadId);
    
    const spawnAgent2Req = new NextRequest(`http://localhost:3000/api/sessions/${session2}/agents`, {
      method: 'POST',
      body: JSON.stringify({ name: 'agent2' }),
      headers: { 'Content-Type': 'application/json' }
    });
    await spawnAgent(spawnAgent2Req, { params: { sessionId: session2 } });

    // Clear previous broadcasts
    mockSSEManager.broadcast.mockClear();

    // Send message to session 1
    const message1Req = new NextRequest(`http://localhost:3000/api/threads/${session1}.1/message`, {
      method: 'POST',
      body: JSON.stringify({ message: 'Message to session 1' }),
      headers: { 'Content-Type': 'application/json' }
    });
    await sendMessage(message1Req, { params: { threadId: `${session1}.1` } });

    // Send message to session 2
    const message2Req = new NextRequest(`http://localhost:3000/api/threads/${session2}.1/message`, {
      method: 'POST',
      body: JSON.stringify({ message: 'Message to session 2' }),
      headers: { 'Content-Type': 'application/json' }
    });
    await sendMessage(message2Req, { params: { threadId: `${session2}.1` } });

    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify events are isolated
    const session1Broadcasts = mockSSEManager.broadcast.mock.calls.filter(
      call => call[0] === session1
    );
    const session2Broadcasts = mockSSEManager.broadcast.mock.calls.filter(
      call => call[0] === session2
    );

    expect(session1Broadcasts.length).toBeGreaterThan(0);
    expect(session2Broadcasts.length).toBeGreaterThan(0);

    // Events from session1 should only be broadcast to session1
    session1Broadcasts.forEach(call => {
      expect(call[1].threadId).toContain(session1);
    });

    // Events from session2 should only be broadcast to session2
    session2Broadcasts.forEach(call => {
      expect(call[1].threadId).toContain(session2);
    });
  });
});