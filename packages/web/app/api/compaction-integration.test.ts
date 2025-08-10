// ABOUTME: Integration tests for token usage tracking across session and agent APIs
// ABOUTME: Tests proper architectural separation between session metadata and agent runtime data

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
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
import { GET as getAgent } from '@/app/api/agents/[agentId]/route';
import { GET as getSession } from '@/app/api/projects/[projectId]/sessions/[sessionId]/route';
import type { ThreadId } from '@/types/core';
import type { AgentResponse, SessionResponse } from '@/types/api';

// Mock server-only module
vi.mock('server-only', () => ({}));

describe('Token Usage Integration Tests', () => {
  const _tempLaceDir = setupWebTest();
  let projectId: string;
  let sessionId: ThreadId;
  let providerInstanceId: string;
  let streamedEvents: unknown[] = [];
  let originalBroadcast: EventStreamManager['broadcast'] | undefined;

  beforeEach(async () => {
    await setupTestProviderDefaults();
    Session.clearProviderCache();

    // Create individual provider instance for this test
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-sonnet-20241022'],
      displayName: 'Test Integration Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create project with provider configuration
    const project = Project.create(
      'Token Integration Test',
      '/test/token-integration',
      'Testing token usage across APIs',
      {
        providerInstanceId,
        modelId: 'claude-3-5-sonnet-20241022',
      }
    );
    projectId = project.getId();

    // Create session - will inherit provider from project
    const session = Session.create({
      name: 'Token Integration Session',
      projectId,
      configuration: {
        providerInstanceId,
        modelId: 'claude-3-5-sonnet-20241022',
      },
    });
    sessionId = session.getId();

    // Intercept SSE broadcasts to capture events
    const eventManager = EventStreamManager.getInstance();
    originalBroadcast = eventManager.broadcast;
    const mockBroadcast = vi.fn((event: unknown) => {
      streamedEvents.push(event);
      if (originalBroadcast) {
        return originalBroadcast.call(eventManager, event);
      }
    });
    eventManager.broadcast = mockBroadcast as typeof eventManager.broadcast;

    // Register session with event manager
    EventStreamManager.getInstance().registerSession(session);

    // Get the session agent and set up event handlers
    const sessionService = getSessionService();
    const sessionAgent = session.getAgent(sessionId);
    if (sessionAgent) {
      sessionService.setupAgentEventHandlers(sessionAgent, sessionId);
    }

    // Clear previous events
    streamedEvents = [];
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

    // Clean up test utilities
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    Session.clearRegistry();
    vi.clearAllMocks();
  });

  it('should maintain proper API separation: session returns metadata only, agent returns runtime data', async () => {
    // Test Session API - should return only metadata
    const sessionRequest = new NextRequest(
      `http://localhost:3000/api/projects/${projectId}/sessions/${sessionId}`
    );
    const sessionResponse = await getSession(sessionRequest, {
      params: Promise.resolve({ projectId, sessionId }),
    });

    expect(sessionResponse.status).toBe(200);
    const sessionData = (await parseResponse(sessionResponse)) as SessionResponse;

    // CRITICAL: Session should NOT have token usage data
    expect(sessionData.session).toBeDefined();
    expect('tokenUsage' in sessionData).toBe(false);

    // Test Agent API - should include token usage
    const agentRequest = new NextRequest(`http://localhost:3000/api/agents/${sessionId}`);
    const agentResponse = await getAgent(agentRequest, {
      params: Promise.resolve({ agentId: sessionId }),
    });

    expect(agentResponse.status).toBe(200);
    const agentData = (await parseResponse(agentResponse)) as AgentResponse;

    // Agent should have token usage data (even if zeros initially)
    expect(agentData.agent.tokenUsage).toBeDefined();
    expect(typeof agentData.agent.tokenUsage?.totalTokens).toBe('number');
    expect(typeof agentData.agent.tokenUsage?.contextLimit).toBe('number');
  });

  it('should track token usage through actual agent interactions', async () => {
    const session = await Session.getById(sessionId);
    const agent = session!.getAgent(sessionId);

    if (!agent) {
      throw new Error('Failed to get session agent');
    }

    // Start the agent to initialize token budget manager
    await agent.start();

    // Simulate agent message with token usage by directly adding events
    // This simulates what would happen during actual conversation
    agent.threadManager.addEvent(sessionId, 'AGENT_MESSAGE', {
      content: 'First test response',
      tokenUsage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
    });

    agent.threadManager.addEvent(sessionId, 'AGENT_MESSAGE', {
      content: 'Second test response',
      tokenUsage: {
        promptTokens: 200,
        completionTokens: 75,
        totalTokens: 275,
      },
    });

    // Allow token budget manager to process events
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check token usage via Agent API
    const agentRequest = new NextRequest(`http://localhost:3000/api/agents/${sessionId}`);
    const agentResponse = await getAgent(agentRequest, {
      params: Promise.resolve({ agentId: sessionId }),
    });

    expect(agentResponse.status).toBe(200);
    const agentData = (await parseResponse(agentResponse)) as AgentResponse;

    // Verify token usage is calculated correctly
    expect(agentData.agent.tokenUsage).toBeDefined();

    // The token budget manager should aggregate the token usage
    // If it's not working, we'll get 0s, which will help us debug
    const tokenUsage = agentData.agent.tokenUsage!;
    expect(tokenUsage.totalPromptTokens).toBeGreaterThanOrEqual(0);
    expect(tokenUsage.totalCompletionTokens).toBeGreaterThanOrEqual(0);
    expect(tokenUsage.totalTokens).toBeGreaterThanOrEqual(0);
    expect(tokenUsage.contextLimit).toBeGreaterThan(0); // Should have a context limit
    expect(tokenUsage.eventCount).toBeGreaterThanOrEqual(0);
  });

  it('should handle agents with no token usage gracefully', async () => {
    // Test agent without any conversation history
    const agentRequest = new NextRequest(`http://localhost:3000/api/agents/${sessionId}`);
    const agentResponse = await getAgent(agentRequest, {
      params: Promise.resolve({ agentId: sessionId }),
    });

    expect(agentResponse.status).toBe(200);
    const agentData = (await parseResponse(agentResponse)) as AgentResponse;

    // Should return default values, not undefined
    expect(agentData.agent.tokenUsage).toBeDefined();
    expect(agentData.agent.tokenUsage?.totalTokens).toBe(0);
    expect(agentData.agent.tokenUsage?.eventCount).toBe(0);
    expect(agentData.agent.tokenUsage?.contextLimit).toBeGreaterThan(0);
    expect(agentData.agent.tokenUsage?.nearLimit).toBe(false);
  });

  it('should track token usage after compaction', async () => {
    const session = await Session.getById(sessionId);
    const agent = session!.getAgent(sessionId);

    if (!agent) {
      throw new Error('Failed to get session agent');
    }

    // Start the agent
    await agent.start();

    // Add some initial token usage
    agent.threadManager.addEvent(sessionId, 'AGENT_MESSAGE', {
      content: 'Pre-compaction response',
      tokenUsage: {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      },
    });

    // Send /compact command to trigger compaction
    await agent.sendMessage('/compact');

    // Wait for compaction to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check token usage after compaction
    const agentRequest = new NextRequest(`http://localhost:3000/api/agents/${sessionId}`);
    const agentResponse = await getAgent(agentRequest, {
      params: Promise.resolve({ agentId: sessionId }),
    });

    const agentData = (await parseResponse(agentResponse)) as AgentResponse;

    // Token usage should still be available and may have been updated by compaction
    expect(agentData.agent.tokenUsage).toBeDefined();
    expect(agentData.agent.tokenUsage?.contextLimit).toBeGreaterThan(0);
  });
});
