# Token Web API Architecture Cleanup

## Overview

This plan fixes the fundamental architectural violation where session APIs return token usage data. Sessions are metadata containers - they don't consume tokens. Agents consume tokens. This plan implements proper separation of concerns with breaking changes and no backward compatibility.

## CRITICAL: No Backward Compatibility

**WE ARE MAKING BREAKING CHANGES ON PURPOSE.**
- Session API will stop returning `tokenUsage` field
- UI must use agent API + SSE for token data
- Tests will break and need updates
- This is architecturally correct

## Architecture Principles

### Current (Wrong) Architecture
```
GET /api/sessions/{id} → { session: {...}, tokenUsage: {...} }
```
❌ Sessions don't consume tokens  
❌ Mixing metadata with runtime data  
❌ Wrong layer of abstraction

### Target (Correct) Architecture
```
GET /api/sessions/{id} → { session: {...} }           # Metadata only
GET /api/agents/{id}   → { agent: {..., tokenUsage} } # Runtime data
SSE: AGENT_MESSAGE     → { content, tokenUsage }      # Real-time updates
```
✅ Clean separation of concerns  
✅ Sessions = metadata, Agents = runtime  
✅ Real-time updates via existing SSE system

## Implementation Strategy

### TDD Approach
1. **Write failing tests first** for the correct behavior
2. **Run tests to confirm failure** 
3. **Implement minimal code** to make tests pass
4. **Refactor** while keeping tests green
5. **No shortcuts** - full test coverage required

### Technology Stack
- **Superjson**: All API responses use `createSuperjsonResponse()` 
- **parseResponse()**: All response parsing uses established utility
- **TypeScript strict mode**: No any types, proper type safety
- **Vitest**: Test framework with co-located tests
- **Breaking changes**: No backward compatibility code

## Phase 1: Update Type Definitions

### Goal: Define correct API response types

### Task 1.1: Remove tokenUsage from SessionResponse
**File**: `packages/web/types/api.ts`

**Write test first**:
```typescript
// packages/web/types/api.test.ts
import { describe, it, expect } from 'vitest';
import type { SessionResponse, AgentResponse } from './api';

describe('API Type Definitions', () => {
  it('should not include tokenUsage in SessionResponse', () => {
    const response: SessionResponse = {
      session: {
        id: 'test-session',
        projectId: 'test-project', 
        name: 'Test Session',
        description: 'Test Description',
        configuration: {},
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      // Should NOT have tokenUsage field
    };
    
    expect(response.session.id).toBe('test-session');
    
    // TypeScript should not allow tokenUsage field
    // @ts-expect-error - tokenUsage should not exist on SessionResponse
    expect(response.tokenUsage).toBeUndefined();
  });
});
```

**Implementation**:
```typescript
// packages/web/types/api.ts
export interface SessionResponse {
  session: SessionInfo;
  // DELETE: tokenUsage field entirely
}
```

### Task 1.2: Add tokenUsage to AgentResponse
**File**: `packages/web/types/api.ts`

**Write test first**:
```typescript
it('should include tokenUsage in AgentResponse', () => {
  const response: AgentResponse = {
    agent: {
      threadId: 'agent-123',
      name: 'Test Agent',
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      providerInstanceId: 'test-provider',
      modelId: 'claude-3-sonnet',
      status: 'idle',
      tokenUsage: {
        totalPromptTokens: 1000,
        totalCompletionTokens: 500,
        totalTokens: 1500,
        contextLimit: 200000,
        percentUsed: 0.75,
        nearLimit: false,
        eventCount: 10,
      },
      createdAt: new Date(),
    }
  };
  
  expect(response.agent.tokenUsage.totalTokens).toBe(1500);
});
```

**Run test to confirm failure**:
```bash
npm run test:run packages/web/types/api.test.ts
```

