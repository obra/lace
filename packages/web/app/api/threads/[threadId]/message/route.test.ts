// ABOUTME: Integration tests for thread messaging API endpoint
// ABOUTME: Tests sending messages to agents with real functionality and mocked network layer

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/threads/[threadId]/message/route';
import type { MessageResponse } from '@/types/api';
import { Project } from '@/lib/server/lace-imports';
import { asThreadId } from '@/types/core';
import { getSessionService } from '@/lib/server/session-service';
import { setupWebTest } from '@/test-utils/web-test-setup';
import { createTestProviderInstance, cleanupTestProviderInstances } from '~/test-utils/provider-instances';
import { parseResponse } from '@/lib/serialization';

// Console capture for verifying error output
let consoleLogs: string[] = [];
let originalConsoleError: typeof console.error;

// Import real EventStreamManager for integration testing
import { EventStreamManager } from '@/lib/event-stream-manager';

describe('Thread Messaging API', () => {
  const _tempLaceDir = setupWebTest();
  let sessionService: ReturnType<typeof getSessionService>;
  let testProjectId: string;
  let realSessionId: string;
  let realThreadId: string;
  let providerInstanceId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up console capture
    consoleLogs = [];
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      consoleLogs.push(args.map((arg) => String(arg)).join(' '));
    };

    // Set up environment
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    // Create test provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    sessionService = getSessionService();

    // Create a real test project with provider configuration
    const project = Project.create(
      'Test Project', 
      process.cwd(), 
      'Project for testing',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );
    testProjectId = project.getId();

    // Create a real session (will inherit provider config from project)
    const session = await sessionService.createSession(
      'Test Session',
      testProjectId
    );
    realSessionId = session.id;
    realThreadId = session.id; // Session ID equals coordinator thread ID
  });

  afterEach(async () => {
    console.error = originalConsoleError;
    // Stop all agents first to prevent async operations after database closure
    await sessionService.stopAllAgents();
    sessionService.clearActiveSessions();
    // Clean up provider instances
    await cleanupTestProviderInstances([providerInstanceId]);
    // Wait a moment for any pending operations to abort
    await new Promise((resolve) => setTimeout(resolve, 20));
    vi.clearAllMocks();
  });

  it('should accept and process messages', async () => {
    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello, agent!' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ threadId: realThreadId }),
    });

    expect(response.status).toBe(202);
    const data = await parseResponse<MessageResponse>(response);
    expect(data.status).toBe('accepted');
    expect(data.messageId).toBeDefined();
    expect(data.threadId).toBe(realThreadId);
  });

  it('should return 400 for invalid thread ID', async () => {
    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello!' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ threadId: 'invalid-thread-id' }),
    });

    expect(response.status).toBe(400);
  });

  it('should return 404 for non-existent session', async () => {
    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello!' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ threadId: 'lace_20240101_fake12' }),
    });

    expect(response.status).toBe(404);
  });

  it('should return 400 for missing message', async () => {
    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(request, {
      params: Promise.resolve({ threadId: realThreadId }),
    });

    expect(response.status).toBe(400);
  });

  it('should return 400 for empty message', async () => {
    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ threadId: realThreadId }),
    });

    expect(response.status).toBe(400);
  });

  it('should broadcast user message event via EventStreamManager', async () => {
    // Set up spy on real EventStreamManager to verify broadcast is called
    const broadcastSpy = vi.spyOn(EventStreamManager.getInstance(), 'broadcast');

    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test message' }),
    });

    await POST(request, {
      params: Promise.resolve({ threadId: realThreadId }),
    });

    // Should broadcast the user message event
    expect(broadcastSpy).toHaveBeenCalledWith({
      eventType: 'session',
      scope: { sessionId: realSessionId },
      data: expect.objectContaining({
        type: 'USER_MESSAGE',
        data: { content: 'Test message' },
      }),
    });

    broadcastSpy.mockRestore();
  });

  it('should handle malformed JSON gracefully', async () => {
    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json',
    });

    // Clear any previous console logs for this specific test
    consoleLogs = [];

    const response = await POST(request, {
      params: Promise.resolve({ threadId: realThreadId }),
    });

    expect(response.status).toBe(400);

    // Verify error message in response
    const responseData = await parseResponse<{ error: string }>(response);
    expect(responseData.error).toBe('Invalid JSON in request body');
  });

  it('should work with delegate agents', async () => {
    // Create a delegate agent
    const session = await sessionService.getSession(asThreadId(realSessionId));
    expect(session).toBeDefined();

    const delegateAgent = session!.spawnAgent({
      name: 'Test Delegate',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022'
    });
    const delegateThreadId = delegateAgent.threadId;

    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello delegate!' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ threadId: delegateThreadId }),
    });

    expect(response.status).toBe(202);
    const data = await parseResponse<MessageResponse>(response);
    expect(data.status).toBe('accepted');
  });

  it('should handle agent startup correctly', async () => {
    // This test verifies that the auto-start functionality works
    const request = new NextRequest('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test auto-start' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ threadId: realThreadId }),
    });

    expect(response.status).toBe(202);

    // Get the agent
    const session = await sessionService.getSession(asThreadId(realSessionId));
    const agent = session!.getAgent(asThreadId(realThreadId));

    // Wait a short time for the async sendMessage call to complete and start the agent
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify agent is running after message processing starts
    expect(agent!.isRunning).toBe(true);
  });
});
