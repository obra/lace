# Token Counting & Compaction Fix Implementation Plan

## Overview
This plan fixes critical architectural issues in the token counting and compaction system. Currently, we have two parallel token tracking systems that don't communicate, neither understands compaction, and token counts are calculated at the wrong architectural layer. This plan provides a complete fix with no backward compatibility - we're making it right.

## CRITICAL: Read This First

### Prerequisites
1. **Read these files completely before starting**:
   - `docs/plans/2025-08-08/compaction.md` - Original compaction plan to understand intent
   - `src/threads/types.ts` - Event system and types
   - `src/agents/agent.ts` - Agent class structure
   - `CLAUDE.md` - Coding standards (MANDATORY)

2. **Understand these concepts**:
   - **Event Sourcing**: All conversation state is stored as immutable events
   - **Compaction**: Replacing old events with a summary to save tokens
   - **Token**: Unit of text AI models process (~4 characters)
   - **Context Window**: Maximum tokens a model can process (e.g., 200K for Claude)

### Development Rules (MANDATORY)
1. **NO `any` types EVER** - Use `unknown` with type guards instead
2. **NO mocking the functionality under test** - Test real code paths
3. **Write tests FIRST** - TDD is required, not optional
4. **Small commits** - One logical change per commit
5. **YAGNI** - Don't add features not in this plan
6. **DRY** - Don't duplicate code

### TypeScript Help
If you're not familiar with TypeScript:
- **Never use `any`**: `let data: any = ...` ❌
- **Use `unknown` instead**: `let data: unknown = ...` ✅
- **Type guards**: Check types before using them
```typescript
// BAD - using any
function process(data: any) {
  return data.value; // No type safety
}

// GOOD - using unknown with type guard
function process(data: unknown) {
  if (typeof data === 'object' && data !== null && 'value' in data) {
    return (data as { value: string }).value;
  }
  throw new Error('Invalid data');
}
```

### Testing Philosophy
- **Test behavior, not implementation**
- **Use real objects, not mocks** (except for external APIs)
- **Each test should test ONE thing**
- **Test names should describe what they test**

### How to Run Tests
```bash
# Run specific test file
npm run test:run src/token-management/token-budget-manager.test.ts

# Run all tests in a directory
npm run test:run src/token-management/

# Run tests in watch mode (reruns on file changes)
npm test src/token-management/

# Check your code before committing
npm run lint        # Check for code issues
npm run typecheck   # Check TypeScript types
npm run test:run    # Run all tests
```

## The Problem Summary

We have a broken token counting system with these issues:

1. **Two parallel token tracking systems** that don't agree:
   - `TokenBudgetManager` in Agent (tracks incrementally)
   - `aggregateTokenUsage` in threads (recalculates from scratch)

2. **Neither system understands compaction**:
   - Both count original events AND their summaries
   - Token counts increase after compaction instead of decreasing

