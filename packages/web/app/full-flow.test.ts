// ABOUTME: Integration tests for complete conversation flow through web API
// ABOUTME: Tests session creation, agent spawning, messaging, and event streaming

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Note: ApprovalManager has been removed and replaced with event-based approval system

import { POST as createProjectSession } from '@/app/api/projects/[projectId]/sessions/route';
import { POST as spawnAgent, GET as listAgents } from '@/app/api/sessions/[sessionId]/agents/route';
import { POST as sendMessage } from '@/app/api/threads/[threadId]/message/route';
import { GET as streamEvents } from '@/app/api/events/stream/route';
import type { SessionInfo, ThreadId } from '@/types/core';
import { setupWebTest } from '@/test-utils/web-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '@/lib/server/lace-imports';
import { parseResponse } from '@/lib/serialization';
import { Project, Session } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';

// Use real EventStreamManager for integration testing
import { EventStreamManager } from '@/lib/event-stream-manager';

describe('Full Conversation Flow', () => {
  const _tempLaceDir = setupWebTest();
  let sessionService: ReturnType<typeof getSessionService>;
  let addConnectionSpy: ReturnType<typeof vi.spyOn>;
  let broadcastSpy: ReturnType<typeof vi.spyOn>;
  let anthropicInstanceId: string;
  let openaiInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();
    vi.clearAllMocks();

    // Clear caches to ensure fresh state
    Session.clearProviderCache();

    // Set up spies on real EventStreamManager
    addConnectionSpy = vi.spyOn(EventStreamManager.getInstance(), 'addConnection') as ReturnType<
      typeof vi.spyOn
    >;
    broadcastSpy = vi.spyOn(EventStreamManager.getInstance(), 'broadcast') as ReturnType<
      typeof vi.spyOn
    >;

    // Set up environment
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    // Create test provider instances
    anthropicInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022', 'claude-sonnet-4-20250514'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    openaiInstanceId = await createTestProviderInstance({
      catalogId: 'openai',
      models: ['gpt-4o-mini', 'gpt-4o'],
      displayName: 'Test OpenAI Instance',
      apiKey: 'test-openai-key',
    });

    sessionService = getSessionService();
  });

  afterEach(async () => {
    // Stop all agents first to prevent async operations after database closure
    await sessionService.stopAllAgents();
    sessionService.clearActiveSessions();
    // Clean up spies
    addConnectionSpy?.mockRestore();
    broadcastSpy?.mockRestore();
    // Clean up provider instances
    await cleanupTestProviderInstances([anthropicInstanceId, openaiInstanceId]);
    cleanupTestProviderDefaults();
    // Wait a moment for any pending operations to abort
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it('should complete full session workflow', async () => {
    // 1. Create session through project
    const sessionName = 'Test Conversation';

    // Create a real project for the test
    const project = Project.create(
      'Test Project',
      '/test/path',
      'Test project for integration test',
      {
        providerInstanceId: anthropicInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );
    const projectId = project.getId();

    const createSessionRequest = new NextRequest(
      `http://localhost:3000/api/projects/${projectId}/sessions`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: sessionName,
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const sessionResponse = await createProjectSession(createSessionRequest, {
      params: Promise.resolve({ projectId }),
    });

    if (sessionResponse.status !== 201) {
      const errorData = await parseResponse<{ error: string }>(sessionResponse);
      console.error('Session creation failed:', errorData);
    }

    expect(sessionResponse.status).toBe(201);
    const sessionData = await parseResponse<{ session: SessionInfo }>(sessionResponse);
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
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const agentResponse = await spawnAgent(spawnAgentRequest, {
      params: Promise.resolve({ sessionId: sessionId as string }),
    });
    expect(agentResponse.status).toBe(201);
    const agentData = await parseResponse<{
      agent: { threadId: ThreadId; name: string };
    }>(agentResponse);
    expect(agentData.agent.name).toBe(agentName);
    const agentThreadId: ThreadId = agentData.agent.threadId as ThreadId;

    // 3. Connect to SSE stream
    const streamRequest = new NextRequest(
      `http://localhost:3000/api/events/stream?sessions=${sessionId}`
    );
    const streamResponse = await streamEvents(streamRequest);

    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get('Content-Type')).toBe('text/event-stream');
    expect(addConnectionSpy).toHaveBeenCalledWith(expect.any(Object), expect.any(Object));

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
    const messageData = await parseResponse<{ status: string }>(messageResponse);
    expect(messageData.status).toBe('accepted');

    // 5. Verify EventStreamManager connection was established
    expect(addConnectionSpy).toHaveBeenCalledWith(expect.any(Object), expect.any(Object));
  });

  it('should handle multi-agent scenario', async () => {
    // Create a real project for the test
    const project = Project.create(
      'Multi-Agent Project',
      '/test/path',
      'Test project for multi-agent test',
      {
        providerInstanceId: anthropicInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );
    const projectId = project.getId();
    const createSessionRequest = new NextRequest(
      `http://localhost:3000/api/projects/${projectId}/sessions`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Multi-Agent Session',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const sessionResponse = await createProjectSession(createSessionRequest, {
      params: Promise.resolve({ projectId }),
    });
    expect(sessionResponse.status).toBe(201);
    const sessionData = await parseResponse<{ session: SessionInfo }>(sessionResponse);
    const sessionId: ThreadId = sessionData.session.id as ThreadId;

    // Spawn first agent
    const spawnAgent1Request = new NextRequest(
      `http://localhost:3000/api/sessions/${sessionId}/agents`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'pm',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
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
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-sonnet-4-20250514',
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
    const listData = await parseResponse<{ agents: Array<{ name: string }> }>(listResponse);
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
      {
        providerInstanceId: anthropicInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );
    const project2 = Project.create(
      'Session 2 Project',
      '/test/path2',
      'Test project for session 2',
      {
        providerInstanceId: anthropicInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );
    const projectId1 = project1.getId();
    const projectId2 = project2.getId();

    const session1Response = await createProjectSession(
      new NextRequest(`http://localhost:3000/api/projects/${projectId1}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'Session 1',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ projectId: projectId1 }) }
    );
    const session1Data = await parseResponse<{ session: SessionInfo }>(session1Response);
    const session1Id: ThreadId = session1Data.session.id as ThreadId;

    const session2Response = await createProjectSession(
      new NextRequest(`http://localhost:3000/api/projects/${projectId2}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'Session 2',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ projectId: projectId2 }) }
    );
    const session2Data = await parseResponse<{ session: SessionInfo }>(session2Response);
    const session2Id: ThreadId = session2Data.session.id as ThreadId;

    // Connect to streams
    await streamEvents(
      new NextRequest(`http://localhost:3000/api/events/stream?sessions=${session1Id}`)
    );

    await streamEvents(
      new NextRequest(`http://localhost:3000/api/events/stream?sessions=${session2Id}`)
    );

    // Verify each session has its own connection
    expect(addConnectionSpy).toHaveBeenCalledWith(expect.any(Object), expect.any(Object));
    expect(addConnectionSpy).toHaveBeenCalledTimes(2);
  });
});