**Implementation**:
```typescript
// packages/web/types/api.ts
export interface AgentResponse {
  agent: AgentInfo & {
    tokenUsage?: {
      totalPromptTokens: number;
      totalCompletionTokens: number;
      totalTokens: number;
      contextLimit: number;
      percentUsed: number;
      nearLimit: boolean;
      eventCount: number;
      lastCompactionAt?: Date;
    };
  };
}
```

## Phase 2: Update Session API (Remove Token Data)

### Goal: Sessions return metadata only

### Task 2.1: Remove token calculation from session route
**File**: `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.ts`

**Write failing test first**:
```typescript
// packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.test.ts
import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { Project } from '@/lib/server/lace-imports';
import { parseResponse } from '@/lib/serialization';
import type { SessionResponse } from '@/types/api';

// Add to existing describe block
it('should return session metadata without tokenUsage field', async () => {
  mockProject.getSession.mockReturnValue(mockSession);

  const response = await GET(
    new NextRequest('http://localhost/api/projects/project1/sessions/session1'),
    { params: Promise.resolve({ projectId: 'project1', sessionId: 'session1' }) }
  );

  const data = await parseResponse<SessionResponse>(response);

  expect(response.status).toBe(200);
  expect(data.session).toBeDefined();
  expect(data.session.id).toBe('session1');
  
  // CRITICAL: Should NOT have tokenUsage field
  expect('tokenUsage' in data).toBe(false);
});

it('should not access Session.getById or agent internals', async () => {
  // This test ensures we don't import Session or access agent internals
  mockProject.getSession.mockReturnValue(mockSession);

  const response = await GET(
    new NextRequest('http://localhost/api/projects/project1/sessions/session1'),
    { params: Promise.resolve({ projectId: 'project1', sessionId: 'session1' }) }
  );

  expect(response.status).toBe(200);
  
  // Should only use Project.getById and project.getSession
  expect(Project.getById).toHaveBeenCalledWith('project1');
  expect(mockProject.getSession).toHaveBeenCalledWith('session1');
});
```

**Run test to confirm failure**:
```bash
npm run test:run packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.test.ts
```

**Implementation** (make tests pass):
```typescript
// packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId, sessionId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const session = project.getSession(sessionId);
    if (!session) {
      return createErrorResponse('Session not found in this project', 404, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    // DELETE ALL TOKEN-RELATED CODE:
    // - Remove Session import
    // - Remove Session.getById() call
    // - Remove agent.getTokenUsage() calls
    // - Remove tokenUsage calculation
    // - Remove tokenUsage from response

    return createSuperjsonResponse({ session });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch session',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
```

### Task 2.2: Delete token-specific session tests
**File**: `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.token.test.ts`

**Action**: DELETE this entire file. Move tests to agent API.

```bash
rm packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.token.test.ts
```

## Phase 3: Update Agent API (Add Token Data)

### Goal: Agents return runtime data including token usage

### Task 3.1: Add token usage to agent GET endpoint
**File**: `packages/web/app/api/agents/[agentId]/route.ts`

**Write failing test first**:
```typescript
// packages/web/app/api/agents/[agentId]/__tests__/route.test.ts
// Add to existing describe block
it('should include token usage in agent response', async () => {
  // Mock agent with token usage
  const mockTokenUsage = {
    totalPromptTokens: 1000,
    totalCompletionTokens: 500,
    totalTokens: 1500,
    contextLimit: 200000,
    percentUsed: 0.75,
    nearLimit: false,
    eventCount: 5,
  };
  
  mockAgent.getTokenUsage = vi.fn().mockReturnValue(mockTokenUsage);

  const request = new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1');
  const response = await GET(request, {
    params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }),
  });
  const data = await parseResponse<AgentResponse>(response);

  expect(response.status).toBe(200);
  expect(data.agent.tokenUsage).toEqual(mockTokenUsage);
  expect(mockAgent.getTokenUsage).toHaveBeenCalled();
});

it('should handle agents without token budget manager gracefully', async () => {
  const defaultTokenUsage = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    contextLimit: 200000,
    percentUsed: 0,
    nearLimit: false,
    eventCount: 0,
  };
  
  mockAgent.getTokenUsage = vi.fn().mockReturnValue(defaultTokenUsage);

  const response = await GET(
    new NextRequest('http://localhost/api/agents/lace_20241122_abc123.1'),
    { params: Promise.resolve({ agentId: 'lace_20241122_abc123.1' }) }
  );
  const data = await parseResponse<AgentResponse>(response);

  expect(data.agent.tokenUsage).toEqual(defaultTokenUsage);
});
```