3. **Wrong architectural layer**:
   - Session API calculates tokens (sessions don't have tokens!)
   - Should be Agent's responsibility

4. **Direct access to internals**:
   - Session API reaches into Agent's threadManager directly
   - Breaks encapsulation

## The Solution Architecture

### Correct Responsibilities
- **Agent**: Owns token state, provides `getTokenUsage()` method
- **TokenBudgetManager**: Tracks tokens, understands compaction
- **Session API**: Asks Agent for token info, doesn't calculate
- **aggregateTokenUsage**: Used ONLY for compaction analysis, not reporting

### Correct Data Flow
```
User asks for token info → Session API → Agent.getTokenUsage() → TokenBudgetManager
                                            ↑
                                    Single source of truth
```

---

## Phase 1: Make TokenBudgetManager Compaction-Aware

### Task 1.1: Add Compaction Handling to TokenBudgetManager

**Goal**: Make TokenBudgetManager understand when compaction happens and recalculate tokens correctly.

**Files to modify**:
- `src/token-management/token-budget-manager.ts` - Add compaction handling
- `src/token-management/token-budget-manager.test.ts` - Add tests for compaction

**What you need to know**:
- TokenBudgetManager currently just adds up tokens incrementally
- After compaction, it needs to reset and count only post-compaction events
- The `COMPACTION` event contains `compactedEvents` which is the summary

**Step 1: Write the test FIRST** (`src/token-management/token-budget-manager.test.ts`):
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { TokenBudgetManager } from './token-budget-manager';
import type { ThreadEvent } from '~/threads/types';

describe('TokenBudgetManager compaction handling', () => {
  let manager: TokenBudgetManager;

  beforeEach(() => {
    manager = new TokenBudgetManager({
      maxTokens: 10000,
      reserveTokens: 1000,
      warningThreshold: 0.8
    });
  });

  it('should reset token counts after compaction', () => {
    // Record some usage before compaction
    manager.recordUsage({
      promptTokens: 5000,
      completionTokens: 2000,
      totalTokens: 7000
    });
    
    expect(manager.getTotalUsage()).toBe(7000);
    
    // Handle compaction event with summary
    const compactionData = {
      strategyId: 'summarize',
      originalEventCount: 50,
      compactedEvents: [
        {
          id: 'summary',
          threadId: 'thread_123',
          type: 'AGENT_MESSAGE' as const,
          timestamp: new Date(),
          data: {
            content: 'Summary of conversation',
            tokenUsage: {
              promptTokens: 300,
              completionTokens: 200,
              totalTokens: 500
            }
          }
        }
      ]
    };
    
    manager.handleCompaction(compactionData);
    
    // Should now only have the summary tokens
    expect(manager.getTotalUsage()).toBe(500);
    expect(manager.getPromptTokens()).toBe(300);
    expect(manager.getCompletionTokens()).toBe(200);
  });

  it('should continue tracking after compaction', () => {
    // Initial usage
    manager.recordUsage({
      promptTokens: 5000,
      completionTokens: 2000,
      totalTokens: 7000
    });
    
    // Compact
    manager.handleCompaction({
      strategyId: 'summarize',
      originalEventCount: 50,
      compactedEvents: [{
        id: 'summary',
        threadId: 'thread_123',
        type: 'AGENT_MESSAGE' as const,
        timestamp: new Date(),
        data: {
          content: 'Summary',
          tokenUsage: {
            promptTokens: 300,
            completionTokens: 200,
            totalTokens: 500
          }
        }
      }]
    });
    
    // Add more usage after compaction
    manager.recordUsage({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150
    });
    
    // Should be summary + new usage
    expect(manager.getTotalUsage()).toBe(650); // 500 + 150
  });
});
```

**Step 2: Run the test to see it fail**:
```bash
npm run test:run src/token-management/token-budget-manager.test.ts
```
The test should fail because `handleCompaction` doesn't exist yet.

**Step 3: Implement the feature** (`src/token-management/token-budget-manager.ts`):

Add these to the imports at the top:
```typescript
import type { CompactionData } from '~/threads/compaction/types';
import type { ThreadEvent } from '~/threads/types';
```

Add this method to the TokenBudgetManager class:
```typescript
/**
 * Handles compaction by resetting token counts to post-compaction state
 */
handleCompaction(compactionData: CompactionData): void {
  // Reset counts to zero
  this._totalUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  
  // Add token usage from compacted events (the summary)
  for (const event of compactionData.compactedEvents) {
    if (event.type === 'AGENT_MESSAGE' && event.data.tokenUsage) {
      this._totalUsage.promptTokens += event.data.tokenUsage.promptTokens;
      this._totalUsage.completionTokens += event.data.tokenUsage.completionTokens;
      this._totalUsage.totalTokens += event.data.tokenUsage.totalTokens;
    }
  }
  
  logger.debug('Token budget reset after compaction', {
    compactionStrategy: compactionData.strategyId,
    originalEventCount: compactionData.originalEventCount,
    newUsage: this._totalUsage,
  });
}
```

**Step 4: Run the test again to see it pass**:
```bash
npm run test:run src/token-management/token-budget-manager.test.ts
```

**Step 5: Commit your work**:
```bash
git add -A
git commit -m "feat: add compaction handling to TokenBudgetManager

TokenBudgetManager now resets token counts when compaction occurs,
tracking only the summary tokens plus any new events after compaction."
```

---

### Task 1.2: Connect Agent to TokenBudgetManager Compaction

**Goal**: Make Agent notify TokenBudgetManager when compaction happens.

**Files to modify**:
- `src/agents/agent.ts` - Call handleCompaction after compacting
- `src/agents/agent-compaction-tokens.test.ts` - Test the integration

**What you need to know**:
- Agent has a `compact()` method that performs compaction
- Agent has a `_tokenBudgetManager` that needs to be notified
- The compaction creates a `COMPACTION` event in the thread

**Step 1: Write the test FIRST** (`src/agents/agent-compaction-tokens.test.ts`):
```typescript
// ABOUTME: Tests for Agent notifying TokenBudgetManager about compaction
// ABOUTME: Ensures token counts are properly reset after compaction

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { MockProvider } from '~/test-utils/mock-provider';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { ToolExecutor } from '~/tools/tool-executor';

describe('Agent compaction token management', () => {
  setupCoreTest();
  let agent: Agent;
  let threadManager: ThreadManager;
  let provider: MockProvider;

  beforeEach(async () => {
    threadManager = new ThreadManager();
    
    // Create provider that returns token usage
    provider = new MockProvider({
      responses: [
        {
          content: 'First response',
          toolCalls: [],
          usage: {
            promptTokens: 5000,
            completionTokens: 2000,
            totalTokens: 7000
          }
        },
        {
          content: 'Summary: Previous conversation was about testing',
          toolCalls: [],
          usage: {
            promptTokens: 300,
            completionTokens: 200,
            totalTokens: 500
          }
        }
      ]
    });
    
    // Create agent with token budget
    agent = new Agent({
      provider,
      threadManager,
      toolExecutor: new ToolExecutor([]),
      model: 'test-model',
      tokenBudget: {
        maxTokens: 10000,
        reserveTokens: 1000,
        warningThreshold: 0.8
      }
    });
    
    await agent.start();
  });

  it('should reset TokenBudgetManager after compaction', async () => {
    // Send first message to accumulate tokens
    await agent.sendMessage('Test message');
    
    // Check token usage before compaction
    const budgetBefore = agent.tokenBudgetManager?.getBudgetStatus();
    expect(budgetBefore?.totalUsed).toBe(7000);
    
    // Trigger compaction
    await agent.sendMessage('/compact');
    
    // Wait for compaction to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check token usage after compaction
    const budgetAfter = agent.tokenBudgetManager?.getBudgetStatus();
    
    // Should only have summary tokens now
    expect(budgetAfter?.totalUsed).toBe(500);
  });
});
```

**Step 2: Run the test to see it fail**:
```bash
npm run test:run src/agents/agent-compaction-tokens.test.ts
```

**Step 3: Implement the feature** (`src/agents/agent.ts`):

Find the `compact` method in agent.ts (around line 850-900). After the compaction is done and the COMPACTION event is added, add this code:

```typescript
async compact(threadId: string): Promise<void> {
  // ... existing compaction code ...
  
  // After threadManager.compact() is called and succeeds:
  
  // Get the compaction event that was just added
  const events = this._threadManager.getEvents(threadId);
  const compactionEvent = events.find(e => e.type === 'COMPACTION');
  
  if (compactionEvent && this._tokenBudgetManager) {
    // Notify TokenBudgetManager about the compaction
    this._tokenBudgetManager.handleCompaction(compactionEvent.data);
  }
  
  // ... rest of the method ...
}
```

**Step 4: Run the test again**:
```bash
npm run test:run src/agents/agent-compaction-tokens.test.ts
```

**Step 5: Commit**:
```bash
git add -A
git commit -m "feat: notify TokenBudgetManager when compaction occurs

Agent now tells TokenBudgetManager about compaction events so token
counts can be properly reset to post-compaction values."
```

---

## Phase 2: Add Agent Token Usage API

### Task 2.1: Create Agent.getTokenUsage() Method

**Goal**: Add a public method to Agent that returns current token usage from TokenBudgetManager.

**Files to modify**:
- `src/agents/agent.ts` - Add getTokenUsage() method
- `src/agents/agent-token-api.test.ts` - Test the new API

**What you need to know**:
- Agent has a `tokenBudgetManager` property (might be null)
- We need a clean API that session endpoints can call
- Should return useful info even if no token budget manager

**Step 1: Write the test FIRST** (`src/agents/agent-token-api.test.ts`):
```typescript
// ABOUTME: Tests for Agent.getTokenUsage() public API
// ABOUTME: Ensures agents properly expose their token usage information

import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { MockProvider } from '~/test-utils/mock-provider';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { ToolExecutor } from '~/tools/tool-executor';

describe('Agent getTokenUsage API', () => {
  setupCoreTest();
  let agent: Agent;
  let threadManager: ThreadManager;

  beforeEach(async () => {
    threadManager = new ThreadManager();
    const provider = new MockProvider({
      responses: [{
        content: 'Test response',
        toolCalls: [],
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150
        }
      }]
    });
    
    agent = new Agent({
      provider,
      threadManager,
      toolExecutor: new ToolExecutor([]),
      model: 'test-model',
      tokenBudget: {
        maxTokens: 10000,
        reserveTokens: 1000,
        warningThreshold: 0.8
      }
    });
    
    await agent.start();
  });

  it('should return token usage information', async () => {
    // Initially should be zero
    let usage = agent.getTokenUsage();
    expect(usage.totalTokens).toBe(0);
    expect(usage.totalPromptTokens).toBe(0);
    expect(usage.totalCompletionTokens).toBe(0);
    expect(usage.contextLimit).toBe(10000);
    expect(usage.percentUsed).toBe(0);
    expect(usage.nearLimit).toBe(false);
    
    // Send a message
    await agent.sendMessage('Hello');
    
    // Should now have token usage
    usage = agent.getTokenUsage();
    expect(usage.totalTokens).toBe(150);
    expect(usage.totalPromptTokens).toBe(100);
    expect(usage.totalCompletionTokens).toBe(50);
    expect(usage.percentUsed).toBe(1.5); // 150/10000 * 100
    expect(usage.nearLimit).toBe(false);
  });

  it('should handle missing token budget manager', () => {
    // Create agent without token budget
    const agentNoBudget = new Agent({
      provider: new MockProvider(),
      threadManager,
      toolExecutor: new ToolExecutor([]),
      model: 'test-model'
      // No tokenBudget specified
    });
    
    const usage = agentNoBudget.getTokenUsage();
    
    // Should return sensible defaults
    expect(usage.totalTokens).toBe(0);
    expect(usage.contextLimit).toBe(200000); // Default
    expect(usage.percentUsed).toBe(0);
    expect(usage.nearLimit).toBe(false);
  });
});
```

**Step 2: Define the return type** (`src/agents/agent.ts`):

Add this type definition near the top of the file, after the imports:
```typescript
export interface AgentTokenUsage {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  contextLimit: number;
  percentUsed: number;
  nearLimit: boolean;
  eventCount?: number;
}
```

**Step 3: Implement the method** (`src/agents/agent.ts`):

Add this public method to the Agent class:
```typescript
/**
 * Gets current token usage information for this agent
 */
