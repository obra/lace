// ABOUTME: Integration tests for complete conversation flow through web API
// ABOUTME: Tests session creation, agent spawning, messaging, and event streaming

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock approval manager
vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: () => ({
    requestApproval: vi.fn().mockResolvedValue('allow_once'),
  }),
}));

import { POST as createProjectSession } from '@/app/api/projects/[projectId]/sessions/route';
import { POST as spawnAgent, GET as listAgents } from '@/app/api/sessions/[sessionId]/agents/route';
import { POST as sendMessage } from '@/app/api/threads/[threadId]/message/route';
import { GET as streamEvents } from '@/app/api/sessions/[sessionId]/events/stream/route';
import type { ThreadId, Session } from '@/types/api';
import { setupTestPersistence, teardownTestPersistence } from '~/test-setup-dir/persistence-helper';
import { Project } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';

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
  let sessionService: ReturnType<typeof getSessionService>;

  beforeEach(() => {
    setupTestPersistence();
    vi.clearAllMocks();
    mockSSEManager.sessionStreams.clear();

    // Set up environment
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    sessionService = getSessionService();
  });

  afterEach(() => {
    sessionService.clearActiveSessions();
    teardownTestPersistence();
  });

  it('should complete full session workflow', async () => {
    // 1. Create session through project
    const sessionName = 'Test Conversation';

    // Create a real project for the test
    const project = Project.create(
      'Test Project',
      '/test/path',
      'Test project for integration test',
      {}
    );
    const projectId = project.getId();

    const createSessionRequest = new NextRequest(
      `http://localhost:3000/api/projects/${projectId}/sessions`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: sessionName,
          configuration: {
            provider: 'anthropic',
            model: 'claude-3-haiku-20240307',
          },
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const sessionResponse = await createProjectSession(createSessionRequest, {
      params: Promise.resolve({ projectId }),
    });

    if (sessionResponse.status !== 201) {
      const errorData = (await sessionResponse.json()) as { error: string };
      console.error('Session creation failed:', errorData);
    }

    expect(sessionResponse.status).toBe(201);
    const sessionData = (await sessionResponse.json()) as { session: Session };
    expect(sessionData.session.name).toBe(sessionName);
    const sessionId: ThreadId = sessionData.session.id as ThreadId;

    // 2. Spawn agent
    const agentName = 'assistant';

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
      params: Promise.resolve({ sessionId: sessionId as string }),
    });
    expect(agentResponse.status).toBe(201);
    const agentData = (await agentResponse.json()) as {
      agent: { threadId: ThreadId; name: string };
    };
    expect(agentData.agent.name).toBe(agentName);
    const agentThreadId: ThreadId = agentData.agent.threadId as ThreadId;

    // 3. Connect to SSE stream
    const streamRequest = new NextRequest(
      `http://localhost:3000/api/sessions/${sessionId}/events/stream`
    );
    const streamResponse = await streamEvents(streamRequest, {
      params: Promise.resolve({ sessionId: sessionId as string }),
    });

    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get('Content-Type')).toBe('text/event-stream');
    expect(mockSSEManager.addConnection).toHaveBeenCalledWith(sessionId, expect.any(Object));

    // 4. Send message
    const message = 'Hello, assistant!';

    const messageRequest = new NextRequest(
      `http://localhost:3000/api/threads/${agentThreadId}/message`,
      {
        method: 'POST',
        body: JSON.stringify({ message }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const messageResponse = await sendMessage(messageRequest, {
      params: Promise.resolve({ threadId: agentThreadId as string }),
    });
    expect(messageResponse.status).toBe(202);
    const messageData = (await messageResponse.json()) as { status: string };
    expect(messageData.status).toBe('accepted');

    // 5. Verify SSE connection was established
    expect(mockSSEManager.addConnection).toHaveBeenCalledWith(sessionId, expect.any(Object));
  });

  it('should handle multi-agent scenario', async () => {
    // Create a real project for the test
    const project = Project.create(
      'Multi-Agent Project',
      '/test/path',
      'Test project for multi-agent test',
      {}
    );
    const projectId = project.getId();
    const createSessionRequest = new NextRequest(
      `http://localhost:3000/api/projects/${projectId}/sessions`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Multi-Agent Session',
          configuration: {
            provider: 'anthropic',
            model: 'claude-3-haiku-20240307',
          },
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const sessionResponse = await createProjectSession(createSessionRequest, {
      params: Promise.resolve({ projectId }),
    });
    expect(sessionResponse.status).toBe(201);
    const sessionData = (await sessionResponse.json()) as { session: Session };
    const sessionId: ThreadId = sessionData.session.id as ThreadId;

    // Spawn first agent
    const spawnAgent1Request = new NextRequest(
      `http://localhost:3000/api/sessions/${sessionId}/agents`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'pm',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const agent1Response = await spawnAgent(spawnAgent1Request, {
      params: Promise.resolve({ sessionId: sessionId as string }),
    });
    expect(agent1Response.status).toBe(201);

    // Spawn second agent
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
    const agent2Response = await spawnAgent(spawnAgent2Request, {
      params: Promise.resolve({ sessionId: sessionId as string }),
    });
    expect(agent2Response.status).toBe(201);

    // List agents
    const listAgentsRequest = new NextRequest(
      `http://localhost:3000/api/sessions/${sessionId}/agents`
    );
    const listResponse = await listAgents(listAgentsRequest, {
      params: Promise.resolve({ sessionId: sessionId as string }),
    });
    expect(listResponse.status).toBe(200);
    const listData = (await listResponse.json()) as { agents: Array<{ name: string }> };
    const { agents } = listData;

    expect(agents).toHaveLength(3); // Coordinator + 2 spawned agents
    expect(agents.find((a) => a.name === 'pm')).toBeDefined();
    expect(agents.find((a) => a.name === 'architect')).toBeDefined();
  });

  it('should isolate events between sessions', async () => {
    // Create real projects for the test
    const project1 = Project.create(
      'Session 1 Project',
      '/test/path1',
      'Test project for session 1',
      {}
    );
    const project2 = Project.create(
      'Session 2 Project',
      '/test/path2',
      'Test project for session 2',
      {}
    );
    const projectId1 = project1.getId();
    const projectId2 = project2.getId();

    const session1Response = await createProjectSession(
      new NextRequest(`http://localhost:3000/api/projects/${projectId1}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'Session 1',
          configuration: {
            provider: 'anthropic',
            model: 'claude-3-haiku-20240307',
          },
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ projectId: projectId1 }) }
    );
    const session1Data = (await session1Response.json()) as { session: Session };
    const session1Id: ThreadId = session1Data.session.id as ThreadId;

    const session2Response = await createProjectSession(
      new NextRequest(`http://localhost:3000/api/projects/${projectId2}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'Session 2',
          configuration: {
            provider: 'anthropic',
            model: 'claude-3-haiku-20240307',
          },
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ projectId: projectId2 }) }
    );
    const session2Data = (await session2Response.json()) as { session: Session };
    const session2Id: ThreadId = session2Data.session.id as ThreadId;

    // Connect to streams
    await streamEvents(
      new NextRequest(`http://localhost:3000/api/sessions/${session1Id}/events/stream`),
      { params: Promise.resolve({ sessionId: session1Id as string }) }
    );

    await streamEvents(
      new NextRequest(`http://localhost:3000/api/sessions/${session2Id}/events/stream`),
      { params: Promise.resolve({ sessionId: session2Id as string }) }
    );

    // Verify each session has its own connection
    expect(mockSSEManager.addConnection).toHaveBeenCalledWith(session1Id, expect.any(Object));
    expect(mockSSEManager.addConnection).toHaveBeenCalledWith(session2Id, expect.any(Object));
    expect(mockSSEManager.addConnection).toHaveBeenCalledTimes(2);
  });
});
