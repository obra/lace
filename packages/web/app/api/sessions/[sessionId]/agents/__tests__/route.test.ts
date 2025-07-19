// ABOUTME: Tests for agent spawning API endpoints (POST/GET /api/sessions/{sessionId}/agents)
// ABOUTME: Agents are child threads within a session, identified by threadId like sessionId.N

import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '@/app/api/sessions/[sessionId]/agents/route';
import type { ThreadId, Agent } from '@/types/api';
// Import SessionService type is not needed since we define our own mock interface
import type { Session as CoreSession } from '@/lib/server/core-types';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

// Response types
interface AgentResponse {
  agent: Agent;
}

interface AgentsListResponse {
  agents: Agent[];
}

interface ErrorResponse {
  error: string;
}

// Helper functions to create typed objects without unsafe assignments
function createAgent(props: {
  threadId: ThreadId;
  name?: string;
  provider?: string;
  model?: string;
  status?: Agent['status'];
  createdAt?: string;
}): Agent {
  // Use explicit property assignment to avoid unsafe assignment errors
  const threadId: ThreadId = props.threadId;
  const name: string = props.name ?? 'default';
  const provider: string = props.provider ?? 'anthropic';
  const model: string = props.model ?? 'claude-3-haiku';
  const status: Agent['status'] = props.status ?? 'idle';
  const createdAt: string = props.createdAt ?? new Date().toISOString();

  const agent: Agent = {
    threadId,
    name,
    provider,
    model,
    status,
    createdAt,
  };
  return agent;
}

// Helper to create a mock Session instance with required methods
type MockSessionInfo = {
  id: ThreadId;
  name: string;
  createdAt: Date;
  provider: string;
  model: string;
  agents: Agent[];
};

type MockSession = {
  getId: () => ThreadId;
  getInfo: () => MockSessionInfo;
  getAgents: () => Agent[];
  getAgent: MockedFunction<(threadId: ThreadId) => Agent | undefined>;
  getTaskManager: MockedFunction<() => unknown>;
  spawnAgent: MockedFunction<(name: string, provider?: string, model?: string) => Promise<Agent>>;
  startAgent: MockedFunction<(threadId: ThreadId) => Promise<void>>;
  stopAgent: MockedFunction<(threadId: ThreadId) => Promise<void>>;
  sendMessage: MockedFunction<(threadId: ThreadId, message: string) => Promise<unknown>>;
  destroy: MockedFunction<() => void>;
};

function createMockSession(props: {
  id: ThreadId;
  name?: string;
  agents?: Agent[];
  createdAt?: Date | string;
}): MockSession {
  const agents = props.agents || [];
  const createdAt = props.createdAt
    ? typeof props.createdAt === 'string'
      ? new Date(props.createdAt)
      : props.createdAt
    : new Date();

  const mockSession: MockSession = {
    getId: () => props.id,
    getInfo: () => ({
      id: props.id,
      name: props.name || 'Test Session',
      createdAt,
      provider: 'anthropic',
      model: 'claude-3-haiku',
      agents,
    }),
    getAgents: () => agents,
    getAgent: vi.fn(),
    getTaskManager: vi.fn(),
    spawnAgent: vi.fn().mockImplementation((name: string, provider?: string, model?: string) => {
      const newAgent: Agent = {
        threadId: createThreadId(`${props.id}.${agents.length + 1}`),
        name,
        provider: provider || 'anthropic',
        model: model || 'claude-3-haiku-20240307',
        status: 'idle',
        createdAt: new Date().toISOString(),
      };
      return newAgent;
    }),
    startAgent: vi.fn(),
    stopAgent: vi.fn(),
    sendMessage: vi.fn(),
    destroy: vi.fn(),
  };

  return mockSession;
}

// Type-safe response parsing
function parseResponse<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

// Type-safe ThreadId creation
function createThreadId(value: string): ThreadId {
  // This is a controlled assertion for test purposes only
  // In production, ThreadId validation would be more strict
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invalid ThreadId value');
  }
  return value as ThreadId;
}

// Mock SessionService type based on actual implementation
interface MockSessionService {
  createSession: MockedFunction<
    (name: string, provider: string, model: string, projectId: string) => Promise<unknown>
  >;
  listSessions: MockedFunction<() => Promise<unknown[]>>;
  getSession: MockedFunction<(sessionId: ThreadId) => Promise<CoreSession | null>>;
  updateSession: MockedFunction<(sessionId: ThreadId, updates: Record<string, unknown>) => void>;
  clearActiveSessions: MockedFunction<() => void>;
  spawnAgent: MockedFunction<(name: string, provider?: string, model?: string) => Promise<Agent>>;
}

// Create the mock service outside so we can access it
const mockSessionService: MockSessionService = {
  createSession: vi.fn(),
  listSessions: vi.fn(),
  getSession: vi.fn(),
  updateSession: vi.fn(),
  clearActiveSessions: vi.fn(),
  spawnAgent: vi.fn(),
};

// Mock the session service
vi.mock('@/lib/server/session-service', () => ({
  getSessionService: () => mockSessionService,
}));