**Run test to confirm failure**:
```bash
npm run test:run packages/web/app/api/agents/[agentId]/__tests__/route.test.ts
```

**Implementation**:
```typescript
// packages/web/app/api/agents/[agentId]/route.ts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;

    if (!isValidThreadId(agentId)) {
      return createErrorResponse('Invalid agent ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const agentThreadId = asThreadId(agentId);
    const sessionId = asThreadId(agentThreadId.split('.')[0]);

    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const agent = session.getAgent(agentThreadId);

    if (!agent) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const metadata = agent.getThreadMetadata();
    const tokenUsage = agent.getTokenUsage(); // NEW

    const agentResponse = {
      threadId: agent.threadId,
      name: (metadata?.name as string) || 'Agent ' + agent.threadId,
      provider: (metadata?.provider as string) || agent.providerName,
      model: (metadata?.model as string) || (metadata?.modelId as string) || agent.model,
      providerInstanceId: (metadata?.providerInstanceId as string) || '',
      modelId: (metadata?.modelId as string) || (metadata?.model as string) || agent.model,
      status: agent.getCurrentState(),
      tokenUsage, // NEW
      createdAt: new Date(),
    };

    return createSuperjsonResponse({ agent: agentResponse });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch agent',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
```

### Task 3.2: Create comprehensive agent token tests
**File**: `packages/web/app/api/agents/[agentId]/__tests__/route.token.test.ts`

