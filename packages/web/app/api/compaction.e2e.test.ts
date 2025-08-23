// ABOUTME: E2E test for compaction feature with MSW-mocked AI provider
// ABOUTME: Tests full compaction flow including token tracking, auto-trigger, and SSE events

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// Mock server-only module first
vi.mock('server-only', () => ({}));

// IMPORTANT: Unmock the Anthropic SDK to allow real HTTP requests
// The global mock in test-setup.ts prevents MSW from working
vi.unmock('@anthropic-ai/sdk');

// Setup MSW server before any other imports
const server = setupServer();

// Start MSW server immediately to intercept all requests
beforeAll(() => {
  server.listen({
    onUnhandledRequest: (_req) => {},
  });
});

afterAll(() => {
  server.close();
});

// Now import everything else after MSW is set up
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
import { createAnthropicStreamResponse } from '@/test-utils/msw-streaming-helpers';
import type { ThreadId } from '@/types/core';
import type { AgentWithTokenUsage } from '@/types/api';

describe('Compaction E2E Test with MSW', { timeout: 30000 }, () => {
  const _tempLaceDir = setupWebTest();
  let projectId: string;
  let sessionId: ThreadId;
  let agentId: ThreadId;
  let providerInstanceId: string;
  let streamedEvents: unknown[] = [];
  let originalBroadcast: EventStreamManager['broadcast'] | undefined;

  beforeEach(async () => {
    // Only suppress console output in local development, not CI
    if (!process.env.CI) {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    }

    // Reset MSW handlers
    server.resetHandlers();
    streamedEvents = [];

    // Set up environment for Anthropic SDK
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

    // Set up default token counting handler for all tests
    server.use(
      http.post('https://api.anthropic.com/v1/messages/count_tokens', async () => {
        return HttpResponse.json({
          input_tokens: 100,
        });
      })
    );

    // Setup test providers
    setupTestProviderDefaults();

    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-sonnet-20241022'],
      apiKey: 'test-anthropic-key',
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
      // Don't start the agent here - let each test start it after setting up handlers
      await sessionService.setupAgentEventHandlers(sessionAgent);
    }
  });

  afterEach(async () => {
    // Restore console and other mocks
    vi.restoreAllMocks();

    // Restore original broadcast
    if (originalBroadcast) {
      EventStreamManager.getInstance().broadcast = originalBroadcast;
    }

    // Stop all agents before cleanup
    const session = await Session.getById(sessionId);
    if (session) {
      const agent = session.getAgent(sessionId);
      if (agent) {
        agent.stop();
      }
    }

    // Cleanup
    try {
      await cleanupTestProviderInstances([providerInstanceId]);
    } catch (_e) {
      // Ignore cleanup errors
    }
    cleanupTestProviderDefaults();
    Session.clearRegistry();

    // Reset MSW server
    server.resetHandlers();
  });

  it('should trigger auto-compaction when approaching token limit and emit proper events', async () => {
    let messageCount = 0;
    let shouldTriggerCompaction = false;
    let _compactionRequested = false;

    // Get the session's agent which already has proper provider configuration
    const session = await Session.getById(sessionId);
    const agent = session!.getAgent(sessionId);

    if (!agent) {
      throw new Error('Failed to get session agent');
    }

    // Start the agent now that handlers are set up
    await agent.start();

    // Token budget management has been simplified to use direct percentage thresholds
    // Auto-compaction will trigger at 80% usage based on provider-reported context limits

    // Add listeners to debug what's happening
    agent.on('compaction_start', ({ auto: _auto }: { auto: boolean }) => {
      _compactionRequested = true;
    });

    agent.on('compaction_complete', ({ success: _success }: { success: boolean }) => {});

    agent.on('error', ({ error: _error }: { error: Error }) => {});

    // Mock Anthropic API responses with proper streaming format
    server.use(
      http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
        const body = (await request.json()) as {
          stream?: boolean;
          messages?: Array<{ content?: string }>;
        };
        const isStreaming = body.stream === true;
        messageCount++;

        // Build response based on message count and context
        let responseText = '';
        let inputTokens = 100;
        let outputTokens = 50;

        if (messageCount <= 3) {
          responseText = `Test response ${messageCount}`;
          inputTokens = 30000 * messageCount; // Build up token usage
          outputTokens = 5000;
        } else if (messageCount === 4 && !shouldTriggerCompaction) {
          shouldTriggerCompaction = true;
          responseText = 'High token response.';
          inputTokens = 160000; // Trigger compaction at 80% of 200000 (claude-3-5-sonnet context window)
          outputTokens = 5000;
        } else if (
          body.messages?.some(
            (m) => m.content?.includes('summarize') || m.content?.includes('compacting')
          )
        ) {
          responseText = `Summary: The conversation involved testing the compaction system with multiple messages to simulate token usage growth.

Key points:
1. Initial messages established context
2. Token usage gradually increased
3. System is functioning normally

Technical context: Testing auto-compaction trigger at 80% threshold.`;
          inputTokens = 500;
          outputTokens = 100;
        } else {
          responseText = 'Post-compaction response.';
          inputTokens = 1000;
          outputTokens = 50;
        }

        // Handle streaming vs non-streaming responses
        if (isStreaming) {
          // Create streaming SSE response that matches Anthropic's actual API format
          const streamEvents = [
            {
              type: 'message_start',
              message: {
                id: `msg_${messageCount}`,
                type: 'message',
                role: 'assistant',
                content: [],
                model: 'claude-3-5-sonnet-20241022',
                stop_reason: null,
                stop_sequence: null,
                usage: {
                  input_tokens: inputTokens,
                  output_tokens: 0,
                },
              },
            },
            {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'text',
                text: '',
              },
            },
            // Split text into chunks for realistic streaming
            ...responseText.split(' ').map((word, i, arr) => ({
              type: 'content_block_delta',
              index: 0,
              delta: {
                type: 'text_delta',
                text: i === arr.length - 1 ? word : word + ' ',
              },
            })),
            {
              type: 'content_block_stop',
              index: 0,
            },
            {
              type: 'message_delta',
              delta: {
                stop_reason: 'end_turn',
                stop_sequence: null,
              },
              usage: {
                output_tokens: outputTokens,
              },
            },
            {
              type: 'message_stop',
            },
          ];

          return createAnthropicStreamResponse(streamEvents);
        } else {
          // Non-streaming response
          return HttpResponse.json({
            id: `msg_${messageCount}`,
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: responseText,
              },
            ],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
              input_tokens: inputTokens,
              output_tokens: outputTokens,
            },
          });
        }
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
      // Check token usage before sending
      await agent.sendMessage(messages[i]!);

      // Longer delay to ensure events are processed (CI environments are slower)
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Check current token usage and state
      const events = agent.threadManager.getEvents(agent.threadId);
      const agentMessages = events.filter((e) => e.type === 'AGENT_MESSAGE');
      const _lastAgentMessage = agentMessages[agentMessages.length - 1];

      // Check token usage state
      const _currentUsage = agent.getTokenUsage();

      // Give auto-compaction time to trigger after message 4
      if (i === 3) {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Check if compaction happened
        const eventsAfterWait = agent.threadManager.getEvents(agent.threadId);
        const compactionEvent = eventsAfterWait.find((e) => e.type === 'COMPACTION');
        if (compactionEvent) {
        }
      }
    }

    // Check that compaction actually happened in the thread
    const finalEvents = agent.threadManager.getEvents(agent.threadId);
    const compactionEvent = finalEvents.find((e) => e.type === 'COMPACTION');

    // Debug output for CI environment
    if (!compactionEvent) {
      console.error('DEBUG: No COMPACTION event found. Final events:');
      console.error(finalEvents.map((e) => ({ type: e.type, timestamp: e.timestamp })));
      console.error('DEBUG: Message count:', messageCount);
      console.error('DEBUG: Should trigger compaction:', shouldTriggerCompaction);
      console.error('DEBUG: Compaction requested:', _compactionRequested);
      console.error(
        'DEBUG: Streamed events:',
        streamedEvents.map((e) => (e as any)?.type)
      );
    }

    expect(compactionEvent).toBeDefined();
    expect(compactionEvent?.data).toMatchObject({
      strategyId: 'summarize',
      originalEventCount: expect.any(Number),
      compactedEvents: expect.any(Array),
    });

    // Check that SSE events were emitted for auto-compaction
    const compactionStartEvents = streamedEvents.filter(
      (e) => (e as { type?: string }).type === 'COMPACTION_START'
    );
    const compactionCompleteEvents = streamedEvents.filter(
      (e) => (e as { type?: string }).type === 'COMPACTION_COMPLETE'
    );

    expect(compactionStartEvents.length).toBeGreaterThan(0);
    expect(compactionCompleteEvents.length).toBeGreaterThan(0);

    // Verify the SSE event has correct structure
    if (compactionStartEvents.length > 0) {
      const startEvent = compactionStartEvents[0] as {
        type: string;
        data: {
          auto: boolean;
        };
      };
      expect(startEvent).toMatchObject({
        type: 'COMPACTION_START',
        data: {
          auto: true,
        },
      });
    }

    // Verify token usage is reported correctly in API
    const request = new NextRequest(`http://localhost:3000/api/agents/${sessionId}`);
    const response = await getAgent(request, {
      params: Promise.resolve({ agentId: sessionId }),
    });

    expect(response.status).toBe(200);
    const agentData = (await parseResponse(response)) as AgentWithTokenUsage;

    // Token usage should be available with proper structure
    expect(agentData.tokenUsage).toBeDefined();
    expect(agentData.tokenUsage).toHaveProperty('totalTokens');
    expect(agentData.tokenUsage).toHaveProperty('contextLimit');
    expect(agentData.tokenUsage).toHaveProperty('percentUsed');
    expect(agentData.tokenUsage).toHaveProperty('nearLimit');
  });

  it('should handle manual /compact command and emit events', async () => {
    // Helper to create streaming response for this test - define BEFORE using it
    const createTestStreamResponse = (text: string, inputTokens: number, outputTokens: number) => {
      const events = [
        {
          type: 'message_start',
          message: {
            id: 'msg_manual',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: inputTokens, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: outputTokens },
        },
        {
          type: 'message_stop',
        },
      ];

      return createAnthropicStreamResponse(events);
    };

    // Set up MSW handler FIRST before any agent operations
    server.use(
      http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
        const body = (await request.json()) as {
          stream?: boolean;
          messages?: Array<{ content?: string }>;
        };
        const isStreaming = body.stream === true;

        // Check if this is a summarization request
        if (
          body.messages?.some(
            (m) => m.content?.includes('summarize') || m.content?.includes('compacting')
          )
        ) {
          const text = 'Summary: Manual compaction test completed successfully.';
          if (isStreaming) {
            return createTestStreamResponse(text, 200, 50);
          } else {
            return HttpResponse.json({
              id: 'msg_manual_compact',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text }],
              model: 'claude-3-5-sonnet-20241022',
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 200, output_tokens: 50 },
            });
          }
        }

        // Regular response
        const text = 'Test context response.';
        if (isStreaming) {
          return createTestStreamResponse(text, 500, 50);
        } else {
          return HttpResponse.json({
            id: 'msg_regular',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text }],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 500, output_tokens: 50 },
          });
        }
      })
    );

    const session = await Session.getById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const agent = session.getAgent(sessionId);

    if (!agent) {
      throw new Error('Failed to get session agent');
    }

    // Start the agent to initialize token budget
    await agent.start();

    // Send a regular message first
    await agent.sendMessage('Build some context first');

    // Clear previous events
    streamedEvents = [];

    // Send /compact command
    await agent.sendMessage('/compact');

    // Wait for compaction to complete (longer timeout for CI)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify compaction events were emitted
    const compactionStartEvents = streamedEvents.filter(
      (e) => (e as { type?: string }).type === 'COMPACTION_START'
    );
    const compactionCompleteEvents = streamedEvents.filter(
      (e) => (e as { type?: string }).type === 'COMPACTION_COMPLETE'
    );

    expect(compactionStartEvents.length).toBe(1);
    expect(compactionCompleteEvents.length).toBe(1);

    // Verify COMPACTION_COMPLETE event was added instead of LOCAL_SYSTEM_MESSAGE
    const events = agent!.threadManager.getEvents(agentId);
    const compactionComplete = events.find(
      (e) => e.type === 'COMPACTION_COMPLETE' && e.data?.success === true
    );

    // Debug output for CI environment
    if (!compactionComplete) {
      console.error('DEBUG: No COMPACTION_COMPLETE event found. Events:');
      console.error(events.map((e) => ({ type: e.type, timestamp: e.timestamp })));
      console.error(
        'DEBUG: Streamed events:',
        streamedEvents.map((e) => (e as any)?.type)
      );
    }

    expect(compactionComplete).toBeDefined();
  });

  it('should track token usage correctly across multiple messages', async () => {
    const tokenUsages = [
      { input: 100, output: 50 },
      { input: 200, output: 75 },
      { input: 300, output: 100 },
    ];

    let requestIndex = 0;

    // Helper function to create streaming response - defined BEFORE using it
    const createTokenTrackingStreamResponse = (
      text: string,
      usage: { input: number; output: number }
    ) => {
      const events = [
        {
          type: 'message_start',
          message: {
            id: `msg_${requestIndex}`,
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: usage.input, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: usage.output },
        },
        {
          type: 'message_stop',
        },
      ];

      return createAnthropicStreamResponse(events);
    };

    server.use(
      http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
        const body = (await request.json()) as {
          stream?: boolean;
          messages?: Array<{ content?: string }>;
        };
        const isStreaming = body.stream === true;
        const usage = tokenUsages[requestIndex] || { input: 100, output: 50 };
        requestIndex++;

        const text = `Token test ${requestIndex}.`;

        if (isStreaming) {
          return createTokenTrackingStreamResponse(text, usage);
        } else {
          return HttpResponse.json({
            id: `msg_${requestIndex}`,
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text }],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
              input_tokens: usage.input,
              output_tokens: usage.output,
            },
          });
        }
      })
    );

    const session = await Session.getById(sessionId);
    const agent = session!.getAgent(sessionId);

    if (!agent) {
      throw new Error('Failed to get session agent');
    }

    // Start the agent to initialize token budget
    await agent.start();

    // Send multiple messages
    await agent.sendMessage('First message');
    await agent.sendMessage('Second message');
    await agent.sendMessage('Third message');

    // Check token usage via API
    const request = new NextRequest(`http://localhost:3000/api/agents/${sessionId}`);
    const response = await getAgent(request, {
      params: Promise.resolve({ agentId: sessionId }),
    });

    const agentData = (await parseResponse(response)) as AgentWithTokenUsage;

    // Verify cumulative token counts
    const expectedTotalInput = tokenUsages.reduce((sum, u) => sum + u.input, 0);
    const expectedTotalOutput = tokenUsages.reduce((sum, u) => sum + u.output, 0);

    // Debug output for CI environment
    if (!agentData.tokenUsage || agentData.tokenUsage.totalTokens === 0) {
      console.error('DEBUG: Token usage is missing or zero. Agent data:');
      console.error(JSON.stringify(agentData, null, 2));
      console.error(
        'DEBUG: Expected totals - input:',
        expectedTotalInput,
        'output:',
        expectedTotalOutput
      );
      const events = agent!.threadManager.getEvents(agentId);
      console.error('DEBUG: Thread events:');
      console.error(
        events.map((e) => ({
          type: e.type,
          timestamp: e.timestamp,
          usage: (e as any)?.data?.usage,
        }))
      );
    }

    expect(agentData.tokenUsage).toMatchObject({
      totalPromptTokens: expectedTotalInput,
      totalCompletionTokens: expectedTotalOutput,
      totalTokens: expectedTotalInput + expectedTotalOutput,
    });
  });
});