getTokenUsage(): AgentTokenUsage {
  if (this._tokenBudgetManager) {
    const budget = this._tokenBudgetManager.getBudgetStatus();
    return {
      totalPromptTokens: budget.promptTokens,
      totalCompletionTokens: budget.completionTokens,
      totalTokens: budget.totalUsed,
      contextLimit: budget.maxTokens,
      percentUsed: budget.usagePercentage * 100,
      nearLimit: budget.warningTriggered
    };
  }
  
  // Return defaults if no token budget manager
  return {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    contextLimit: 200000, // Default context limit
    percentUsed: 0,
    nearLimit: false
  };
}
```

**Step 4: Run tests**:
```bash
npm run test:run src/agents/agent-token-api.test.ts
```

**Step 5: Commit**:
```bash
git add -A
git commit -m "feat: add getTokenUsage() method to Agent

Agents now expose their token usage through a clean public API
instead of requiring external code to access internal state."
```

---

## Phase 3: Fix Session API

### Task 3.1: Remove Token Calculation from Session API

**Goal**: Stop the session API from calculating tokens itself. Use Agent.getTokenUsage() instead.

**Files to modify**:
- `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.ts` - Remove aggregateTokenUsage
- `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.test.ts` - Update tests

**What you need to know**:
- Session API currently reaches into agent.threadManager.getEvents()
- It uses aggregateTokenUsage() to calculate tokens
- We need to replace this with agent.getTokenUsage()

**Step 1: Look at the current bad code** (`packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.ts`):

Find this section (around line 45-60):
```typescript
// Current BAD code:
const mainAgent = sessionInstance.getAgent(sessionInstance.getId());
if (mainAgent) {
  const events = mainAgent.threadManager.getEvents(mainAgent.threadId);
  const tokenSummary = aggregateTokenUsage(events);
  // ... calculate tokenUsage ...
}
```

**Step 2: Write a test for the new behavior** (`packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.test.ts`):

Add this test:
```typescript
it('should get token usage from agent not calculate it', async () => {
  // This test verifies we're using Agent.getTokenUsage() 
  // instead of aggregateTokenUsage()
  
  const session = Session.create({
    name: 'Test Session',
    projectId: testProjectId,
    configuration: {
      providerInstanceId: 'anthropic-default',
      modelId: 'claude-3-5-haiku-20241022',
    },
  });
  
  const sessionId = session.getId();
  const agent = session.getAgent(sessionId);
  
  // Spy on the agent's getTokenUsage method
  const getTokenUsageSpy = vi.spyOn(agent, 'getTokenUsage');
  getTokenUsageSpy.mockReturnValue({
    totalPromptTokens: 100,
    totalCompletionTokens: 50,
    totalTokens: 150,
    contextLimit: 10000,
    percentUsed: 1.5,
    nearLimit: false
  });
  
  // Make the API request
  const request = new NextRequest(
    `http://localhost:3000/api/projects/${testProjectId}/sessions/${sessionId}`
  );
  const response = await GET(request, {
    params: Promise.resolve({ projectId: testProjectId, sessionId }),
  });
  
  // Should have called agent.getTokenUsage()
  expect(getTokenUsageSpy).toHaveBeenCalled();
  
  const body = await parseResponse(response);
  expect(body.tokenUsage).toMatchObject({
    totalPromptTokens: 100,
    totalCompletionTokens: 50,
    totalTokens: 150
  });
});
```

**Step 3: Replace the bad code** (`packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.ts`):

Remove the import:
```typescript
// DELETE THIS LINE:
import { aggregateTokenUsage } from '~/threads/token-aggregation';
```

Replace the token calculation section:
```typescript
// Get token usage information if available
let tokenUsage = undefined;
try {
  // Get the session instance to access agents
  const { Session } = await import('@/lib/server/lace-imports');
  const sessionInstance = await Session.getById(asThreadId(sessionId));
  if (sessionInstance) {
    const mainAgent = sessionInstance.getAgent(sessionInstance.getId());
    if (mainAgent) {
      // Use the agent's token usage API instead of calculating ourselves
      const agentUsage = mainAgent.getTokenUsage();
      tokenUsage = {
        totalPromptTokens: agentUsage.totalPromptTokens,
        totalCompletionTokens: agentUsage.totalCompletionTokens,
        totalTokens: agentUsage.totalTokens,
        contextLimit: agentUsage.contextLimit,
        percentUsed: agentUsage.percentUsed,
        nearLimit: agentUsage.nearLimit,
        eventCount: 0 // Not needed anymore
      };
    }
  }
} catch (tokenError) {
  // Log but don't fail the request if token calculation fails
  console.warn('Failed to get token usage:', tokenError);
}
```

**Step 4: Run tests**:
```bash
npm run test:run packages/web/app/api/projects/[projectId]/sessions/[sessionId]/
```

**Step 5: Commit**:
```bash
git add -A
git commit -m "refactor: use Agent.getTokenUsage() instead of calculating in session API

