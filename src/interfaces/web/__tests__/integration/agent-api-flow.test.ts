// ABOUTME: Integration tests for web interface Agent + API route flow
// ABOUTME: Tests end-to-end session creation, agent usage, and conversation handling

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/__tests__/utils/test-provider';
import { getAgentFromRequest } from '~/interfaces/web/lib/agent-context';
import { POST as sessionsPost } from '~/interfaces/web/app/api/sessions/route';
import { GET as agentsGet, POST as agentsPost } from '~/interfaces/web/app/api/agents/route';
import { GET as toolsGet } from '~/interfaces/web/app/api/tools/route';

// Note: Using real getAgentFromRequest, not mocking behavior under test

describe('Web Interface Agent Integration', () => {
  let testDir: string;
  let agent: Agent;
  let threadManager: ThreadManager;

  beforeEach(async () => {
    // Create isolated test environment
    testDir = await mkdtemp(join(tmpdir(), 'web-agent-integration-'));

    // Create ThreadManager with test database
    threadManager = new ThreadManager(join(testDir, 'test.db'));

    // Create dependencies
    const provider = new TestProvider();
    const toolExecutor = new ToolExecutor();

    // Generate thread ID through ThreadManager
    const threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    // Initialize Agent
    agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    await agent.start();
  });

  afterEach(async () => {
    // Clean up to prevent memory leaks
    threadManager.close();
    await rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('should create session → create agent → access tools in sequence', async () => {
    // Step 1: Create a session
    const sessionRequest = new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Integration Test Session',
        metadata: { test: 'integration' },
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    (sessionRequest as any).laceAgent = agent; // Attach real agent to request context

    const sessionResponse = await sessionsPost(sessionRequest);
    const sessionData = await sessionResponse.json();

    expect(sessionResponse.status).toBe(201);
    expect(sessionData.id).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
    expect(sessionData.name).toBe('Integration Test Session');

    // Step 2: Create an agent within that session
    const agentRequest = new NextRequest('http://localhost:3000/api/agents', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: sessionData.id,
        name: 'Test Agent',
        provider: 'test-provider',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    (agentRequest as any).laceAgent = agent; // Attach real agent to request context

    const agentResponse = await agentsPost(agentRequest);
    const agentData = await agentResponse.json();

    expect(agentResponse.status).toBe(201);
    expect(agentData.agentId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
    expect(agentData.sessionId).toBe(sessionData.id);
    expect(agentData.name).toBe('Test Agent');

    // Step 3: Access tools through the agent
    const toolsRequest = new NextRequest('http://localhost:3000/api/tools');
    (toolsRequest as any).laceAgent = agent; // Attach real agent to request context

    const toolsResponse = await toolsGet(toolsRequest);
    const toolsData = await toolsResponse.json();

    expect(toolsResponse.status).toBe(200);
    expect(toolsData.tools).toBeDefined();
    expect(Array.isArray(toolsData.tools)).toBe(true);
    expect(toolsData.count).toBe(toolsData.tools.length);
  });

  it('should handle session retrieval with agent context', async () => {
    // Add some events to the current thread to simulate activity
    const currentThreadId = agent.getCurrentThreadId()!;
    threadManager.addEvent(currentThreadId, 'USER_MESSAGE', 'Test message');
    threadManager.addEvent(currentThreadId, 'AGENT_MESSAGE', 'Test response');

    // Retrieve agent info by ID
    const agentRequest = new NextRequest(
      `http://localhost:3000/api/agents?agentId=${currentThreadId}`
    );
    (agentRequest as any).laceAgent = agent; // Attach real agent to request context

    const agentResponse = await agentsGet(agentRequest);
    const agentData = await agentResponse.json();

    expect(agentResponse.status).toBe(200);
    expect(agentData.agentId).toBe(currentThreadId);
    expect(agentData.messageCount).toBeGreaterThan(0);
    expect(agentData.status).toBe('active');
  });

  it('should properly isolate threads between requests', async () => {
    // Create first session
    const session1Request = new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: 'Session 1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    (session1Request as any).laceAgent = agent; // Attach real agent to request context

    const session1Response = await sessionsPost(session1Request);
    const session1Data = await session1Response.json();

    // Create second session
    const session2Request = new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: 'Session 2' }),
      headers: { 'Content-Type': 'application/json' },
    });
    (session2Request as any).laceAgent = agent; // Attach real agent to request context

    const session2Response = await sessionsPost(session2Request);
    const session2Data = await session2Response.json();

    // Verify different thread IDs
    expect(session1Data.id).not.toBe(session2Data.id);
    expect(session1Data.id).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
    expect(session2Data.id).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);

    // Verify both sessions are marked as new
    // (This depends on how resumeOrCreateThread behaves without existing context)
    expect(session1Response.status).toBe(201);
    expect(session2Response.status).toBe(201);
  });

  it('should handle Agent context errors gracefully', async () => {
    // Test with request that has no agent attached (real error scenario)
    const request = new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: 'Error Test' }),
      headers: { 'Content-Type': 'application/json' },
    });
    // Don't attach agent - this will cause real getAgentFromRequest to throw

    const response = await sessionsPost(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe(
      'Agent not available in request context. WebInterface must be running in integrated mode.'
    );
    expect(data.timestamp).toBeDefined();
  });

  it('should preserve Agent state across multiple API calls', async () => {
    // Spy on Agent methods to track state
    const resumeOrCreateThreadSpy = vi.spyOn(agent, 'resumeOrCreateThread');
    const getThreadEventsSpy = vi.spyOn(agent, 'getThreadEvents');

    // First API call - create session
    const sessionReq = new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: 'State Test' }),
      headers: { 'Content-Type': 'application/json' },
    });
    (sessionReq as any).laceAgent = agent;
    await sessionsPost(sessionReq);

    // Second API call - get tools
    const toolsReq = new NextRequest('http://localhost:3000/api/tools');
    (toolsReq as any).laceAgent = agent;
    await toolsGet(toolsReq);

    // Third API call - create agent
    const agentReq = new NextRequest('http://localhost:3000/api/agents', {
      method: 'POST',
      body: JSON.stringify({ name: 'State Agent' }),
      headers: { 'Content-Type': 'application/json' },
    });
    (agentReq as any).laceAgent = agent;
    await agentsPost(agentReq);

    // Verify Agent methods were called multiple times with same instance
    expect(resumeOrCreateThreadSpy).toHaveBeenCalledTimes(2); // sessions + agents
  });

  it('should use proper Lace thread ID format consistently', async () => {
    // Create session
    const sessionReq = new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: 'Thread ID Test' }),
      headers: { 'Content-Type': 'application/json' },
    });
    (sessionReq as any).laceAgent = agent;
    const sessionResponse = await sessionsPost(sessionReq);

    const sessionData = await sessionResponse.json();

    // Create agent
    const agentReq = new NextRequest('http://localhost:3000/api/agents', {
      method: 'POST',
      body: JSON.stringify({ name: 'Thread Agent' }),
      headers: { 'Content-Type': 'application/json' },
    });
    (agentReq as any).laceAgent = agent;
    const agentResponse = await agentsPost(agentReq);

    const agentData = await agentResponse.json();

    // Verify all IDs follow Lace format
    expect(sessionData.id).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
    expect(agentData.agentId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);

    // Verify IDs are different (separate threads)
    expect(sessionData.id).not.toBe(agentData.agentId);
  });
});
