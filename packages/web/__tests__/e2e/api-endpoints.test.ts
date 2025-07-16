// ABOUTME: E2E tests for web API endpoints
// ABOUTME: Tests full API workflow from session creation to message sending

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock the server-side modules
vi.mock('@/lib/sse-manager', () => ({
  SSEManager: {
    getInstance: () => ({
      broadcast: vi.fn(),
      addConnection: vi.fn(),
      removeConnection: vi.fn(),
    }),
  },
}));
vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: () => ({
    requestApproval: vi.fn().mockResolvedValue('allow_once'),
  }),
}));

// Mock the provider registry to avoid API key requirements
vi.mock('~/providers/provider-registry', () => ({
  getProviderRegistry: () => ({
    getProvider: () => ({
      name: 'mock-provider',
      models: ['mock-model'],
      createAgent: vi.fn(),
    }),
  }),
}));

// Mock the Agent class
vi.mock('~/agents/agent', () => ({
  Agent: {
    createSession: vi.fn().mockResolvedValue({
      id: 'mock-agent-id',
      threadId: 'mock-thread-id',
      start: vi.fn(),
      stop: vi.fn(),
      sendMessage: vi.fn(),
    }),
  },
}));

// Mock the Session class with more dynamic behavior
interface MockSession {
  id: string;
  name: string;
  createdAt: Date;
  agents: MockAgent[];
  getId: () => string;
  getInfo: () => {
    id: string;
    name: string;
    createdAt: Date;
    provider: string;
    model: string;
    agents: MockAgent[];
  };
  spawnAgent: (agentName: string) => MockAgent;
  getAgents: () => MockAgent[];
  getAgent: (threadId: string) => MockAgent | null;
  startAgent: ReturnType<typeof vi.fn>;
  stopAgent: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

interface MockAgent {
  threadId: string;
  name: string;
  provider: string;
  model: string;
  status: string;
  providerName: string;
  toolExecutor: {
    setApprovalCallback: ReturnType<typeof vi.fn>;
    getTool: ReturnType<typeof vi.fn>;
  };
  getCurrentState: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  getThreadCreatedAt: ReturnType<typeof vi.fn>;
}

const sessionStore = new Map<string, MockSession>();
let sessionCounter = 0;

vi.mock('~/sessions/session', () => ({
  Session: {
    create: vi.fn().mockImplementation((name: string) => {
      sessionCounter++;
      const sessionId = `lace_20240101_test${sessionCounter}`;
      const session: MockSession = {
        id: sessionId,
        name,
        createdAt: new Date(),
        agents: [],
        getId: () => sessionId,
        getInfo: () => ({
          id: sessionId,
          name,
          createdAt: new Date(),
          provider: 'mock-provider',
          model: 'mock-model',
          agents: session.agents,
        }),
        spawnAgent: vi.fn().mockImplementation((agentName: string) => {
          const agentThreadId = `${sessionId}.${session.agents.length + 1}`;
          const agent: MockAgent = {
            threadId: agentThreadId,
            name: agentName,
            provider: 'mock-provider',
            model: 'mock-model',
            status: 'idle',
            providerName: 'mock-provider',
            toolExecutor: {
              setApprovalCallback: vi.fn(),
              getTool: vi.fn().mockReturnValue({
                description: 'Mock tool',
                annotations: { readOnlyHint: true },
              }),
            },
            getCurrentState: vi.fn().mockReturnValue('idle'),
            start: vi.fn(),
            stop: vi.fn(),
            sendMessage: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            removeAllListeners: vi.fn(),
            getThreadCreatedAt: vi.fn().mockReturnValue(new Date()),
          };
          session.agents.push(agent);
          return agent;
        }),
        getAgents: () => session.agents,
        getAgent: (threadId: string) => session.agents.find((a) => a.threadId === threadId) || null,
        startAgent: vi.fn(),
        stopAgent: vi.fn(),
        sendMessage: vi.fn(),
        destroy: vi.fn(),
      };
      sessionStore.set(sessionId, session);
      return session;
    }),
    getAll: vi
      .fn()
      .mockImplementation(() => Array.from(sessionStore.values()).map((s) => s.getInfo())),
    getById: vi.fn().mockImplementation((id: string) => sessionStore.get(id) || null),
  },
}));

// Mock the ThreadManager
vi.mock('~/threads/thread-manager', () => ({
  ThreadManager: class {
    constructor() {}
    createThreadWithMetadata = vi.fn().mockResolvedValue({ id: 'test-thread' });
    getAllThreadsWithMetadata = vi.fn().mockReturnValue([]);
    getThread = vi.fn().mockReturnValue(null);
  },
}));

// Import API route handlers after mocks
import { POST as createSession, GET as listSessions } from '@/app/api/sessions/route';
import { GET as getSession } from '@/app/api/sessions/[sessionId]/route';
import { POST as spawnAgent } from '@/app/api/sessions/[sessionId]/agents/route';
import { POST as sendMessage } from '@/app/api/threads/[threadId]/message/route';

describe('API Endpoints E2E Tests', () => {
  let testDbPath: string;

  beforeEach(() => {
    // Use in-memory database for testing
    testDbPath = ':memory:';
    process.env.LACE_DB_PATH = testDbPath;

    // Clear session store
    sessionStore.clear();
    sessionCounter = 0;
  });

  afterEach(() => {
    // Clean up
    delete process.env.LACE_DB_PATH;
  });

  describe('Session Management API Flow', () => {
    it('should create session via API', async () => {
      const request = new NextRequest('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'API Test Session',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
      });

      const response = await createSession(request);
      expect(response.status).toBe(201);

      const data = (await response.json()) as { session: { name: string; id: string } };
      expect(data.session.name).toBe('API Test Session');
      expect(data.session.id).toBeDefined();
    });

    it('should list sessions via API', async () => {
      // Create a session first
      const createRequest = new NextRequest('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Listable Session',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
      });
      await createSession(createRequest);

      // List sessions
      const listRequest = new NextRequest('http://localhost/api/sessions', {
        method: 'GET',
      });

      const response = await listSessions(listRequest);
      expect(response.status).toBe(200);

      const data = (await response.json()) as { sessions: Array<{ name: string }> };
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].name).toBe('Listable Session');
    });