Session API now properly delegates token counting to the Agent
instead of accessing internal state and duplicating logic."
```

---

## Phase 4: Fix aggregateTokenUsage for Compaction

### Task 4.1: Make aggregateTokenUsage Compaction-Aware

**Goal**: Fix aggregateTokenUsage to understand compaction events (for its real purpose: compaction analysis).

**Files to modify**:
- `src/threads/token-aggregation.ts` - Make it understand compaction
- `src/threads/token-aggregation.test.ts` - Add compaction tests

**What you need to know**:
- This function should ONLY be used for compaction analysis
- It needs to understand that events before COMPACTION should be ignored
- The COMPACTION event contains the summary in `compactedEvents`

**Step 1: Write the test** (`src/threads/token-aggregation.test.ts`):

Add these tests:
```typescript
describe('Token aggregation with compaction', () => {
  it('should only count events after compaction plus summary', () => {
    const events: ThreadEvent[] = [
      // Original events (before compaction)
      {
        id: '1',
        threadId: 'test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01'),
        data: {
          content: 'Old response 1',
          tokenUsage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 }
        }
      },
      {
        id: '2',
        threadId: 'test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-02'),
        data: {
          content: 'Old response 2',
          tokenUsage: { promptTokens: 2000, completionTokens: 1000, totalTokens: 3000 }
        }
      },
      // Compaction event
      {
        id: '3',
        threadId: 'test',
        type: 'COMPACTION',
        timestamp: new Date('2024-01-03'),
        data: {
          strategyId: 'summarize',
          originalEventCount: 2,
          compactedEvents: [
            {
              id: 'summary',
              threadId: 'test',
              type: 'AGENT_MESSAGE' as const,
              timestamp: new Date('2024-01-03'),
              data: {
                content: 'Summary of conversation',
                tokenUsage: { promptTokens: 300, completionTokens: 200, totalTokens: 500 }
              }
            }
          ]
        }
      },
      // New events after compaction
      {
        id: '4',
        threadId: 'test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-04'),
        data: {
          content: 'New response',
          tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
        }
      }
    ];

    const summary = aggregateTokenUsage(events);
    
    // Should be: summary (500) + new event (150) = 650
    // NOT: old1 (1500) + old2 (3000) + summary (500) + new (150) = 5150
    expect(summary.totalTokens).toBe(650);
    expect(summary.totalPromptTokens).toBe(400); // 300 + 100
    expect(summary.totalCompletionTokens).toBe(250); // 200 + 50
    expect(summary.eventCount).toBe(2); // summary + new event
  });

  it('should handle multiple compactions', () => {
    const events: ThreadEvent[] = [
      // First round
      {
        id: '1',
        threadId: 'test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01'),
        data: {
          content: 'Response 1',
          tokenUsage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 }
        }
      },
      // First compaction
      {
        id: '2',
        threadId: 'test',
        type: 'COMPACTION',
        timestamp: new Date('2024-01-02'),
        data: {
          strategyId: 'summarize',
          originalEventCount: 1,
          compactedEvents: [{
            id: 's1',
            threadId: 'test',
            type: 'AGENT_MESSAGE' as const,
            timestamp: new Date('2024-01-02'),
            data: {
              content: 'First summary',
              tokenUsage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 }
            }
          }]
        }
      },
      // More events
      {
        id: '3',
        threadId: 'test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-03'),
        data: {
          content: 'Response 2',
          tokenUsage: { promptTokens: 500, completionTokens: 250, totalTokens: 750 }
        }
      },
      // Second compaction
      {
        id: '4',
        threadId: 'test',
        type: 'COMPACTION',
        timestamp: new Date('2024-01-04'),
        data: {
          strategyId: 'summarize',
          originalEventCount: 2,
          compactedEvents: [{
            id: 's2',
            threadId: 'test',
            type: 'AGENT_MESSAGE' as const,
            timestamp: new Date('2024-01-04'),
            data: {
              content: 'Second summary',
              tokenUsage: { promptTokens: 150, completionTokens: 75, totalTokens: 225 }
            }
          }]
        }
      }
    ];

    const summary = aggregateTokenUsage(events);
    
    // Should only count the latest compaction summary
    expect(summary.totalTokens).toBe(225);
    expect(summary.eventCount).toBe(1);
  });
});
```

**Step 2: Update the implementation** (`src/threads/token-aggregation.ts`):

Replace the entire `aggregateTokenUsage` function:
```typescript
export function aggregateTokenUsage(events: ThreadEvent[]): TokenSummary {
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let eventCount = 0;

  // Find the last compaction event
  let lastCompactionIndex = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'COMPACTION') {
      lastCompactionIndex = i;
      break;
    }
  }

  // If there was a compaction, start counting from there
  if (lastCompactionIndex >= 0) {
    const compactionEvent = events[lastCompactionIndex];
    
    // Add tokens from the compacted events (the summary)
    if (compactionEvent.type === 'COMPACTION') {
      for (const compactedEvent of compactionEvent.data.compactedEvents) {
        if (compactedEvent.type === 'AGENT_MESSAGE' && compactedEvent.data.tokenUsage) {
          totalPromptTokens += compactedEvent.data.tokenUsage.promptTokens;
          totalCompletionTokens += compactedEvent.data.tokenUsage.completionTokens;
          eventCount++;
        }
      }
    }
    
    // Add tokens from events after compaction
    for (let i = lastCompactionIndex + 1; i < events.length; i++) {
      const event = events[i];
      if (event.type === 'AGENT_MESSAGE' && event.data.tokenUsage) {
        totalPromptTokens += event.data.tokenUsage.promptTokens;
        totalCompletionTokens += event.data.tokenUsage.completionTokens;
        eventCount++;
      } else if (event.type === 'TOOL_RESULT' && 'tokenUsage' in event.data && event.data.tokenUsage) {
        totalPromptTokens += event.data.tokenUsage.promptTokens;
        totalCompletionTokens += event.data.tokenUsage.completionTokens;
        eventCount++;
      }
    }
  } else {
    // No compaction, count all events as before
    for (const event of events) {
      if (event.type === 'AGENT_MESSAGE' && event.data.tokenUsage) {
        totalPromptTokens += event.data.tokenUsage.promptTokens;
        totalCompletionTokens += event.data.tokenUsage.completionTokens;
        eventCount++;
      } else if (event.type === 'TOOL_RESULT' && 'tokenUsage' in event.data && event.data.tokenUsage) {
        totalPromptTokens += event.data.tokenUsage.promptTokens;
        totalCompletionTokens += event.data.tokenUsage.completionTokens;
        eventCount++;
      }
    }
  }

  return {
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens: totalPromptTokens + totalCompletionTokens,
    eventCount
  };
}
```

**Step 3: Add a deprecation comment** (top of `src/threads/token-aggregation.ts`):

```typescript
/**
 * @deprecated This module should ONLY be used for compaction analysis,
 * not for reporting current token usage. Use Agent.getTokenUsage() instead.
 * 
 * These utilities analyze token patterns to help the compaction system
 * decide when to trigger compaction. They are NOT for current state reporting.
 */