```typescript
// packages/web/app/api/agents/[agentId]/__tests__/route.token.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';
import {
  Project,
  Session,
  cleanupTestProviderInstances,
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '@/lib/server/lace-imports';
import { parseResponse } from '@/lib/serialization';
import type { AgentResponse } from '@/types/api';
import type { ThreadEvent } from '~/threads/types';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Agent API Token Usage', () => {
  let testProjectId: string;
  let testProject: InstanceType<typeof Project>;
  let cleanupFunctions: Array<() => void | Promise<void>> = [];
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lace-test-'));
    cleanupFunctions.push(async () => await rm(tempDir, { recursive: true, force: true }));

    await setupTestProviderDefaults();
    testProject = Project.create('Test Project', tempDir);
    testProjectId = testProject.getId();
    cleanupFunctions.push(() => testProject.delete());
  });

  afterEach(async () => {
    for (const cleanup of cleanupFunctions.reverse()) {
      await cleanup();
    }
    cleanupFunctions = [];
    await cleanupTestProviderInstances([]);
    await cleanupTestProviderDefaults();
    Session.clearRegistry();
  });

  it('should return current token usage statistics', async () => {
    const session = Session.create({
      name: 'Test Session',
      projectId: testProjectId,
      configuration: {
        providerInstanceId: 'anthropic-default',
        modelId: 'claude-3-5-haiku-20241022',
      },
    });
    cleanupFunctions.push(() => session.destroy());

    const agentId = session.getId();
    const agent = session.getAgent(agentId);
    if (!agent) throw new Error('Agent not found');
    const threadManager = agent.threadManager;

    // Add events with token usage to simulate conversation
    const events: ThreadEvent[] = [
      {
        id: 'evt_1',
        threadId: agentId,
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'Hello',
      },
      {
        id: 'evt_2',
        threadId: agentId,
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
        threadId: agentId,
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

    for (const event of events) {
      threadManager.addEvent(event.threadId, event.type, event.data);
    }

    const request = new NextRequest(`http://localhost/api/agents/${agentId}`);
    const response = await GET(request, {
      params: Promise.resolve({ agentId }),
    });

    expect(response.status).toBe(200);

    const data = await parseResponse<AgentResponse>(response);
    expect(data.agent).toBeDefined();
    expect(data.agent.tokenUsage).toEqual({
      totalPromptTokens: 300,
      totalCompletionTokens: 125,
      totalTokens: 425,
      eventCount: 2,
      percentUsed: expect.closeTo(0.2125, 2),
      nearLimit: false,
      contextLimit: 200000,
    });
  });

  it('should handle agents with no token usage data', async () => {
    const session = Session.create({
      name: 'Test Session Without Tokens',
      projectId: testProjectId,
      configuration: {
        providerInstanceId: 'anthropic-default',
        modelId: 'claude-3-5-haiku-20241022',
      },
    });
    cleanupFunctions.push(() => session.destroy());

    const agentId = session.getId();

    const request = new NextRequest(`http://localhost/api/agents/${agentId}`);
    const response = await GET(request, {
      params: Promise.resolve({ agentId }),
    });

    const data = await parseResponse<AgentResponse>(response);
    
    expect(data.agent.tokenUsage).toEqual({
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      contextLimit: 200000,
      percentUsed: 0,
      nearLimit: false,
      eventCount: 0,
    });
  });

  it('should reflect compaction effects on token usage', async () => {
    const session = Session.create({
      name: 'Test Compaction Session',
      projectId: testProjectId,
      configuration: {
        providerInstanceId: 'anthropic-default',
        modelId: 'claude-3-5-haiku-20241022',
      },
    });
    cleanupFunctions.push(() => session.destroy());

    const agentId = session.getId();
    const agent = session.getAgent(agentId);
    if (!agent) throw new Error('Agent not found');

    // Simulate pre-compaction high token usage
    agent.threadManager.addEvent(agentId, 'AGENT_MESSAGE', {
      content: 'Large response',
      tokenUsage: {
        promptTokens: 5000,
        completionTokens: 2000,
        totalTokens: 7000,
      },
    });

    // Simulate compaction
    agent.threadManager.addEvent(agentId, 'COMPACTION', {
      strategyId: 'summarize',
      originalEventCount: 1,
      compactedEvents: [{
        id: 'summary',
        threadId: agentId,
        type: 'AGENT_MESSAGE' as const,
        timestamp: new Date(),
        data: {
          content: 'Summary',
          tokenUsage: {
            promptTokens: 300,
            completionTokens: 200,
            totalTokens: 500,
          },
        },
      }],
    });

    const request = new NextRequest(`http://localhost/api/agents/${agentId}`);
    const response = await GET(request, {
      params: Promise.resolve({ agentId }),
    });

    const data = await parseResponse<AgentResponse>(response);
    
    // Should reflect post-compaction token counts
    expect(data.agent.tokenUsage?.totalTokens).toBe(500);
  });
});
```

## Phase 4: Update UI Layer

### Goal: UI uses agent API + SSE, never polls

### Task 4.1: Create token usage hook with SSE
**File**: `packages/web/hooks/useAgentTokens.ts`

**Write test first**:
```typescript
// packages/web/hooks/useAgentTokens.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgentTokens } from './useAgentTokens';

// Mock fetch
global.fetch = vi.fn();

// Mock EventSource
const mockEventSource = {
  addEventListener: vi.fn(),
  close: vi.fn(),
  removeEventListener: vi.fn(),
};

global.EventSource = vi.fn(() => mockEventSource);

