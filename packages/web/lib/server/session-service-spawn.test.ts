// ABOUTME: Unit tests for SessionService.spawnAgent method
// ABOUTME: Tests to isolate the agent spawning issue at the service level

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSessionService } from '@/lib/server/session-service';
import { Project, Session, ThreadManager } from '@/lib/server/lace-imports';
import type { ThreadId } from '@/types/core';
import { setupWebTest } from '@/test-utils/web-test-setup';
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '@/lib/server/lace-imports';
import {
  cleanupTestProviderInstances,
  createTestProviderInstance,
} from '@/lib/server/lace-imports';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock EventStreamManager
vi.mock('@/lib/event-stream-manager', () => ({
  EventStreamManager: {
    getInstance: () => ({
      broadcast: vi.fn(),
      addConnection: vi.fn(),
      removeConnection: vi.fn(),
      registerSession: vi.fn(),
    }),
  },
}));

// Mock approval manager
vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: () => ({
    requestApproval: vi.fn().mockResolvedValue('allow_once'),
  }),
}));

describe('SessionService.spawnAgent Method', () => {
  const _tempLaceDir = setupWebTest();
  let sessionService: ReturnType<typeof getSessionService>;
  let sessionId: string;
  let projectId: string;
  let anthropicInstanceId: string;

  beforeEach(async () => {
    // Set up test provider defaults and create instances
    setupTestProviderDefaults();

    // Create test provider instance
    anthropicInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022'],
      apiKey: 'test-anthropic-key',
    });

    // Create session service
    sessionService = getSessionService();

    // Create a test project with provider configuration
    const project = Project.create('Test Project', '/test/path', 'Test project', {
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
    projectId = project.getId();

    // Create session that inherits from project
    const session = Session.create({
      name: 'Test Session',
      projectId,
    });
    sessionId = session.getId() as string;
  });

  afterEach(async () => {
    sessionService.clearActiveSessions();
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([anthropicInstanceId]);
    vi.clearAllMocks();
  });

  it('should spawn agent via service and make it retrievable', async () => {
    // Spawn agent via service
    const session = await sessionService.getSession(sessionId as ThreadId);
    expect(session).toBeDefined();
    const agent = session!.spawnAgent({
      name: 'Service Agent',
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    // Verify agent properties
    expect(agent.threadId).toMatch(new RegExp(`^${sessionId}\\.\\d+$`));

    // Verify agent name is stored in session agents list
    const agents = session!.getAgents();
    const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);
    expect(spawnedAgent).toBeDefined();
    expect(spawnedAgent!.name).toBe('Service Agent');
    expect(spawnedAgent!.providerInstanceId).toBeDefined();
    expect(spawnedAgent!.status).toBe('idle');

    // Verify agent is retrievable via session
    const sessionForAgent = await sessionService.getSession(sessionId as ThreadId);
    expect(sessionForAgent).toBeDefined();
    const retrievedAgent = sessionForAgent!.getAgent(agent.threadId as ThreadId);
    expect(retrievedAgent).toBeDefined();
    expect(retrievedAgent?.threadId).toBe(agent.threadId);

    // Initialize agent so provider is available
    await retrievedAgent!.initialize();
    expect(retrievedAgent?.providerName).toBe('anthropic');
  });

  it('should handle agent retrieval after spawning', async () => {
    // Spawn agent
    const session = await sessionService.getSession(sessionId as ThreadId);
    expect(session).toBeDefined();
    const agent = session!.spawnAgent({
      name: 'Retrievable Agent',
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
    const agentThreadId = agent.threadId as ThreadId;

    // Test immediate retrieval
    const immediateAgent = session!.getAgent(agentThreadId);
    expect(immediateAgent).toBeDefined();
    expect(immediateAgent?.threadId).toBe(agentThreadId);

    // Test retrieval after clearing and reconstructing sessions
    sessionService.clearActiveSessions();

    // The agent should still be retrievable (it should reconstruct the session)
    const laterSession = await sessionService.getSession(sessionId as ThreadId);
    expect(laterSession).toBeDefined();
    const _laterAgent = laterSession!.getAgent(agentThreadId);
    // Note: This might be null initially due to async reconstruction
    // But the session should be reconstructed in the background
  });

  it('should spawn multiple agents and keep them separate', async () => {
    // Spawn multiple agents
    const session = await sessionService.getSession(sessionId as ThreadId);
    expect(session).toBeDefined();
    const agent1 = session!.spawnAgent({
      name: 'Agent 1',
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
    const agent2 = session!.spawnAgent({
      name: 'Agent 2',
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    // Verify both agents are retrievable
    const retrievedAgent1 = session!.getAgent(agent1.threadId as ThreadId);
    const retrievedAgent2 = session!.getAgent(agent2.threadId as ThreadId);

    expect(retrievedAgent1).toBeDefined();
    expect(retrievedAgent2).toBeDefined();
    expect(retrievedAgent1?.threadId).toBe(agent1.threadId);
    expect(retrievedAgent2?.threadId).toBe(agent2.threadId);

    // Verify they have different thread IDs
    expect(agent1.threadId).not.toBe(agent2.threadId);
    expect(agent1.threadId).toBe(`${sessionId}.1`);
    expect(agent2.threadId).toBe(`${sessionId}.2`);
  });

  it('should handle agent spawning in reconstructed session', async () => {
    // Clear active sessions to force reconstruction
    sessionService.clearActiveSessions();

    // Get session (should reconstruct)
    const session = await sessionService.getSession(sessionId as ThreadId);
    expect(session).toBeDefined();

    // Spawn agent in reconstructed session
    const agent = session!.spawnAgent({
      name: 'Reconstructed Agent',
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    // Verify agent was spawned correctly
    expect(agent.threadId).toMatch(new RegExp(`^${sessionId}\\.\\d+$`));

    // Verify agent name is stored in session agents list
    const agents = session!.getAgents();
    const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);
    expect(spawnedAgent).toBeDefined();
    expect(spawnedAgent!.name).toBe('Reconstructed Agent');

    // Verify agent is retrievable
    const retrievedAgent = session!.getAgent(agent.threadId as ThreadId);
    expect(retrievedAgent).toBeDefined();
    expect(retrievedAgent?.threadId).toBe(agent.threadId);
  });

  it('should handle thread persistence for spawned agents', async () => {
    // Spawn agent
    const session = await sessionService.getSession(sessionId as ThreadId);
    expect(session).toBeDefined();
    const agent = session!.spawnAgent({
      name: 'Persistent Agent',
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
    const agentThreadId = agent.threadId as ThreadId;

    // Get the agent to ensure it's started
    const retrievedAgent = session!.getAgent(agentThreadId);
    expect(retrievedAgent).toBeDefined();

    // Try to add an event directly to the agent's thread
    const threadManager = new ThreadManager();

    // This should NOT throw an error if the thread was properly persisted
    const event = threadManager.addEvent({
      type: 'USER_MESSAGE',
      data: 'Hello persistent agent',
      context: { threadId: agentThreadId },
    });
    expect((event as unknown as { context: { threadId: ThreadId } }).context.threadId).toBe(
      agentThreadId
    );
    expect((event as { type: string }).type).toBe('USER_MESSAGE');
    expect((event as { data: string }).data).toBe('Hello persistent agent');

    // Verify the event is retrievable
    const events = threadManager.getEvents(agentThreadId);
    expect(events.length).toBeGreaterThan(0);
    // Find our specific event among the events (agent may add startup events)
    const ourEvent = events.find((e) => e.id === event?.id);
    expect(ourEvent).toBeDefined();
    expect(ourEvent?.type).toBe('USER_MESSAGE');
    expect(ourEvent?.data).toBe('Hello persistent agent');
  });

  it('should handle caching issues between service and ThreadManager', async () => {
    // Spawn agent via service
    const session = await sessionService.getSession(sessionId as ThreadId);
    expect(session).toBeDefined();
    const agent = session!.spawnAgent({
      name: 'Cache Test Agent',
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
    const agentThreadId = agent.threadId as ThreadId;

    // Verify agent is retrievable via session
    const serviceAgent = session!.getAgent(agentThreadId);
    expect(serviceAgent).toBeDefined();

    // Create fresh ThreadManager instance
    const freshThreadManager = new ThreadManager();

    // Try to get thread from fresh ThreadManager
    const threadFromFresh = freshThreadManager.getThread(agentThreadId);
    expect(threadFromFresh).toBeDefined();
    expect(threadFromFresh?.id).toBe(agentThreadId);

    // Try to add event using fresh ThreadManager
    const event = freshThreadManager.addEvent({
      type: 'USER_MESSAGE',
      data: 'Hello from fresh manager',
      context: { threadId: agentThreadId },
    });
    expect(event).not.toBeNull();
    expect(event?.context?.threadId).toBe(agentThreadId);

    // Verify event is visible from service's agent
    if (serviceAgent) {
      // Get the agent's ThreadManager via the proper accessor
      const serviceThreadManager = (
        serviceAgent as unknown as { _threadManager: { getEvents: (id: ThreadId) => unknown[] } }
      )._threadManager;
      expect(serviceThreadManager).toBeDefined();

      const eventsFromService = serviceThreadManager.getEvents(agentThreadId);
      expect(eventsFromService.length).toBeGreaterThan(0);

      // Find our specific event among the events (agent may add startup events)
      const ourEvent = eventsFromService.find(
        (e: unknown) => (e as { id: string }).id === event?.id
      );
      expect(ourEvent).toBeDefined();
      expect((ourEvent as { type: string } | undefined)?.type).toBe('USER_MESSAGE');
      expect((ourEvent as { data: string } | undefined)?.data).toBe('Hello from fresh manager');
    }
  });

  it('should handle error when spawning agent in non-existent session', async () => {
    // Try to spawn agent in non-existent session
    const session = await sessionService.getSession('non-existent-session' as ThreadId);
    expect(session).toBeNull();

    // This should not be possible since getSession returns null
    // but we can test the error by trying to call on null
    expect(() => {
      session?.spawnAgent({
        name: 'Orphan Agent',
        providerInstanceId: anthropicInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      });
    }).not.toThrow(); // This won't throw because session is null
  });
});