```

**Step 4: Run tests**:
```bash
npm run test:run src/threads/token-aggregation.test.ts
```

**Step 5: Commit**:
```bash
git add -A
git commit -m "fix: make aggregateTokenUsage understand compaction events

The function now correctly counts only post-compaction events plus
the summary, not all events. Added deprecation notice to clarify
this is only for compaction analysis, not current state reporting."
```

---

## Phase 5: Fix E2E Test

### Task 5.1: Verify E2E Test Now Passes

**Goal**: The compaction e2e test should now show <80% token usage after compaction.

**Files to check**:
- `packages/web/app/api/compaction.e2e.test.ts` - Should now pass

**Step 1: Run the previously failing test**:
```bash
npm run test:run packages/web/app/api/compaction.e2e.test.ts
```

The test "should trigger auto-compaction when approaching token limit and emit proper events" should now pass with token usage below 80% after compaction.

**Step 2: If it still fails**, debug by adding logging:

Add this to the test to see what's happening:
```typescript
// After compaction, before checking token usage
const events = agent.threadManager.getEvents(agent.threadId);
console.log('Events after compaction:', events.map(e => ({
  type: e.type,
  tokens: e.type === 'AGENT_MESSAGE' ? e.data.tokenUsage : undefined
})));

const tokenUsage = agent.getTokenUsage();
console.log('Token usage from agent:', tokenUsage);
```

**Step 3: Commit when test passes**:
```bash
git add -A
git commit -m "fix: e2e test now correctly shows reduced token usage after compaction

