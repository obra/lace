// ABOUTME: E2E test for compaction feature with MSW-mocked AI provider
// ABOUTME: Tests full compaction flow including token tracking, auto-trigger, and SSE events

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
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
import { GET as getSession } from '@/app/api/projects/[projectId]/sessions/[sessionId]/route';
import type { ThreadId } from '@/types/core';

// Mock server-only module
vi.mock('server-only', () => ({}));

// MSW server for mocking AI provider APIs
const server = setupServer();

describe('Compaction E2E Test with MSW', () => {
  const _tempLaceDir = setupWebTest();
  let projectId: string;
  let sessionId: ThreadId;
  let agentId: ThreadId;
  let providerInstanceId: string;
  let streamedEvents: any[] = [];
  let originalBroadcast: any;

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'bypass' });
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(async () => {
    // Reset MSW handlers
    server.resetHandlers();
    streamedEvents = [];

    // Setup test providers
    setupTestProviderDefaults();
    Session.clearProviderCache();

    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-sonnet-20241022'],
      apiKey: 'test-key',
    });

    // Create project and session
    const project = Project.create(
      'Compaction E2E Test',
      '/test/compaction',
      'Testing compaction with MSW',
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
    agentId = sessionId; // Main agent has same ID as session

    // Intercept SSE broadcasts to capture events
    const eventManager = EventStreamManager.getInstance();
    originalBroadcast = eventManager.broadcast;
    eventManager.broadcast = vi.fn((event: any) => {
      streamedEvents.push(event);
      return originalBroadcast.call(eventManager, event);
    });

    // Register session with event manager and setup agent event handlers
    const sessionService = getSessionService();
    EventStreamManager.getInstance().registerSession(session);

    // Get the session agent and set up event handlers
    const sessionAgent = session.getAgent(sessionId);
    if (sessionAgent) {
      sessionService.setupAgentEventHandlers(sessionAgent, sessionId);
    }
  });

  afterEach(async () => {
    // Restore original broadcast
    if (originalBroadcast) {
      EventStreamManager.getInstance().broadcast = originalBroadcast;
    }

    // Cleanup
    try {
      await cleanupTestProviderInstances();
    } catch (e) {
      // Ignore cleanup errors
    }
    cleanupTestProviderDefaults();
    Session.clearRegistry();
  });

  it('should trigger auto-compaction when approaching token limit and emit proper events', async () => {
    let messageCount = 0;
    let shouldTriggerCompaction = false;
    let compactionRequested = false;

    // Get the session's agent which already has proper provider configuration
    const session = await Session.getById(sessionId);
    const agent = session!.getAgent(sessionId);

    if (!agent) {
      throw new Error('Failed to get session agent');
    }

    // Debug: Check what provider is being used
    console.log('[TEST] Agent provider:', {
      providerName: (agent as any).provider?.providerName,
      isConfigured: (agent as any).provider?.isConfigured(),
      supportsStreaming: (agent as any).provider?.supportsStreaming,
    });

    // Update the agent's token budget to make compaction easier to trigger
    agent.tokenBudget = {
      maxTokens: 12000,
      reserveTokens: 1000,
      warningThreshold: 0.7,
    };

    // Add listeners to debug what's happening
    agent.on('agent_thinking_start', ({ message }: { message?: string }) => {
      console.log('[TEST] Agent thinking start:', message);
      if (message && message.includes('compact')) {
        compactionRequested = true;
      }
    });

    agent.on('agent_thinking_complete', () => {
      console.log('[TEST] Agent thinking complete');
    });

    // Mock Anthropic API responses
    server.use(
      http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
        const body = (await request.json()) as any;
        messageCount++;
        console.log(`[MSW] Intercepted request ${messageCount}:`, {
          url: request.url,
          hasMessages: !!body.messages,
          messageCount: body.messages?.length,
        });

        // First few messages: normal responses with increasing token usage
        if (messageCount <= 3) {
          return HttpResponse.json({
            id: `msg_${messageCount}`,
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: `Response ${messageCount}: This is a test response that simulates conversation.`,
              },
            ],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
              input_tokens: 1000 * messageCount, // Simulate growing context
              output_tokens: 100,
              total_tokens: 1000 * messageCount + 100,
            },
          });
        }

        // Fourth message: High token usage to trigger compaction
        if (messageCount === 4 && !shouldTriggerCompaction) {
          shouldTriggerCompaction = true;
          return HttpResponse.json({
            id: 'msg_4',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'This response pushes us close to the token limit.',
              },
            ],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
              input_tokens: 9500, // This will trigger compaction at 80% of 12000
              output_tokens: 100,
              total_tokens: 9600,
            },
          });
        }

        // Compaction summary request (identified by specific prompt pattern)
        if (
          body.messages?.some(
            (m: any) => m.content?.includes('summarize') || m.content?.includes('compacting')
          )
        ) {
          return HttpResponse.json({
            id: 'msg_compact',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: `Summary: The conversation involved testing the compaction system with multiple messages to simulate token usage growth.

Key points:
1. Initial messages established context
2. Token usage gradually increased
3. System is functioning normally

Technical context: Testing auto-compaction trigger at 80% threshold.`,
              },
            ],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
              input_tokens: 500,
              output_tokens: 100,
              total_tokens: 600,
            },
          });
        }

        // Post-compaction response
        return HttpResponse.json({
          id: 'msg_after_compact',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Continuing after compaction with reduced context.',
            },
          ],
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 1000, // Much lower after compaction
            output_tokens: 50,
            total_tokens: 1050,
          },
        });
      })
    );

    // Send messages to build up token usage using the session agent
    const messages = [
      'Hello, this is the first message.',
      'Please continue with the second message.',
      'And now the third message to build context.',
      'This fourth message should trigger auto-compaction.',
    ];

    for (let i = 0; i < messages.length; i++) {
      console.log(`[TEST] Sending message ${i + 1}: "${messages[i]}"`);
      await agent.sendMessage(messages[i]!);

      // Small delay to ensure events are processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check current token usage
      const events = agent.threadManager.getEvents(agent.threadId);
      const lastEvent = events[events.length - 1];
      console.log(`[TEST] After message ${i + 1}, last event:`, {
        type: lastEvent?.type,
        hasUsage: !!(lastEvent as any)?.usage,
        usage: (lastEvent as any)?.usage,
      });
    }

    console.log('[TEST] All messages sent. Compaction requested:', compactionRequested);
    console.log('[TEST] Streamed events count:', streamedEvents.length);
    console.log(
      '[TEST] Event types:',
      streamedEvents.map((e) => e.data?.type)
    );

    // Check that compaction events were emitted
    const compactionStartEvents = streamedEvents.filter((e) => e.data?.type === 'COMPACTION_START');
    const compactionCompleteEvents = streamedEvents.filter(
      (e) => e.data?.type === 'COMPACTION_COMPLETE'
    );

    expect(compactionStartEvents.length).toBeGreaterThan(0);
    expect(compactionCompleteEvents.length).toBeGreaterThan(0);

    // Verify compaction start event structure
    const startEvent = compactionStartEvents[0];
    const threadId = agent.threadId;
    expect(startEvent).toMatchObject({
      eventType: 'thread',
      scope: {
        projectId,
        sessionId,
        threadId,
      },
      data: {
        type: 'COMPACTION_START',
        threadId,
        data: {
          strategy: 'summarize',
          message: expect.stringContaining('compact'),
        },
      },
    });

    // Verify compaction complete event
    const completeEvent = compactionCompleteEvents[0];
    expect(completeEvent).toMatchObject({
      eventType: 'thread',
      scope: {
        projectId,
        sessionId,
        threadId,
      },
      data: {
        type: 'COMPACTION_COMPLETE',
        threadId,
        data: {
          success: true,
        },
      },
    });

    // Verify token usage is reported correctly in API
    const request = new NextRequest(
      `http://localhost:3000/api/projects/${projectId}/sessions/${sessionId}`
    );
    const response = await getSession(request, {
      params: Promise.resolve({ projectId, sessionId }),
    });

    expect(response.status).toBe(200);
    const sessionData = await parseResponse(response);

    // Token usage should be available
    expect(sessionData.tokenUsage).toBeDefined();
    expect(sessionData.tokenUsage.totalTokens).toBeGreaterThan(0);

    // Should be below limit after compaction
    expect(sessionData.tokenUsage.percentUsed).toBeLessThan(80);
    expect(sessionData.tokenUsage.nearLimit).toBe(false);

    // Verify COMPACTION event was added to thread
    const events = agent.threadManager.getEvents(threadId);
    const compactionEvent = events.find((e) => e.type === 'COMPACTION');
    expect(compactionEvent).toBeDefined();
    expect(compactionEvent?.data).toMatchObject({
      strategyId: 'summarize',
      originalEventCount: expect.any(Number),
      compactedEvents: expect.any(Array),
    });
  });

  it('should handle manual /compact command and emit events', async () => {
    // Mock response for manual compaction
    server.use(
      http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
        const body = (await request.json()) as any;

        // Check if this is a summarization request
        if (
          body.messages?.some(
            (m: any) => m.content?.includes('summarize') || m.content?.includes('compacting')
          )
        ) {
          return HttpResponse.json({
            id: 'msg_manual_compact',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'Summary: Manual compaction test completed successfully.',
              },
            ],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
              input_tokens: 200,
              output_tokens: 50,
              total_tokens: 250,
            },
          });
        }

        // Regular response
        return HttpResponse.json({
          id: 'msg_regular',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Regular response to build some context.',
            },
          ],
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 500,
            output_tokens: 50,
            total_tokens: 550,
          },
        });
      })
    );

    const session = await Session.getById(sessionId);
    const agent = session!.getAgent(agentId);

    // Send a regular message first
    await agent!.sendMessage('Build some context first');

    // Clear previous events
    streamedEvents = [];

    // Send /compact command
    await agent!.sendMessage('/compact');

    // Wait for compaction to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify compaction events were emitted
    const compactionStartEvents = streamedEvents.filter((e) => e.data?.type === 'COMPACTION_START');
    const compactionCompleteEvents = streamedEvents.filter(
      (e) => e.data?.type === 'COMPACTION_COMPLETE'
    );

    expect(compactionStartEvents.length).toBe(1);
    expect(compactionCompleteEvents.length).toBe(1);

    // Verify LOCAL_SYSTEM_MESSAGE was added
    const events = agent!.threadManager.getEvents(agentId);
    const systemMessage = events.find(
      (e) =>
        e.type === 'LOCAL_SYSTEM_MESSAGE' && e.data === '✅ Conversation compacted successfully'
    );
    expect(systemMessage).toBeDefined();
  });

  it('should track token usage correctly across multiple messages', async () => {
    const tokenUsages = [
      { input: 100, output: 50 },
      { input: 200, output: 75 },
      { input: 300, output: 100 },
    ];

    let requestIndex = 0;

    server.use(
      http.post('https://api.anthropic.com/v1/messages', async () => {
        const usage = tokenUsages[requestIndex] || { input: 100, output: 50 };
        requestIndex++;

        return HttpResponse.json({
          id: `msg_${requestIndex}`,
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: `Response ${requestIndex} with tracked tokens.`,
            },
          ],
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: usage.input,
            output_tokens: usage.output,
            total_tokens: usage.input + usage.output,
          },
        });
      })
    );

    const session = await Session.getById(sessionId);
    const agent = session!.getAgent(agentId);

    // Send multiple messages
    await agent!.sendMessage('First message');
    await agent!.sendMessage('Second message');
    await agent!.sendMessage('Third message');

    // Check token usage via API
    const request = new NextRequest(
      `http://localhost:3000/api/projects/${projectId}/sessions/${sessionId}`
    );
    const response = await getSession(request, {
      params: Promise.resolve({ projectId, sessionId }),
    });

    const sessionData = await parseResponse(response);

    // Verify cumulative token counts
    const expectedTotalInput = tokenUsages.reduce((sum, u) => sum + u.input, 0);
    const expectedTotalOutput = tokenUsages.reduce((sum, u) => sum + u.output, 0);

    expect(sessionData.tokenUsage).toMatchObject({
      totalPromptTokens: expectedTotalInput,
      totalCompletionTokens: expectedTotalOutput,
      totalTokens: expectedTotalInput + expectedTotalOutput,
      eventCount: 3,
    });
  });
});