describe('useAgentTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load initial token data from agent API', async () => {
    const mockAgentResponse = {
      agent: {
        tokenUsage: {
          totalTokens: 1500,
          totalPromptTokens: 1000,
          totalCompletionTokens: 500,
          nearLimit: false,
        }
      }
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockAgentResponse)
    });

    const { result } = renderHook(() => useAgentTokens('agent-123'));

    await waitFor(() => {
      expect(result.current?.totalTokens).toBe(1500);
    });

    expect(fetch).toHaveBeenCalledWith('/api/agents/agent-123');
  });

  it('should update token usage via SSE events', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ agent: { tokenUsage: { totalTokens: 1000 } } })
    });

    const { result } = renderHook(() => useAgentTokens('agent-123'));

    // Get the SSE event handler
    const eventHandler = mockEventSource.addEventListener.mock.calls
      .find(call => call[0] === 'AGENT_MESSAGE')?.[1];

    // Simulate SSE message with updated tokens
    eventHandler?.({
      data: JSON.stringify({
        type: 'AGENT_MESSAGE',
        data: {
          content: 'Updated response',
          tokenUsage: { totalTokens: 2000 }
        }
      })
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current?.totalTokens).toBe(2000);
    });
  });

  it('should clean up EventSource on unmount', () => {
    const { unmount } = renderHook(() => useAgentTokens('agent-123'));
    
    unmount();
    
    expect(mockEventSource.close).toHaveBeenCalled();
  });
});
```

**Implementation**:
```typescript
// packages/web/hooks/useAgentTokens.ts
import { useState, useEffect } from 'react';
import { parseResponse } from '@/lib/serialization';
import type { AgentResponse } from '@/types/api';

interface TokenUsage {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  contextLimit: number;
  percentUsed: number;
  nearLimit: boolean;
  eventCount: number;
  lastCompactionAt?: Date;
}

export function useAgentTokens(agentId: string | undefined): TokenUsage | null {
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);

  useEffect(() => {
    if (!agentId) return;

    // Initial load from agent API
    fetch(`/api/agents/${agentId}`)
      .then(response => parseResponse<AgentResponse>(response))
      .then(data => {
        if (data.agent.tokenUsage) {
          setTokenUsage(data.agent.tokenUsage);
        }
      })
      .catch(error => {
        console.warn('Failed to load initial token usage:', error);
      });

    // Real-time updates via SSE
    const eventSource = new EventSource(
      `/api/events/stream?threads=${agentId}&eventTypes=AGENT_MESSAGE,COMPACTION_COMPLETE`
    );

    const handleAgentMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'AGENT_MESSAGE' && data.data.tokenUsage) {
          setTokenUsage(data.data.tokenUsage);
        }
      } catch (error) {
        console.warn('Failed to parse SSE message:', error);
      }
    };

    const handleCompactionComplete = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'COMPACTION_COMPLETE' && data.data.success) {
          // Refetch token usage after compaction
          fetch(`/api/agents/${agentId}`)
            .then(response => parseResponse<AgentResponse>(response))
            .then(responseData => {
              if (responseData.agent.tokenUsage) {
                setTokenUsage(responseData.agent.tokenUsage);
              }
            })
            .catch(error => console.warn('Failed to refresh after compaction:', error));
        }
      } catch (error) {
        console.warn('Failed to handle compaction event:', error);
      }
    };

    eventSource.addEventListener('AGENT_MESSAGE', handleAgentMessage);
    eventSource.addEventListener('COMPACTION_COMPLETE', handleCompactionComplete);

    return () => {
      eventSource.removeEventListener('AGENT_MESSAGE', handleAgentMessage);
      eventSource.removeEventListener('COMPACTION_COMPLETE', handleCompactionComplete);
      eventSource.close();
    };
  }, [agentId]);

  return tokenUsage;
}
```

### Task 4.2: Create token badge component
**File**: `packages/web/components/TokenBadge.tsx`

**Write test first**:
```typescript
// packages/web/components/TokenBadge.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenBadge } from './TokenBadge';
import type { TokenUsage } from '@/hooks/useAgentTokens';

