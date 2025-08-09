// ABOUTME: Tests for token usage information in session API responses
// ABOUTME: Verifies that token statistics are correctly included when fetching sessions

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import {
  Project,
  Session,
  cleanupTestProviderInstances,
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '@/lib/server/lace-imports';
import { parseResponse } from '@/lib/serialization';
import type { ThreadEvent } from '~/threads/types';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Session API Token Usage', () => {
  let testProjectId: string;
  let testProject: InstanceType<typeof Project>;
  let cleanupFunctions: Array<() => void | Promise<void>> = [];
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for the test
    tempDir = await mkdtemp(join(tmpdir(), 'lace-test-'));
    cleanupFunctions.push(async () => await rm(tempDir, { recursive: true, force: true }));

    // Set up test provider defaults
    await setupTestProviderDefaults();

    // Create a test project with the temp directory
    testProject = Project.create('Test Project', tempDir);
    testProjectId = testProject.getId();
    cleanupFunctions.push(() => testProject.delete());
  });

  afterEach(async () => {
    // Clean up in reverse order
    for (const cleanup of cleanupFunctions.reverse()) {
      await cleanup();
    }
    cleanupFunctions = [];

    // Clean up provider instances and defaults
    await cleanupTestProviderInstances([]);
    await cleanupTestProviderDefaults();

    // Clear any sessions from the registry
    Session.clearRegistry();
  });

  it('should include token usage statistics in session response', async () => {
    // Create a real session with a real project
    const session = Session.create({
      name: 'Test Session',
      projectId: testProjectId,
      configuration: {
        providerInstanceId: 'anthropic-default',
        modelId: 'claude-3-5-haiku-20241022',
      },
    });
    cleanupFunctions.push(() => session.destroy());

    const sessionId = session.getId();
    const agent = session.getAgent(sessionId);
    if (!agent) throw new Error('Agent not found');
    const threadManager = agent.threadManager;
    const threadId = sessionId; // Main agent thread ID is same as session ID

    // Add real events with token usage to the thread
    const events: ThreadEvent[] = [
      {
        id: 'evt_1',
        threadId,
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'Hello',
      },
      {
        id: 'evt_2',
        threadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'Hi there',
          tokenUsage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        },
      },
      {
        id: 'evt_3',
        threadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'How can I help?',
          tokenUsage: {
            promptTokens: 200,
            completionTokens: 75,
            totalTokens: 275,
          },
        },
      },
    ];

    // Add events to the thread
    for (const event of events) {
      threadManager.addEvent(event.threadId, event.type, event.data);
    }

    // Make the API request
    const request = new NextRequest(
      `http://localhost:3000/api/projects/${testProjectId}/sessions/${sessionId}`
    );
    const response = await GET(request, {
      params: Promise.resolve({ projectId: testProjectId, sessionId }),
    });

    expect(response.status).toBe(200);

    const body = (await parseResponse(response)) as {
      session?: unknown;
      tokenUsage?: {
        totalPromptTokens: number;
        totalCompletionTokens: number;
        totalTokens: number;
        eventCount: number;
        percentUsed: number;
        nearLimit: boolean;
        contextLimit: number;
      };
    };

    // Check that session is present
    expect(body.session).toBeDefined();

    // Check that token usage is included
    expect(body.tokenUsage).toBeDefined();
    expect(body.tokenUsage?.totalPromptTokens).toBe(300);
    expect(body.tokenUsage?.totalCompletionTokens).toBe(125);
    expect(body.tokenUsage?.totalTokens).toBe(425);
    expect(body.tokenUsage?.eventCount).toBe(2);
    expect(body.tokenUsage?.nearLimit).toBe(false);
    // Note: contextLimit defaults to 200000 when tokenBudgetManager is not configured
    expect(body.tokenUsage?.contextLimit).toBe(200000);
    // Verify percentage calculation
    expect(body.tokenUsage?.percentUsed).toBeCloseTo(0.2125, 2); // 425/200000 * 100
  });

  it('should handle sessions without token usage data', async () => {
    // Create a real session
    const session = Session.create({
      name: 'Test Session Without Token Usage',
      projectId: testProjectId,
      configuration: {
        providerInstanceId: 'anthropic-default',
        modelId: 'claude-3-5-haiku-20241022',
      },
    });
    cleanupFunctions.push(() => session.destroy());

    const sessionId = session.getId();
    const agent = session.getAgent(sessionId);
    if (!agent) throw new Error('Agent not found');
    const threadManager = agent.threadManager;
    const threadId = sessionId;

    // Add events without token usage
    const events: ThreadEvent[] = [
      {
        id: 'evt_1',
        threadId,
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'Hello',
      },
      {
        id: 'evt_2',
        threadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'Hi there',
          // No tokenUsage field
        },
      },
    ];

    // Add events to the thread
    for (const event of events) {
      threadManager.addEvent(event.threadId, event.type, event.data);
    }

    // Make the API request
    const request = new NextRequest(
      `http://localhost:3000/api/projects/${testProjectId}/sessions/${sessionId}`
    );
    const response = await GET(request, {
      params: Promise.resolve({ projectId: testProjectId, sessionId }),
    });

    expect(response.status).toBe(200);

    const body = (await parseResponse(response)) as {
      tokenUsage?: {
        totalPromptTokens: number;
        totalCompletionTokens: number;
        totalTokens: number;
        eventCount: number;
      };
    };

    // Token usage should still be present but with zero values
    expect(body.tokenUsage).toBeDefined();
    expect(body.tokenUsage?.totalTokens).toBe(0);
    expect(body.tokenUsage?.eventCount).toBe(0);
  });

  it('should mark nearLimit as true when approaching token limit', async () => {
    // Create a real session
    const session = Session.create({
      name: 'Test Session Near Limit',
      projectId: testProjectId,
      configuration: {
        providerInstanceId: 'anthropic-default',
        modelId: 'claude-3-5-haiku-20241022',
      },
    });
    cleanupFunctions.push(() => session.destroy());

    const sessionId = session.getId();
    const agent = session.getAgent(sessionId);
    if (!agent) throw new Error('Agent not found');
    const threadManager = agent.threadManager;
    const threadId = sessionId;

    // Add events with very high token usage
    // Default context limit is 200000, so we need > 160000 tokens to trigger nearLimit
    const events: ThreadEvent[] = [
      {
        id: 'evt_1',
        threadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'Large response',
          tokenUsage: {
            promptTokens: 150000,
            completionTokens: 20000,
            totalTokens: 170000,
          },
        },
      },
    ];

    // Add events to the thread
    for (const event of events) {
      threadManager.addEvent(event.threadId, event.type, event.data);
    }

    // Make the API request
    const request = new NextRequest(
      `http://localhost:3000/api/projects/${testProjectId}/sessions/${sessionId}`
    );
    const response = await GET(request, {
      params: Promise.resolve({ projectId: testProjectId, sessionId }),
    });

    const body = (await parseResponse(response)) as {
      tokenUsage?: {
        totalPromptTokens: number;
        totalCompletionTokens: number;
        totalTokens: number;
        eventCount: number;
        nearLimit: boolean;
        percentUsed: number;
      };
    };

    // Should be marked as near limit (170000 > 200000 * 0.8)
    expect(body.tokenUsage?.nearLimit).toBe(true);
    expect(body.tokenUsage?.percentUsed).toBeCloseTo(85, 1); // 170000/200000 * 100
  });
});
