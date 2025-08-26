// ABOUTME: Simple integration test for compaction features
// ABOUTME: Tests token tracking and manual compaction without MSW mocking

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventStreamManager } from '@/lib/event-stream-manager';
import { getSessionService } from '@/lib/server/session-service';
import {
  Project,
  Session,
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';
import { setupWebTest } from '@/test-utils/web-test-setup';
import { parseResponse } from '@/lib/serialization';
import { loader as getAgent } from '@/app/routes/api.agents.$agentId';
import { createLoaderArgs } from '@/test-utils/route-test-helpers';
import type { AgentWithTokenUsage } from '@/types/api';
import type { ThreadId } from '@/types/core';

// Mock server-only module
vi.mock('server-only', () => ({}));

describe('Compaction Integration Test', () => {
  const _tempLaceDir = setupWebTest();
  let projectId: string;
  let sessionId: ThreadId;
  let providerInstanceId: string;
  let streamedEvents: unknown[] = [];
  let originalBroadcast: EventStreamManager['broadcast'] | undefined;

  beforeEach(async () => {
    streamedEvents = [];

    // Setup test providers
    setupTestProviderDefaults();

    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-sonnet-20241022'],
      apiKey: 'test-key',
    });

    // Create project and session
    const project = Project.create(
      'Compaction Test',
      '/test/compaction',
      'Testing compaction features',
      {
        providerInstanceId,
        modelId: 'claude-3-5-sonnet-20241022',
      }
    );
    projectId = project.getId();

    const session = Session.create({
      name: 'Compaction Test Session',
      projectId,
    });
    sessionId = session.getId();

    // Intercept SSE broadcasts to capture events
    const eventManager = EventStreamManager.getInstance();
    originalBroadcast = eventManager.broadcast;
    const mockBroadcast = vi.fn((event) => {
      streamedEvents.push(event);
      if (originalBroadcast) {
        return originalBroadcast.call(eventManager, event);
      }
    });
    eventManager.broadcast = mockBroadcast as typeof eventManager.broadcast;

    // Register session with event manager and setup agent event handlers
    const sessionService = getSessionService();
    EventStreamManager.getInstance().registerSession(session);

    // Get the session agent and set up event handlers
    const sessionAgent = session.getAgent(sessionId);
    if (sessionAgent) {
      await sessionService.setupAgentEventHandlers(sessionAgent);
    }
  });

  afterEach(async () => {
    // Restore original broadcast
    if (originalBroadcast) {
      EventStreamManager.getInstance().broadcast = originalBroadcast;
    }

    // Stop all agents before cleanup
    const session = await Session.getById(sessionId);
    if (session) {
      const agent = session.getAgent(sessionId);
      if (agent) {
        await agent.stop();
      }
      session.destroy();
    }

    // Cleanup
    try {
      await cleanupTestProviderInstances([providerInstanceId]);
    } catch (_e) {
      // Ignore cleanup errors
    }
    cleanupTestProviderDefaults();
    Session.clearRegistry();
  });

  it('should handle manual /compact command and emit events', async () => {
    const session = await Session.getById(sessionId);
    const agent = session!.getAgent(sessionId);

    if (!agent) {
      throw new Error('Failed to get session agent');
    }

    // Send a regular message first to build context
    // Note: This will fail with test provider but create events
    try {
      await agent.sendMessage('Build some context first');
    } catch (_e) {
      // Expected to fail with test provider
    }

    // Clear previous events
    streamedEvents = [];

    // Send /compact command
    await agent.sendMessage('/compact');

    // Wait for compaction to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify compaction events were emitted
    const compactionStartEvents = streamedEvents.filter(
      (e) => (e as { type?: string }).type === 'COMPACTION_START'
    );
    const compactionCompleteEvents = streamedEvents.filter(
      (e) => (e as { type?: string }).type === 'COMPACTION_COMPLETE'
    );

    // We expect both start and complete events to be broadcast
    expect(compactionStartEvents.length).toBeGreaterThan(0);
    expect(compactionCompleteEvents.length).toBeGreaterThan(0);

    // Also verify the events are in the thread
    const events = agent.threadManager.getEvents(sessionId);
    const compactionComplete = events.find(
      (e) => e.type === 'COMPACTION_COMPLETE' && e.data?.success === true
    );
    expect(compactionComplete).toBeDefined();
  });

  it('should include token usage field in agent API responses', async () => {
    const session = await Session.getById(sessionId);
    const agent = session!.getAgent(sessionId);

    if (!agent) {
      throw new Error('Failed to get session agent');
    }

    // Start the agent to initialize token budget manager
    await agent.start();

    // Check token usage via API
    const request = new Request(`http://localhost:3000/api/agents/${sessionId}`);
    const response = await getAgent(createLoaderArgs(request, { agentId: sessionId }));

    expect(response.status).toBe(200);
    const agentData = (await parseResponse(response)) as AgentWithTokenUsage;

    // Verify token usage field is present with expected structure
    expect(agentData.tokenUsage).toBeDefined();
    expect(agentData.tokenUsage).toHaveProperty('totalPromptTokens');
    expect(agentData.tokenUsage).toHaveProperty('totalCompletionTokens');
    expect(agentData.tokenUsage).toHaveProperty('totalTokens');
    expect(agentData.tokenUsage).toHaveProperty('contextLimit');
    expect(agentData.tokenUsage).toHaveProperty('percentUsed');
    expect(agentData.tokenUsage).toHaveProperty('nearLimit');

    // Values should be numbers (even if 0 initially)
    expect(typeof agentData.tokenUsage!.totalPromptTokens).toBe('number');
    expect(typeof agentData.tokenUsage!.totalCompletionTokens).toBe('number');
    expect(typeof agentData.tokenUsage!.totalTokens).toBe('number');
    expect(typeof agentData.tokenUsage!.contextLimit).toBe('number');
    expect(typeof agentData.tokenUsage!.percentUsed).toBe('number');
    expect(typeof agentData.tokenUsage!.nearLimit).toBe('boolean');
  });

  it('should emit compaction events when compaction starts', async () => {
    const session = await Session.getById(sessionId);
    const agent = session!.getAgent(sessionId);

    if (!agent) {
      throw new Error('Failed to get session agent');
    }

    // Ensure session service has the projectId set for this test
    const sessionService = getSessionService();
    (sessionService as { projectId?: string }).projectId = projectId;

    // Simulate a compaction with the right event structure
    agent.emit('compaction_start', { auto: false });

    // Check that compaction start event was emitted
    const compactionStartEvents = streamedEvents.filter(
      (e) => (e as { type?: string }).type === 'COMPACTION_START'
    );

    expect(compactionStartEvents.length).toBe(1);
    expect(compactionStartEvents[0]).toMatchObject({
      type: 'COMPACTION_START',
      threadId: sessionId,
      data: {
        auto: false,
      },
    });

    // Simulate compaction complete
    agent.emit('compaction_complete', { success: true });

    // Check that compaction complete event was emitted
    const compactionCompleteEvents = streamedEvents.filter(
      (e) => (e as { type?: string }).type === 'COMPACTION_COMPLETE'
    );

    expect(compactionCompleteEvents.length).toBe(1);
    expect(compactionCompleteEvents[0]).toMatchObject({
      type: 'COMPACTION_COMPLETE',
      threadId: sessionId,
      data: {
        success: true,
      },
    });
  });
});