// Mock the hook
vi.mock('@/hooks/useAgentTokens', () => ({
  useAgentTokens: vi.fn(),
}));

import { useAgentTokens } from '@/hooks/useAgentTokens';

describe('TokenBadge', () => {
  it('should display token usage from hook', () => {
    const mockTokenUsage: TokenUsage = {
      totalTokens: 1500,
      totalPromptTokens: 1000,
      totalCompletionTokens: 500,
      nearLimit: false,
      percentUsed: 0.75,
      contextLimit: 200000,
      eventCount: 5,
    };
    
    vi.mocked(useAgentTokens).mockReturnValue(mockTokenUsage);

    render(<TokenBadge agentId="agent-123" />);
    
    expect(screen.getByText(/1,500 tokens/)).toBeInTheDocument();
  });

  it('should show warning when near limit', () => {
    const mockTokenUsage: TokenUsage = {
      totalTokens: 180000,
      totalPromptTokens: 120000,
      totalCompletionTokens: 60000,
      nearLimit: true,
      percentUsed: 90,
      contextLimit: 200000,
      eventCount: 50,
    };
    
    vi.mocked(useAgentTokens).mockReturnValue(mockTokenUsage);

    render(<TokenBadge agentId="agent-123" />);
    
    expect(screen.getByText(/180,000 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/⚠️/)).toBeInTheDocument();
  });

  it('should handle no token usage gracefully', () => {
    vi.mocked(useAgentTokens).mockReturnValue(null);

    render(<TokenBadge agentId="agent-123" />);
    
    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument();
  });
});
```

**Implementation**:
```typescript
// packages/web/components/TokenBadge.tsx
import { useAgentTokens } from '@/hooks/useAgentTokens';
import { Badge } from '@/components/ui/badge';

interface TokenBadgeProps {
  agentId: string;
  className?: string;
}