// Mock the agent utilities
vi.mock('@/lib/server/agent-utils', () => ({
  setupAgentApprovals: vi.fn(),
}));

describe('Agent Spawning API', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  describe('TDD: Direct Session Usage', () => {
    it('should spawn agent using session.spawnAgent() directly', async () => {
      const sessionId: ThreadId = createThreadId('lace_20250113_session1');
      const mockAgent: Agent = createAgent({
        threadId: createThreadId(`${sessionId}.1`),
        name: 'test-agent',
      });

      type BasicMockSession = {
        spawnAgent: ReturnType<typeof vi.fn>;
        getAgents: ReturnType<typeof vi.fn>;
      };

      const mockSession: BasicMockSession = {
        spawnAgent: vi.fn().mockReturnValue(mockAgent),
        getAgents: vi.fn().mockReturnValue([]),
      };

      mockSessionService.getSession.mockResolvedValueOnce(mockSession as unknown as CoreSession);

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({ name: 'test-agent' }),
        headers: { 'Content-Type': 'application/json' },
      });

      await POST(request, { params: Promise.resolve({ sessionId }) });

      expect(mockSession.spawnAgent).toHaveBeenCalledWith('test-agent', undefined, undefined);
    });
  });

  beforeEach(() => {
    setupTestPersistence();
    vi.clearAllMocks();
    vi.resetAllMocks();

    // Mock console methods to prevent stderr pollution during tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    teardownTestPersistence();
  });

  describe('POST /api/sessions/{sessionId}/agents', () => {
    const sessionId: ThreadId = createThreadId('lace_20250113_session1');

    it('should create agent with threadId like {sessionId}.{n}', async () => {
      // Mock session exists with existing agents
      const existingAgents: Agent[] = [
        createAgent({
          threadId: createThreadId(`${sessionId}.1`),
          name: 'agent1',
          provider: 'anthropic',
          model: 'claude-3-haiku',
          status: 'idle',
          createdAt: new Date().toISOString(),
        }),
        createAgent({
          threadId: createThreadId(`${sessionId}.2`),
          name: 'agent2',
          provider: 'anthropic',
          model: 'claude-3-haiku',
          status: 'idle',
          createdAt: new Date().toISOString(),
        }),
      ];

      const mockSession = createMockSession({
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: existingAgents,
      });

      mockSessionService.getSession.mockResolvedValueOnce(mockSession as unknown as CoreSession);

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'architect',
          provider: 'anthropic',
          model: 'claude-3-opus-20240229',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId }) });
      const data = await parseResponse<AgentResponse>(response);

      expect(response.status).toBe(201);
      expect(data.agent).toMatchObject({
        threadId: `${sessionId}.3`,
        name: 'architect',
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
        status: 'idle',
      });
      expect(mockSession.spawnAgent).toHaveBeenCalledWith(
        'architect',
        'anthropic',
        'claude-3-opus-20240229'
      );
    });

    it('should support provider/model specification', async () => {
      const newAgent: Agent = createAgent({
        threadId: createThreadId(`${sessionId}.1`),
        name: 'reviewer',
        provider: 'openai',
        model: 'gpt-4',
        status: 'idle',
        createdAt: new Date().toISOString(),
      });

      const mockSession = createMockSession({
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: [],
      });

      // Mock the spawnAgent method to return the new agent
      mockSession.spawnAgent.mockReturnValue(newAgent);

      mockSessionService.getSession.mockResolvedValueOnce(mockSession as unknown as CoreSession);

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'reviewer',
          provider: 'openai',
          model: 'gpt-4',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId }) });
      const data = await parseResponse<AgentResponse>(response);

      expect(response.status).toBe(201);
      expect(data.agent.provider).toBe('openai');
      expect(data.agent.model).toBe('gpt-4');
    });

    it('should return agent threadId and metadata', async () => {
      const threadId: ThreadId = createThreadId(`${sessionId}.1`);
      const newAgent: Agent = createAgent({
        threadId,
        name: 'pm',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        status: 'idle',
        createdAt: new Date().toISOString(),
      });

      const mockSession = createMockSession({
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: [],
      });

      mockSession.spawnAgent.mockReturnValue(newAgent);
      mockSessionService.getSession.mockResolvedValueOnce(mockSession as unknown as CoreSession);

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({ name: 'pm' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId }) });
      const data = await parseResponse<AgentResponse>(response);

      expect(data.agent).toMatchObject({
        threadId,
        name: 'pm',
        status: 'idle',
      });
      expect(data.agent.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should increment agent numbers sequentially', async () => {
      // First call - no existing agents
      mockSessionService.getSession.mockResolvedValueOnce(
        createMockSession({
          id: sessionId,
          name: 'Test Session',
          createdAt: new Date().toISOString(),
          agents: [],
        }) as unknown as CoreSession
      );
      const firstAgent: Agent = createAgent({
        threadId: createThreadId(`${sessionId}.1`),
        name: 'agent1',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        status: 'idle',
        createdAt: new Date().toISOString(),
      });

      const request1 = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({ name: 'agent1' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response1 = await POST(request1, { params: Promise.resolve({ sessionId }) });
      const data1 = await parseResponse<AgentResponse>(response1);
      expect(data1.agent.threadId).toBe(`${sessionId}.1`);

      // Second call - one existing agent
      const secondAgent: Agent = createAgent({
        threadId: createThreadId(`${sessionId}.2`),
        name: 'agent2',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        status: 'idle',
        createdAt: new Date().toISOString(),
      });

      const secondMockSession = createMockSession({
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: [firstAgent],
      });

      secondMockSession.spawnAgent.mockReturnValue(secondAgent);
      mockSessionService.getSession.mockResolvedValueOnce(
        secondMockSession as unknown as CoreSession
      );

      const request2 = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({ name: 'agent2' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response2 = await POST(request2, { params: Promise.resolve({ sessionId }) });
      const data2 = await parseResponse<AgentResponse>(response2);
      expect(data2.agent.threadId).toBe(`${sessionId}.2`);
    });

    it('should return 404 for invalid sessionId', async () => {
      mockSessionService.getSession.mockResolvedValue(null);

      const request = new NextRequest(`http://localhost:3000/api/sessions/invalid/agents`, {
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId: 'invalid' }) });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should validate required agent name', async () => {
      mockSessionService.getSession.mockResolvedValueOnce(
        createMockSession({
          id: sessionId,
          name: 'Test Session',
          createdAt: new Date().toISOString(),
          agents: [],
        }) as unknown as CoreSession
      );

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId }) });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request body');
    });

    it('should validate agent name is not empty', async () => {
      const sessionId: ThreadId = createThreadId('lace_20250113_session1');

      mockSessionService.getSession.mockResolvedValueOnce(
        createMockSession({
          id: sessionId,
          name: 'Test Session',
          agents: [],
        }) as unknown as CoreSession
      );

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify({ name: '' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId }) });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Agent name is required');
    });
  });

  describe('GET /api/sessions/{sessionId}/agents', () => {
    const sessionId: ThreadId = createThreadId('lace_20250113_session1');

    it('should list all agents in session', async () => {
      const agents: Agent[] = [
        createAgent({
          threadId: createThreadId(`${sessionId}.1`),
          name: 'pm',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
          status: 'idle',
          createdAt: new Date().toISOString(),
        }),
        createAgent({
          threadId: createThreadId(`${sessionId}.2`),
          name: 'architect',
          provider: 'anthropic',
          model: 'claude-3-opus-20240229',
          status: 'idle',
          createdAt: new Date().toISOString(),
        }),
      ];

      mockSessionService.getSession.mockResolvedValueOnce(
        createMockSession({
          id: sessionId,
          name: 'Test Session',
          createdAt: new Date().toISOString(),
          agents,
        }) as unknown as CoreSession
      );

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`);
      const response = await GET(request, { params: Promise.resolve({ sessionId }) });
      const data = await parseResponse<AgentsListResponse>(response);

      expect(response.status).toBe(200);
      expect(data.agents).toHaveLength(2);
      expect(data.agents[0]).toMatchObject({
        threadId: `${sessionId}.1`,
        name: 'pm',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
      });
      expect(data.agents[1]).toMatchObject({
        threadId: `${sessionId}.2`,
        name: 'architect',
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
      });
    });

    it('should include agent threadIds and metadata', async () => {
      const testAgent: Agent = createAgent({
        threadId: createThreadId(`${sessionId}.1`),
        name: 'pm',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        status: 'thinking',
        createdAt: '2025-01-13T10:00:00Z',
      });

      mockSessionService.getSession.mockResolvedValueOnce(
        createMockSession({
          id: sessionId,
          name: 'Test Session',
          createdAt: new Date().toISOString(),
          agents: [testAgent],
        }) as unknown as CoreSession
      );

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`);
      const response = await GET(request, { params: Promise.resolve({ sessionId }) });
      const data = await parseResponse<AgentsListResponse>(response);

      expect(data.agents[0]).toMatchObject({
        threadId: createThreadId(`${sessionId}.1`),
        name: 'pm',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        status: 'thinking',
        createdAt: '2025-01-13T10:00:00Z',
      });
    });

    it('should return empty array for session with no agents', async () => {
      mockSessionService.getSession.mockResolvedValueOnce(
        createMockSession({
          id: sessionId,
          name: 'Test Session',
          createdAt: new Date().toISOString(),
          agents: [],
        }) as unknown as CoreSession
      );

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/agents`);
      const response = await GET(request, { params: Promise.resolve({ sessionId }) });
      const data = await parseResponse<AgentsListResponse>(response);

      expect(response.status).toBe(200);
      expect(data.agents).toEqual([]);
    });

    it('should return 404 for non-existent session', async () => {
      mockSessionService.getSession.mockResolvedValueOnce(null);

      const request = new NextRequest(`http://localhost:3000/api/sessions/invalid/agents`);
      const response = await GET(request, { params: Promise.resolve({ sessionId: 'invalid' }) });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });
  });
});
