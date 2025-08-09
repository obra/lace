// ABOUTME: Tests for token usage information in session API responses
// ABOUTME: Verifies that token statistics are correctly included when fetching sessions

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { Project } from '@/lib/server/lace-imports';
import type { ThreadEvent } from '~/threads/types';
import { parseResponse } from '@/lib/serialization';

// Mock the imports
vi.mock('@/lib/server/lace-imports', () => ({
  Project: {
    getById: vi.fn(),
  },
  Session: {
    getById: vi.fn(),
  },
}));

vi.mock('~/threads/thread-manager', () => ({
  ThreadManager: vi.fn().mockImplementation(() => ({
    getEvents: vi.fn(),
  })),
}));

vi.mock('~/threads/token-aggregation', () => ({
  aggregateTokenUsage: vi.fn(),
}));

describe('Session API Token Usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should include token usage statistics in session response', async () => {
    const mockThreadId = 'thread_123';
    const mockSessionId = 'session_123';
    const mockProjectId = 'project_123';

    // Mock thread events with token usage
    const mockEvents: ThreadEvent[] = [
      {
        id: 'evt_1',
        threadId: mockThreadId,
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'Hello',
      },
      {
        id: 'evt_2',
        threadId: mockThreadId,
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
        threadId: mockThreadId,
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

    const mockThreadManager = {
      getEvents: vi.fn().mockReturnValue(mockEvents),
    };

    const mockAgent = {
      threadId: mockThreadId,
      threadManager: mockThreadManager,
      tokenBudget: {
        maxTokens: 12000,
        reserveTokens: 1000,
        warningThreshold: 0.7,
      },
    };

    const mockSessionInstance = {
      getId: vi.fn().mockReturnValue(mockSessionId),
      getAgent: vi.fn().mockReturnValue(mockAgent),
    };

    const mockSession = {
      id: mockSessionId,
      name: 'Test Session',
      createdAt: new Date(),
      agents: [],
    };

    const mockProject = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    vi.mocked(Project.getById).mockReturnValue(
      mockProject as {
        getSession: () => {
          id: string;
          name: string;
          createdAt: Date;
          agents: unknown[];
        };
      }
    );

    // Mock Session.getById
    const { Session } = await import('@/lib/server/lace-imports');
    vi.mocked(Session.getById).mockResolvedValue(
      mockSessionInstance as {
        getId: () => string;
        getAgent: () => unknown;
      }
    );

    // Mock aggregateTokenUsage
    const { aggregateTokenUsage } = await import('~/threads/token-aggregation');
    vi.mocked(aggregateTokenUsage).mockReturnValue({
      totalPromptTokens: 300,
      totalCompletionTokens: 125,
      totalTokens: 425,
      eventCount: 2,
    });

    const request = new NextRequest(
      'http://localhost:3000/api/projects/project_123/sessions/session_123'
    );
    const response = await GET(request, {
      params: Promise.resolve({ projectId: mockProjectId, sessionId: mockSessionId }),
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

    // Check that session is present
    expect(body.session).toBeDefined();

    // Check that token usage is included
    expect(body.tokenUsage).toBeDefined();
    expect(body.tokenUsage).toEqual({
      totalPromptTokens: 300,
      totalCompletionTokens: 125,
      totalTokens: 425,
      eventCount: 2,
      percentUsed: expect.any(Number),
      nearLimit: false,
      contextLimit: 12000,
    });

    // Verify percentage calculation
    expect(body.tokenUsage.percentUsed).toBeCloseTo(3.54, 1); // 425/12000 * 100
  });

  it('should handle sessions without token usage data', async () => {
    const mockSessionId = 'session_123';
    const mockProjectId = 'project_123';
    const mockThreadId = 'thread_123';

    // Mock events without token usage
    const mockEvents: ThreadEvent[] = [
      {
        id: 'evt_1',
        threadId: mockThreadId,
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'Hello',
      },
      {
        id: 'evt_2',
        threadId: mockThreadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'Hi there',
          // No tokenUsage field
        },
      },
    ];

    const mockThreadManager = {
      getEvents: vi.fn().mockReturnValue(mockEvents),
    };

    const mockAgent = {
      threadId: mockThreadId,
      threadManager: mockThreadManager,
      tokenBudget: {
        maxTokens: 12000,
        reserveTokens: 1000,
        warningThreshold: 0.7,
      },
    };

    const mockSessionInstance = {
      getId: vi.fn().mockReturnValue(mockSessionId),
      getAgent: vi.fn().mockReturnValue(mockAgent),
    };

    const mockSession = {
      id: mockSessionId,
      name: 'Test Session',
      createdAt: new Date(),
      agents: [],
    };

    const mockProject = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    vi.mocked(Project.getById).mockReturnValue(
      mockProject as {
        getSession: () => {
          id: string;
          name: string;
          createdAt: Date;
          agents: unknown[];
        };
      }
    );

    // Mock Session.getById
    const { Session } = await import('@/lib/server/lace-imports');
    vi.mocked(Session.getById).mockResolvedValue(
      mockSessionInstance as {
        getId: () => string;
        getAgent: () => unknown;
      }
    );

    // Mock aggregateTokenUsage to return zeros
    const { aggregateTokenUsage } = await import('~/threads/token-aggregation');
    vi.mocked(aggregateTokenUsage).mockReturnValue({
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      eventCount: 0,
    });

    const request = new NextRequest(
      'http://localhost:3000/api/projects/project_123/sessions/session_123'
    );
    const response = await GET(request, {
      params: Promise.resolve({ projectId: mockProjectId, sessionId: mockSessionId }),
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
    expect(body.tokenUsage.totalTokens).toBe(0);
    expect(body.tokenUsage.eventCount).toBe(0);
  });

  it('should mark nearLimit as true when approaching token limit', async () => {
    const mockSessionId = 'session_123';
    const mockProjectId = 'project_123';
    const mockThreadId = 'thread_123';

    // Mock events with high token usage
    const mockEvents: ThreadEvent[] = [
      {
        id: 'evt_1',
        threadId: mockThreadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'Large response',
          tokenUsage: {
            promptTokens: 8000,
            completionTokens: 2000,
            totalTokens: 10000,
          },
        },
      },
    ];

    const mockThreadManager = {
      getEvents: vi.fn().mockReturnValue(mockEvents),
    };

    const mockAgent = {
      threadId: mockThreadId,
      threadManager: mockThreadManager,
      tokenBudget: {
        maxTokens: 12000,
        reserveTokens: 1000,
        warningThreshold: 0.7,
      },
    };

    const mockSessionInstance = {
      getId: vi.fn().mockReturnValue(mockSessionId),
      getAgent: vi.fn().mockReturnValue(mockAgent),
    };

    const mockSession = {
      id: mockSessionId,
      name: 'Test Session',
      createdAt: new Date(),
      agents: [],
    };

    const mockProject = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    vi.mocked(Project.getById).mockReturnValue(
      mockProject as {
        getSession: () => {
          id: string;
          name: string;
          createdAt: Date;
          agents: unknown[];
        };
      }
    );

    // Mock Session.getById
    const { Session } = await import('@/lib/server/lace-imports');
    vi.mocked(Session.getById).mockResolvedValue(
      mockSessionInstance as {
        getId: () => string;
        getAgent: () => unknown;
      }
    );

    // Mock aggregateTokenUsage with high usage
    const { aggregateTokenUsage } = await import('~/threads/token-aggregation');
    vi.mocked(aggregateTokenUsage).mockReturnValue({
      totalPromptTokens: 8000,
      totalCompletionTokens: 2000,
      totalTokens: 10000,
      eventCount: 1,
    });

    const request = new NextRequest(
      'http://localhost:3000/api/projects/project_123/sessions/session_123'
    );
    const response = await GET(request, {
      params: Promise.resolve({ projectId: mockProjectId, sessionId: mockSessionId }),
    });

    const body = (await parseResponse(response)) as {
      tokenUsage?: {
        totalPromptTokens: number;
        totalCompletionTokens: number;
        totalTokens: number;
        eventCount: number;
      };
    };

    // Should be marked as near limit (10000 > 12000 * 0.8)
    expect(body.tokenUsage.nearLimit).toBe(true);
    expect(body.tokenUsage.percentUsed).toBeCloseTo(83.33, 1); // 10000/12000 * 100
  });
});