export function TokenBadge({ agentId, className }: TokenBadgeProps) {
  const tokenUsage = useAgentTokens(agentId);

  if (!tokenUsage) return null;

  const variant = tokenUsage.nearLimit ? 'destructive' : 'secondary';
  const formattedTokens = tokenUsage.totalTokens.toLocaleString();

  return (
    <Badge variant={variant} className={className}>
      {formattedTokens} tokens
      {tokenUsage.nearLimit && ' ⚠️'}
    </Badge>
  );
}
```

## Phase 5: Integration Testing

### Task 5.1: End-to-end token flow test
**File**: `packages/web/__tests__/integration/token-flow.e2e.test.ts`

```typescript
// packages/web/__tests__/integration/token-flow.e2e.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseResponse } from '@/lib/serialization';
import {
  Project,
  Session,
  cleanupTestProviderInstances,
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '@/lib/server/lace-imports';
import type { SessionResponse, AgentResponse } from '@/types/api';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Token Usage E2E Flow', () => {
  let testProjectId: string;
  let testProject: InstanceType<typeof Project>;
  let cleanupFunctions: Array<() => void | Promise<void>> = [];
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lace-test-'));
    cleanupFunctions.push(async () => await rm(tempDir, { recursive: true, force: true }));

    await setupTestProviderDefaults();
    testProject = Project.create('E2E Test Project', tempDir);
    testProjectId = testProject.getId();
    cleanupFunctions.push(() => testProject.delete());
  });

  afterEach(async () => {
    for (const cleanup of cleanupFunctions.reverse()) {
      await cleanup();
    }
    cleanupFunctions = [];
    await cleanupTestProviderInstances([]);
    await cleanupTestProviderDefaults();
    Session.clearRegistry();
  });

  it('should maintain proper separation between session and agent APIs', async () => {
    // Create session
    const session = Session.create({
      name: 'E2E Test Session',
      projectId: testProjectId,
      configuration: {
        providerInstanceId: 'anthropic-default',
        modelId: 'claude-3-5-haiku-20241022',
      },
    });
    cleanupFunctions.push(() => session.destroy());

    const sessionId = session.getId();
    const agentId = sessionId; // Main agent has same ID as session

    // Test session API - should NOT have token data
    const sessionResponse = await fetch(`/api/projects/${testProjectId}/sessions/${sessionId}`);
    const sessionData = await parseResponse<SessionResponse>(sessionResponse);

    expect(sessionResponse.status).toBe(200);
    expect(sessionData.session).toBeDefined();
    expect('tokenUsage' in sessionData).toBe(false);

    // Test agent API - should HAVE token data
    const agentResponse = await fetch(`/api/agents/${agentId}`);
    const agentData = await parseResponse<AgentResponse>(agentResponse);

    expect(agentResponse.status).toBe(200);
    expect(agentData.agent.tokenUsage).toBeDefined();
    expect(typeof agentData.agent.tokenUsage?.totalTokens).toBe('number');
  });

  it('should reflect token changes in agent API after message activity', async () => {
    const session = Session.create({
      name: 'Token Update Test',
      projectId: testProjectId,
      configuration: {
        providerInstanceId: 'anthropic-default',
        modelId: 'claude-3-5-haiku-20241022',
      },
    });
    cleanupFunctions.push(() => session.destroy());

    const agentId = session.getId();
    const agent = session.getAgent(agentId);
    if (!agent) throw new Error('Agent not found');

    // Initial token usage should be zero
    let agentResponse = await fetch(`/api/agents/${agentId}`);
    let agentData = await parseResponse<AgentResponse>(agentResponse);
    expect(agentData.agent.tokenUsage?.totalTokens).toBe(0);

    // Add message with token usage
    agent.threadManager.addEvent(agentId, 'AGENT_MESSAGE', {
      content: 'Test response',
      tokenUsage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
    });

    // Token usage should now reflect the message
    agentResponse = await fetch(`/api/agents/${agentId}`);
    agentData = await parseResponse<AgentResponse>(agentResponse);
    expect(agentData.agent.tokenUsage?.totalTokens).toBe(150);
  });
});
```

## Phase 6: Cleanup

### Task 6.1: Remove unused imports and code
**Search and cleanup**:
```bash
# Find any remaining session-based token usage
grep -r "tokenUsage" packages/web/app/api/projects/\*/sessions/ --include="*.ts" --include="*.tsx"

# Find unused imports
grep -r "aggregateTokenUsage" packages/web/ --include="*.ts" --include="*.tsx"
grep -r "Session.*getById" packages/web/app/api/projects/\*/sessions/ --include="*.ts"
```

### Task 6.2: Update existing components
**Find components that might use session token data**:
```bash
grep -r "session.*tokenUsage" packages/web/components/ --include="*.tsx" --include="*.ts"
```

**Update each component to**:
- Remove session token usage
- Use TokenBadge component or useAgentTokens hook instead
- Follow established patterns for component updates

## Success Criteria

✅ Session API returns only session metadata (no tokenUsage field)  
✅ Agent API includes current token usage snapshot  
✅ UI receives real-time token updates via SSE (no polling)  
✅ All tests pass with new architecture  
✅ No backward compatibility code  
✅ TypeScript strict mode compliance  
✅ Proper use of createSuperjsonResponse() and parseResponse()  
✅ Established testing patterns followed throughout

## Migration Notes

**Breaking changes**:
- `SessionResponse.tokenUsage` field removed
- `AgentResponse.tokenUsage` field added  
- Components using session token data must be updated
- Tests must be updated to match new API contracts

**For developers**:
- Use agent API (`GET /api/agents/{id}`) for initial token state
- Use `useAgentTokens(agentId)` hook for real-time updates
- SSE events automatically provide token updates with messages
- No more polling patterns needed