Token usage properly drops below 80% after compaction as expected."
```

---

## Phase 6: Cleanup and Documentation

### Task 6.1: Remove Unused Code

**Goal**: Remove any code that's no longer needed.

**What to check**:
1. Are there any other places using `aggregateTokenUsage` that shouldn't be?
2. Are there any duplicate token tracking utilities?

**Step 1: Search for usage**:
```bash
# Find all uses of aggregateTokenUsage
grep -r "aggregateTokenUsage" packages/ src/ --include="*.ts" --include="*.tsx"
```

If you find usage outside of:
- `src/threads/token-aggregation.ts` (the implementation)
- `src/threads/token-aggregation.test.ts` (the tests)
- Compaction-related code

Then it needs to be removed or replaced with `Agent.getTokenUsage()`.

**Step 2: Commit any cleanups**:
```bash
git add -A
git commit -m "chore: remove unused token aggregation calls"
```

---

### Task 6.2: Update Documentation

**Goal**: Document the correct architecture.

**Create file**: `docs/architecture/token-counting.md`

```markdown
# Token Counting Architecture

## Overview
Token counting in Lace follows a clear single-source-of-truth pattern where each Agent manages its own token state through the TokenBudgetManager.

## Correct Architecture

### Responsibilities
- **Agent**: Owns token state, provides `getTokenUsage()` method
- **TokenBudgetManager**: Tracks tokens incrementally, handles compaction
- **Session API**: Requests token info from Agent (doesn't calculate)
- **aggregateTokenUsage**: Used ONLY for compaction analysis

### Data Flow
```
Client → Session API → Agent.getTokenUsage() → TokenBudgetManager
                           ↑
                    Single source of truth
```

## Key Principles

1. **Single Source of Truth**: Only TokenBudgetManager tracks current token state
2. **Encapsulation**: External code uses Agent.getTokenUsage(), never accesses internals
3. **Compaction Awareness**: Token counts reset to summary values after compaction
4. **Layer Separation**: Sessions don't have tokens, agents do

## Anti-Patterns to Avoid

❌ **Don't calculate tokens in API handlers**
```typescript
// BAD
const events = agent.threadManager.getEvents(threadId);
const tokens = aggregateTokenUsage(events);
```

✅ **Do use the Agent API**
```typescript
// GOOD
const tokens = agent.getTokenUsage();
```

❌ **Don't access agent internals**
```typescript
// BAD
agent.threadManager.getEvents()
agent._tokenBudgetManager.getTotalUsage()
```

✅ **Do use public methods**
```typescript
// GOOD
agent.getTokenUsage()
```

## Compaction Handling

When compaction occurs:
1. Original events are replaced with a summary
2. TokenBudgetManager is notified via `handleCompaction()`
3. Token counts reset to summary value
4. New events add to the summary count

## Testing

Always test the real implementation:
- Use real Agent instances with MockProvider
- Don't mock TokenBudgetManager
- Test behavior (token counts) not implementation
```

**Commit**:
```bash
git add docs/architecture/token-counting.md
git commit -m "docs: add token counting architecture documentation"
```

---

## Final Checklist

Run these commands to ensure everything works:

```bash
# Check TypeScript types
npm run typecheck

# Check code style
npm run lint

# Run all tests
npm run test:run

# Run specific test suites to verify fixes
npm run test:run src/token-management/
npm run test:run src/agents/agent-compaction
npm run test:run src/agents/agent-token
npm run test:run src/threads/token-aggregation
npm run test:run packages/web/app/api/compaction.e2e.test.ts
```

## Summary of Changes

After completing all tasks, you will have:

1. ✅ **TokenBudgetManager handles compaction** - Resets counts properly
2. ✅ **Agent notifies about compaction** - Keeps TokenBudgetManager in sync
3. ✅ **Agent.getTokenUsage() API** - Clean public interface
4. ✅ **Session API uses Agent API** - No more direct calculation
5. ✅ **aggregateTokenUsage fixed** - Understands compaction for analysis
6. ✅ **E2E tests pass** - Token usage drops after compaction
7. ✅ **Documentation updated** - Architecture clearly documented

## Common Issues and Solutions

### Issue: TypeScript errors about types
**Solution**: Never use `any`. Use `unknown` and type guards or proper interfaces.

### Issue: Tests failing with "Cannot read property of undefined"
**Solution**: Check that all required objects are initialized. Use optional chaining (`?.`) where appropriate.

### Issue: Token counts still wrong after compaction
**Solution**: Verify that TokenBudgetManager.handleCompaction() is being called and that it's getting the right data.

### Issue: Import errors
**Solution**: Use the `~/` prefix for absolute imports from src/. Use `@/` for web package imports.

## Questions?

If you get stuck:
1. Check the existing test files for examples
2. Look at the git history of files you're modifying
3. Run tests frequently to catch issues early
4. Make small commits so you can revert if needed
5. Read the error messages carefully - they usually tell you what's wrong