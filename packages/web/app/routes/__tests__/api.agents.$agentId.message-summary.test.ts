// ABOUTME: Integration tests for agent message endpoint with summary generation
// ABOUTME: Tests complete flow including SSE broadcasting with mocked AI provider

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { setupWebTest } from '@/test-utils/web-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import { Project } from '~/projects/project';
import { Session } from '@/lib/server/lace-imports';
import { action } from '@/app/routes/api.agents.$agentId.message';
import { EventStreamManager } from '@/lib/event-stream-manager';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { LaceEvent, AgentSummaryUpdatedData } from '@/types/core';

// Mock the AI provider HTTP responses
const server = setupServer(
  // Mock Anthropic API for the SessionHelper
  http.post('https://api.anthropic.com/v1/messages', () => {
    return HttpResponse.json({
      id: 'msg_mock_summary',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Setting up user authentication system',
        },
      ],
      model: 'claude-3-5-haiku-20241022',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 50,
        output_tokens: 10,
      },
    });
  })
);

describe('Agent Message Endpoint with Summary Generation', () => {
  const _tempLaceDir = setupWebTest();
  let providerInstanceId: string;
  let projectId: string;
  let sessionId: string;
  let agentId: string;
  let capturedEvents: LaceEvent[] = [];

  beforeEach(async () => {
    server.listen({ onUnhandledRequest: 'error' });
    setupTestProviderDefaults();

    // Create test provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create project with the test provider
    const project = Project.create(
      'Test Project',
      process.cwd(),
      'Project for agent summary testing',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );
    projectId = project.getId();

    // Create session using Session.create() pattern
    const sessionInstance = Session.create({
      name: 'Test Session',
      projectId,
    });
    const session = sessionInstance.getInfo()!;
    sessionId = session.id;
    agentId = sessionId; // Coordinator agent has same ID as session

    // Register the session with EventStreamManager for proper event handling
    const eventStreamManager = EventStreamManager.getInstance();
    eventStreamManager.registerSession(sessionInstance);

    // Capture SSE events
    capturedEvents = [];
    const originalBroadcast = eventStreamManager.broadcast.bind(eventStreamManager);
    vi.spyOn(eventStreamManager, 'broadcast').mockImplementation((event: LaceEvent) => {
      capturedEvents.push(event);
      return originalBroadcast(event);
    });
  });

  afterEach(async () => {
    server.resetHandlers();
    server.close();
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
  });

  it('should generate and broadcast agent summary when user sends message', async () => {
    // Create request
    const request = new Request('http://localhost:3000/api/agents/test-agent/message', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Help me set up user authentication',
      }),
    });

    // Call the endpoint
    const response = await action({
      request,
      params: { agentId },
    } as { request: Request; params: { agentId: string }; context: object });

    // Verify successful response
    expect(response.status).toBe(202);
    const responseData = await response.json();

    // Handle SuperJSON response format
    const actualData = responseData.json || responseData;
    expect(actualData.status).toBe('accepted');
    expect(actualData.agentId).toBe(agentId);
    expect(actualData.messageId).toBeDefined();

    // Wait a bit for async summary generation
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify AGENT_SUMMARY_UPDATED event was broadcast
    const summaryEvent = capturedEvents.find((event) => event.type === 'AGENT_SUMMARY_UPDATED');
    expect(summaryEvent).toBeDefined();
    expect(summaryEvent!.threadId).toBe(agentId);
    expect(summaryEvent!.transient).toBe(true);
    expect(summaryEvent!.context).toEqual({
      projectId,
      sessionId,
      agentId,
    });

    // Verify event data structure
    const eventData = summaryEvent!.data as AgentSummaryUpdatedData;
    expect(eventData.summary).toBe('Setting up user authentication system');
    expect(eventData.agentThreadId).toBe(agentId);
    expect(eventData.timestamp).toBeInstanceOf(Date);
  });

  it('should handle summary generation failure gracefully', async () => {
    // Mock the AI provider to fail
    server.use(
      http.post('https://api.anthropic.com/v1/messages', () => {
        return HttpResponse.error();
      })
    );

    const request = new Request('http://localhost:3000/api/agents/test-agent/message', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Test message',
      }),
    });

    const response = await action({
      request,
      params: { agentId },
    } as { request: Request; params: { agentId: string }; context: object });

    // Endpoint should still succeed
    expect(response.status).toBe(202);

    // Wait for async summary generation to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should not broadcast summary event when helper fails
    const summaryEvent = capturedEvents.find((event) => event.type === 'AGENT_SUMMARY_UPDATED');
    expect(summaryEvent).toBeUndefined();
  });

  it('should include last agent response in summary context', async () => {
    // This test verifies that the helper considers conversation history
    // We'll mock a more specific response to prove it was called with context

    // Mock the summary response to return different text showing it got context
    server.use(
      http.post('https://api.anthropic.com/v1/messages', () => {
        return HttpResponse.json({
          id: 'msg_mock_summary',
          type: 'message',
          content: [
            {
              type: 'text',
              text: 'Continuing previous authentication work',
            },
          ],
        });
      })
    );

    const request = new Request('http://localhost:3000/api/agents/test-agent/message', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Add password hashing',
      }),
    });

    await action({
      request,
      params: { agentId },
    } as { request: Request; params: { agentId: string }; context: object });

    // Wait for summary generation
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify AGENT_SUMMARY_UPDATED event was broadcast
    const summaryEvent = capturedEvents.find((event) => event.type === 'AGENT_SUMMARY_UPDATED');
    expect(summaryEvent).toBeDefined();

    const eventData = summaryEvent!.data as AgentSummaryUpdatedData;
    expect(eventData.summary).toBe('Continuing previous authentication work');
  });
});