    it('should get specific session via API', async () => {
      // Create a session first
      const createRequest = new NextRequest('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Specific Session',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
      });
      const createResponse = await createSession(createRequest);
      const sessionData = (await createResponse.json()) as { session: { id: string } };
      const sessionId = sessionData.session.id;

      // Get specific session
      const getRequest = new NextRequest(`http://localhost/api/sessions/${sessionId}`, {
        method: 'GET',
      });

      const response = await getSession(getRequest, { params: { sessionId } });
      expect(response.status).toBe(200);

      const data = (await response.json()) as { session: { name: string; id: string } };
      expect(data.session.name).toBe('Specific Session');
      expect(data.session.id).toBe(sessionId);
    });
  });

  describe('Agent Management API Flow', () => {
    let sessionId: string;

    beforeEach(async () => {
      // Create a session for agent tests
      const createRequest = new NextRequest('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Agent Test Session',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
      });
      const createResponse = await createSession(createRequest);
      const sessionData = (await createResponse.json()) as { session: { id: string } };
      sessionId = sessionData.session.id;
    });

    it('should spawn agent via API', async () => {
      const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'API Agent',
          provider: 'mock-provider',
          model: 'mock-model',
        }),
      });

      const response = await spawnAgent(request, { params: { sessionId } });
      expect(response.status).toBe(201);

      const data = (await response.json()) as {
        agent: { name: string; provider: string; model: string; threadId: string };
      };
      expect(data.agent.name).toBe('API Agent');
      expect(data.agent.provider).toBe('mock-provider');
      expect(data.agent.model).toBe('mock-model');
      expect(data.agent.threadId).toBe(`lace_20240101_test1.1`);
    });

    it('should reflect spawned agent in session', async () => {
      // Spawn an agent
      const spawnRequest = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Reflected Agent',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
      });
      await spawnAgent(spawnRequest, { params: { sessionId } });

      // Get session to check agents
      const getRequest = new NextRequest(`http://localhost/api/sessions/${sessionId}`, {
        method: 'GET',
      });

      const response = await getSession(getRequest, { params: { sessionId } });
      const data = (await response.json()) as { session: { agents: Array<{ name: string }> } };

      expect(data.session.agents).toHaveLength(1);
      expect(data.session.agents[0].name).toBe('Reflected Agent');
    });
  });

  describe('Message Sending API Flow', () => {
    let sessionId: string;
    let agentThreadId: string;

    beforeEach(async () => {
      // Create session and agent for message tests
      const createRequest = new NextRequest('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Message Test Session',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
      });
      const createResponse = await createSession(createRequest);
      const sessionData = (await createResponse.json()) as { session: { id: string } };
      sessionId = sessionData.session.id;

      const spawnRequest = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Message Agent',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
      });
      const spawnResponse = await spawnAgent(spawnRequest, { params: { sessionId } });
      const agentData = (await spawnResponse.json()) as { agent: { threadId: string } };
      agentThreadId = agentData.agent.threadId;
    });

    it('should accept message via API', async () => {
      const request = new NextRequest(`http://localhost/api/threads/${agentThreadId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello, agent!' }),
      });

      const response = await sendMessage(request, { params: { threadId: agentThreadId } });
      expect(response.status).toBe(202);

      const data = (await response.json()) as { status: string; threadId: string };
      expect(data.status).toBe('accepted');
      expect(data.threadId).toBe(agentThreadId);
    });

    it('should handle invalid thread ID', async () => {
      const request = new NextRequest(`http://localhost/api/threads/invalid-thread-id/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello, agent!' }),
      });

      const response = await sendMessage(request, { params: { threadId: 'invalid-thread-id' } });
      expect(response.status).toBe(400);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid session ID in getSession', async () => {
      const request = new NextRequest('http://localhost/api/sessions/invalid-id', {
        method: 'GET',
      });

      const response = await getSession(request, { params: { sessionId: 'invalid-id' } });
      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON in createSession', async () => {
      const request = new NextRequest('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      const response = await createSession(request);
      expect(response.status).toBe(500); // JSON parsing error is caught by outer try-catch
    });

    it('should handle agent spawning in non-existent session', async () => {
      const request = new NextRequest('http://localhost/api/sessions/non-existent/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Agent',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
      });

      const response = await spawnAgent(request, { params: { sessionId: 'non-existent' } });
      expect(response.status).toBe(404);
    });
  });
});
