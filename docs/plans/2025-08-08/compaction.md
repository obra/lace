# Compaction System Implementation Plan

## Overview
This plan implements a comprehensive compaction system for Lace to handle context window limits. The system will track token usage, provide manual and automatic compaction triggers, and implement an AI-powered self-compaction strategy.

## Prerequisites
- Read `docs/design/threads.md` to understand event-sourcing architecture
- Read `CLAUDE.md` for coding standards and testing requirements
- Understand that TypeScript `any` type is FORBIDDEN - use `unknown` with type guards
- Understand that mocking the functionality under test is FORBIDDEN - test real code paths

## Key Concepts
- **Compaction**: Reducing conversation size while preserving essential information
- **Token**: Unit of text that AI models process (roughly 4 characters)
- **Context Window**: Maximum tokens a model can process (e.g., 200K for Claude)
- **Event Sourcing**: All conversation state stored as immutable events

## Testing Philosophy
- **TDD (Test-Driven Development)**: Write failing tests FIRST, then implement
- **No mocking the system under test**: Test real implementations
- **Integration over unit tests**: Test how components work together
- **Use test utilities**: See `src/test-utils/` for helpers

## Development Workflow
1. Create a branch: `git checkout -b compaction-implementation`
2. For each task: Write test → Run test (verify failure) → Implement → Run test (verify pass) → Commit
3. Run full test suite before pushing: `npm run test:run`
4. Lint before committing: `npm run lint`

---

## Phase 1: Token Tracking Foundation

### Task 1.1: Add Token Usage to Event Types
**Goal**: Enable events to store token usage data without database changes.

**Files to modify**:
- `src/threads/types.ts` - Update event type definitions
- `src/threads/types.test.ts` - Create this file for type tests

**Implementation**:
```typescript
// src/threads/types.ts
// Modify the AGENT_MESSAGE event type in the discriminated union:
| (BaseThreadEvent & {
    type: 'AGENT_MESSAGE';
    data: {
      content: string;
      tokenUsage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
    };
  })

// Also update TOOL_RESULT to support token tracking:
| (BaseThreadEvent & {
    type: 'TOOL_RESULT';
    data: ToolResult & {
      tokenUsage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
    };
  })
```

**Test first** (`src/threads/types.test.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import type { ThreadEvent } from '~/threads/types';

describe('ThreadEvent token usage', () => {
  it('should allow AGENT_MESSAGE with token usage', () => {
    const event: ThreadEvent = {
      id: 'evt_123',
      threadId: 'thread_123',
      type: 'AGENT_MESSAGE',
      timestamp: new Date(),
      data: {
        content: 'Hello',
        tokenUsage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150
        }
      }
    };
    
    expect(event.data.tokenUsage).toBeDefined();
    expect(event.data.tokenUsage?.totalTokens).toBe(150);
  });

  it('should allow AGENT_MESSAGE without token usage', () => {
    const event: ThreadEvent = {
      id: 'evt_123',
      threadId: 'thread_123', 
      type: 'AGENT_MESSAGE',
      timestamp: new Date(),
      data: {
        content: 'Hello'
      }
    };
    
    expect(event.data.tokenUsage).toBeUndefined();
  });
});
```

**How to test**:
```bash
npm run test:run src/threads/types.test.ts
```

**Commit**: `feat: add token usage tracking to AGENT_MESSAGE and TOOL_RESULT events`

---

### Task 1.2: Store Token Usage in Agent
**Goal**: When Agent receives responses from providers, store token usage in events.

**Files to modify**:
- `src/agents/agent.ts` - Update event creation to include token usage
- `src/agents/agent-token-tracking.test.ts` - Create integration test

**Implementation locations in agent.ts**:
1. Find `_handleProviderResponse` method (~line 700)
2. Find where AGENT_MESSAGE events are created
3. Modify the data field to include tokenUsage from response

```typescript
// In agent.ts, when creating AGENT_MESSAGE event:
this._threadManager.addEvent(this._threadId, 'AGENT_MESSAGE', {
  content: responseContent,
  tokenUsage: response.usage ? {
    promptTokens: response.usage.promptTokens,
    completionTokens: response.usage.completionTokens,
    totalTokens: response.usage.totalTokens
  } : undefined
});
```

**Test first** (`src/agents/agent-token-tracking.test.ts`):
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { MockProvider } from '~/test-utils/mock-provider';
import { setupCoreTest } from '~/test-utils/core-test-setup';

describe('Agent token tracking', () => {
  setupCoreTest();
  let agent: Agent;
  let threadManager: ThreadManager;
  let provider: MockProvider;

  beforeEach(() => {
    threadManager = new ThreadManager();
    provider = new MockProvider({
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
      toolExecutor: null
    });
  });

  it('should store token usage in AGENT_MESSAGE events', async () => {
    await agent.sendMessage('Hello');
    
    const events = threadManager.getEvents(agent.threadId);
    const agentMessage = events.find(e => e.type === 'AGENT_MESSAGE');
    
    expect(agentMessage).toBeDefined();
    expect(agentMessage?.data).toHaveProperty('tokenUsage');
    expect(agentMessage?.data.tokenUsage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150
    });
  });
});
```

**Commit**: `feat: store token usage from provider responses in events`

---

### Task 1.3: Add Token Aggregation Helper
**Goal**: Create utility to calculate total tokens used in a conversation.

**Files to create**:
- `src/threads/token-aggregation.ts` - Token calculation utilities
- `src/threads/token-aggregation.test.ts` - Tests

**Implementation** (`src/threads/token-aggregation.ts`):
```typescript
// ABOUTME: Utilities for aggregating token usage across thread events
// ABOUTME: Calculates cumulative token counts from conversation history

import type { ThreadEvent } from '~/threads/types';

export interface TokenSummary {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  eventCount: number;
}

export function aggregateTokenUsage(events: ThreadEvent[]): TokenSummary {
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let eventCount = 0;

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

  return {
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens: totalPromptTokens + totalCompletionTokens,
    eventCount
  };
}

export function estimateConversationTokens(events: ThreadEvent[]): number {
  // Conservative estimation when actual counts aren't available
  let estimatedTokens = 0;
  
  for (const event of events) {
    if (event.type === 'USER_MESSAGE' || event.type === 'AGENT_MESSAGE') {
      const content = typeof event.data === 'string' ? event.data : event.data.content;
      estimatedTokens += Math.ceil(content.length / 4);
    } else if (event.type === 'TOOL_RESULT') {
      // Tool results can be large
      const resultText = JSON.stringify(event.data);
      estimatedTokens += Math.ceil(resultText.length / 4);
    }
  }
  
  return estimatedTokens;
}
```

**Test first** (`src/threads/token-aggregation.test.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import { aggregateTokenUsage, estimateConversationTokens } from '~/threads/token-aggregation';
import type { ThreadEvent } from '~/threads/types';

describe('Token aggregation', () => {
  it('should aggregate token usage from events', () => {
    const events: ThreadEvent[] = [
      {
        id: '1',
        threadId: 'test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'Response 1',
          tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
        }
      },
      {
        id: '2',
        threadId: 'test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'Response 2',
          tokenUsage: { promptTokens: 200, completionTokens: 75, totalTokens: 275 }
        }
      }
    ];

    const summary = aggregateTokenUsage(events);
    
    expect(summary.totalPromptTokens).toBe(300);
    expect(summary.totalCompletionTokens).toBe(125);
    expect(summary.totalTokens).toBe(425);
    expect(summary.eventCount).toBe(2);
  });

  it('should estimate tokens when usage data not available', () => {
    const events: ThreadEvent[] = [
      {
        id: '1',
        threadId: 'test',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'This is approximately twenty characters long test'
      }
    ];

    const estimated = estimateConversationTokens(events);
    
    // ~50 chars / 4 = ~12.5, rounded up to 13
    expect(estimated).toBeGreaterThan(10);
    expect(estimated).toBeLessThan(20);
  });
});
```

**Commit**: `feat: add token aggregation utilities for conversation tracking`

---

## Phase 2: Manual Compaction Command

### Task 2.1: Add /compact Command Detection
**Goal**: Detect when user sends "/compact" and trigger compaction instead of processing as message.

**Files to modify**:
- `src/agents/agent.ts` - Add command detection in sendMessage
- `src/agents/agent-commands.test.ts` - Create test for command handling

**Implementation in agent.ts**:
```typescript
// In sendMessage method, at the beginning:
async sendMessage(message: string, options?: SendMessageOptions): Promise<void> {
  // Check for slash commands
  if (message.startsWith('/compact')) {
    await this.handleCompactCommand();
    return;
  }
  
  // ... existing message processing
}

private async handleCompactCommand(): Promise<void> {
  this.emit('agent_thinking_start', { 
    message: 'Compacting conversation to save space...' 
  });
  
  try {
    // Use the simple trim strategy for now
    await this.compact(this._threadId);
    
    // Add a system message about compaction
    this._threadManager.addEvent(this._threadId, 'LOCAL_SYSTEM_MESSAGE', 
      '✅ Conversation compacted successfully');
    
    this.emit('agent_thinking_complete');
  } catch (error) {
    this.emit('agent_error', { 
      error: error instanceof Error ? error : new Error('Compaction failed') 
    });
  }
}
```

**Test first** (`src/agents/agent-commands.test.ts`):
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { MockProvider } from '~/test-utils/mock-provider';
import { setupCoreTest } from '~/test-utils/core-test-setup';

describe('Agent command handling', () => {
  setupCoreTest();
  let agent: Agent;
  let threadManager: ThreadManager;

  beforeEach(() => {
    threadManager = new ThreadManager();
    const provider = new MockProvider();
    agent = new Agent({ provider, threadManager, toolExecutor: null });
  });

  it('should handle /compact command', async () => {
    // Add some events first
    threadManager.addEvent(agent.threadId, 'USER_MESSAGE', 'Hello');
    threadManager.addEvent(agent.threadId, 'AGENT_MESSAGE', {
      content: 'Hi there'
    });

    // Spy on the compact method
    const compactSpy = vi.spyOn(agent, 'compact');
    
    // Send compact command
    await agent.sendMessage('/compact');
    
    // Should trigger compaction
    expect(compactSpy).toHaveBeenCalledWith(agent.threadId);
    
    // Should add system message about compaction
    const events = threadManager.getEvents(agent.threadId);
    const systemMessage = events.find(e => 
      e.type === 'LOCAL_SYSTEM_MESSAGE' && 
      e.data.includes('compacted')
    );
    expect(systemMessage).toBeDefined();
  });

  it('should not process /compact as regular message', async () => {
    const provider = new MockProvider();
    const createResponseSpy = vi.spyOn(provider, 'createResponse');
    
    agent = new Agent({ provider, threadManager, toolExecutor: null });
    
    await agent.sendMessage('/compact');
    
    // Should NOT call provider
    expect(createResponseSpy).not.toHaveBeenCalled();
  });
});
```

**Commit**: `feat: add /compact command to trigger manual compaction`

---

### Task 2.2: Expose Compaction through Web API
**Goal**: Allow web UI to trigger compaction by sending "/compact" message.

**Files to check** (no changes needed):
- `packages/web/app/api/threads/[threadId]/message/route.ts` - Already handles any message
- `packages/web/hooks/useSessionAPI.ts` - Already can send messages

**Test manually**:
1. Start the web server: `npm run dev` (in packages/web)
2. Open browser to http://localhost:3000
3. Start a conversation
4. Type `/compact` and send
5. Verify compaction message appears

**Write integration test** (`packages/web/app/api/threads/[threadId]/message/route.test.ts`):
Add test case to existing file:
```typescript
it('should handle /compact command', async () => {
  const response = await POST(
    createMockRequest({ message: '/compact' }),
    { params: Promise.resolve({ threadId: 'test-thread' }) }
  );
  
  expect(response.status).toBe(202);
  // Verify command was accepted
});
```

**Commit**: `test: add web API test for /compact command`

---

## Phase 3: AI-Powered Compaction Strategy

### Task 3.1: Create AI Summarization Strategy
**Goal**: Implement strategy where model summarizes its own conversation.

**Files to create**:
- `src/threads/compaction/ai-summarization-strategy.ts` - New strategy
- `src/threads/compaction/ai-summarization-strategy.test.ts` - Tests

**Implementation** (`src/threads/compaction/ai-summarization-strategy.ts`):
```typescript
// ABOUTME: AI-powered compaction strategy using self-summarization
// ABOUTME: Model summarizes its own conversation to preserve context efficiently

import type { ThreadEvent } from '~/threads/types';
import type { CompactionStrategy, CompactionContext, CompactionData } from '~/threads/compaction/types';
import type { ProviderMessage } from '~/providers/types';
import { buildConversationFromEvents } from '~/agents/conversation-builder';

export class AISummarizationStrategy implements CompactionStrategy {
  id = 'ai-summarize';

  async compact(events: ThreadEvent[], context: CompactionContext): Promise<ThreadEvent> {
    if (!context.provider) {
      throw new Error('AI summarization requires a provider');
    }

    // Build conversation for the model
    const messages = this.buildMessagesForCompaction(events);
    
    // Add self-compaction instruction
    messages.push({
      role: 'user',
      content: this.getCompactionPrompt()
    });

    // Get model's self-summary
    const response = await context.provider.createResponse(
      messages,
      [], // No tools needed for summarization
      context.model || 'default',
      context.signal
    );

    // Create compacted events
    const compactedEvents = this.createCompactedEvents(events, response.content);

    // Return compaction event
    return {
      id: this.generateEventId(),
      threadId: context.threadId,
      type: 'COMPACTION',
      timestamp: new Date(),
      data: {
        strategyId: this.id,
        originalEventCount: events.length,
        compactedEvents,
        metadata: {
          summaryLength: response.content.length,
          preservedUserMessages: compactedEvents.filter(e => e.type === 'USER_MESSAGE').length,
          tokensSaved: response.usage?.totalTokens || 0
        }
      } as CompactionData
    };
  }

  private buildMessagesForCompaction(events: ThreadEvent[]): ProviderMessage[] {
    // Convert events to provider messages
    const messages: ProviderMessage[] = [];
    
    for (const event of events) {
      if (event.type === 'USER_MESSAGE') {
        messages.push({ role: 'user', content: event.data });
      } else if (event.type === 'AGENT_MESSAGE') {
        const content = typeof event.data === 'string' ? event.data : event.data.content;
        messages.push({ role: 'assistant', content });
      }
      // Skip other event types for summarization
    }
    
    return messages;
  }

  private getCompactionPrompt(): string {
    return `SYSTEM COMPACTION REQUEST:

Your conversation is approaching token limits and needs to be compacted. Please provide a comprehensive summary that preserves:

1. **User Intent**: What the user originally asked for and any subsequent requests
2. **Work Completed**: What has been accomplished so far with specific details
3. **Current State**: The exact current state of any work in progress
4. **Pending Tasks**: Any tasks that still need to be completed (be specific)
5. **Important Context**: Key information, decisions, errors encountered, and solutions found

Format your response as a clear, structured summary that you can continue from. Include specific file names, code snippets, and technical details that are essential.

This summary will replace the conversation history, so be thorough but concise.`;
  }

  private createCompactedEvents(originalEvents: ThreadEvent[], summary: string): ThreadEvent[] {
    const compactedEvents: ThreadEvent[] = [];
    
    // Add system prompt if present
    const systemPrompt = originalEvents.find(e => e.type === 'SYSTEM_PROMPT');
    if (systemPrompt) {
      compactedEvents.push(systemPrompt);
    }

    // Add summary as agent message
    compactedEvents.push({
      id: this.generateEventId(),
      threadId: originalEvents[0]?.threadId || 'unknown',
      type: 'AGENT_MESSAGE',
      timestamp: new Date(),
      data: {
        content: `[CONVERSATION SUMMARY]\n\n${summary}`
      }
    });

    // Preserve last few user messages for context
    const recentUserMessages = originalEvents
      .filter(e => e.type === 'USER_MESSAGE')
      .slice(-3); // Keep last 3 user messages
    
    compactedEvents.push(...recentUserMessages);

    return compactedEvents;
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

**Test first** (`src/threads/compaction/ai-summarization-strategy.test.ts`):
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { AISummarizationStrategy } from '~/threads/compaction/ai-summarization-strategy';
import type { ThreadEvent } from '~/threads/types';
import type { CompactionContext } from '~/threads/compaction/types';
import { MockProvider } from '~/test-utils/mock-provider';

describe('AI Summarization Strategy', () => {
  let strategy: AISummarizationStrategy;
  let mockProvider: MockProvider;
  let context: CompactionContext;

  beforeEach(() => {
    strategy = new AISummarizationStrategy();
    mockProvider = new MockProvider({
      responses: [{
        content: 'Summary: User asked to create a TODO app. I created the basic structure with React.',
        toolCalls: [],
        usage: { promptTokens: 500, completionTokens: 50, totalTokens: 550 }
      }]
    });
    
    context = {
      threadId: 'test-thread',
      provider: mockProvider,
      model: 'test-model'
    };
  });

  it('should create compaction event with AI summary', async () => {
    const events: ThreadEvent[] = [
      {
        id: '1',
        threadId: 'test-thread',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'Create a TODO app'
      },
      {
        id: '2',
        threadId: 'test-thread',
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: { content: 'I will create a TODO app for you...' }
      }
    ];

    const result = await strategy.compact(events, context);

    expect(result.type).toBe('COMPACTION');
    expect(result.data.strategyId).toBe('ai-summarize');
    expect(result.data.compactedEvents).toBeDefined();
    expect(result.data.compactedEvents.length).toBeGreaterThan(0);
    
    // Should include the summary
    const summaryEvent = result.data.compactedEvents.find(
      e => e.type === 'AGENT_MESSAGE' && e.data.content.includes('[CONVERSATION SUMMARY]')
    );
    expect(summaryEvent).toBeDefined();
  });

  it('should preserve recent user messages', async () => {
    const events: ThreadEvent[] = [
      { id: '1', threadId: 'test', type: 'USER_MESSAGE', timestamp: new Date(), data: 'First' },
      { id: '2', threadId: 'test', type: 'USER_MESSAGE', timestamp: new Date(), data: 'Second' },
      { id: '3', threadId: 'test', type: 'USER_MESSAGE', timestamp: new Date(), data: 'Third' },
      { id: '4', threadId: 'test', type: 'USER_MESSAGE', timestamp: new Date(), data: 'Fourth' }
    ];

    const result = await strategy.compact(events, context);
    
    const preservedUserMessages = result.data.compactedEvents
      .filter(e => e.type === 'USER_MESSAGE')
      .map(e => e.data);
    
    // Should keep last 3
    expect(preservedUserMessages).toEqual(['Second', 'Third', 'Fourth']);
  });

  it('should throw error if no provider in context', async () => {
    const contextNoProvider: CompactionContext = {
      threadId: 'test-thread'
    };

    await expect(
      strategy.compact([], contextNoProvider)
    ).rejects.toThrow('AI summarization requires a provider');
  });
});
```

**Commit**: `feat: implement AI-powered self-summarization compaction strategy`

---

### Task 3.2: Register AI Strategy
**Goal**: Add the new strategy to the registry.

**Files to modify**:
- `src/threads/compaction/registry.ts` - Add new strategy
- `src/threads/compaction/registry.test.ts` - Create test

**Implementation** (`src/threads/compaction/registry.ts`):
```typescript
import { TrimToolResultsStrategy } from '~/threads/compaction/trim-tool-results-strategy';
import { AISummarizationStrategy } from '~/threads/compaction/ai-summarization-strategy';
import type { CompactionStrategy } from '~/threads/compaction/types';

function createDefaultStrategies(): CompactionStrategy[] {
  return [
    new TrimToolResultsStrategy(),
    new AISummarizationStrategy()
  ];
}
```

**Test** (`src/threads/compaction/registry.test.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import { registerDefaultStrategies } from '~/threads/compaction/registry';

describe('Compaction registry', () => {
  it('should register both default strategies', () => {
    const registeredStrategies: string[] = [];
    
    registerDefaultStrategies((strategy) => {
      registeredStrategies.push(strategy.id);
    });
    
    expect(registeredStrategies).toContain('trim-tool-results');
    expect(registeredStrategies).toContain('ai-summarize');
  });
});
```

**Commit**: `feat: register AI summarization strategy in compaction registry`

---

### Task 3.3: Update Agent compact() to Use AI Strategy
**Goal**: Make agent use AI strategy and pass required context.

**Files to modify**:
- `src/agents/agent.ts` - Update compact method
- `src/agents/agent-compaction.test.ts` - Create integration test

**Implementation in agent.ts**:
```typescript
async compact(threadId: string): Promise<void> {
  // Create context with provider and tools
  const context: CompactionContext = {
    threadId,
    provider: this._provider,
    toolExecutor: this._toolExecutor,
    model: this._model
  };
  
  // Try AI summarization first, fall back to trim if it fails
  try {
    await this._threadManager.compact(threadId, 'ai-summarize', context);
  } catch (error) {
    logger.warn('AI summarization failed, falling back to trim strategy', { error });
    await this._threadManager.compact(threadId, 'trim-tool-results', context);
  }
}
```

**Note**: ThreadManager.compact() needs updating to pass context to strategy:
```typescript
// In thread-manager.ts, update compact method:
async compact(threadId: string, strategyId: string, context?: Partial<CompactionContext>): Promise<void> {
  // ... existing validation ...
  
  // Merge provided context with defaults
  const fullContext: CompactionContext = {
    threadId,
    ...context
  };
  
  // Run compaction strategy
  const compactionEvent = await strategy.compact(thread.events, fullContext);
  
  // ... rest of existing implementation
}
```

**Test** (`src/agents/agent-compaction.test.ts`):
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { MockProvider } from '~/test-utils/mock-provider';
import { setupCoreTest } from '~/test-utils/core-test-setup';

describe('Agent compaction with AI strategy', () => {
  setupCoreTest();
  let agent: Agent;
  let threadManager: ThreadManager;
  let provider: MockProvider;

  beforeEach(() => {
    threadManager = new ThreadManager();
    provider = new MockProvider({
      responses: [{
        content: 'Summary of conversation...',
        toolCalls: [],
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      }]
    });
    
    agent = new Agent({ provider, threadManager, toolExecutor: null });
  });

  it('should use AI summarization strategy for compaction', async () => {
    // Add some events
    threadManager.addEvent(agent.threadId, 'USER_MESSAGE', 'Build a calculator');
    threadManager.addEvent(agent.threadId, 'AGENT_MESSAGE', {
      content: 'I will build a calculator'
    });
    
    // Compact
    await agent.compact(agent.threadId);
    
    // Check for compaction event
    const events = threadManager.getAllEvents(agent.threadId);
    const compactionEvent = events.find(e => e.type === 'COMPACTION');
    
    expect(compactionEvent).toBeDefined();
    expect(compactionEvent?.data.strategyId).toBe('ai-summarize');
  });
});
```

**Commit**: `feat: integrate AI summarization into agent compaction`

---

## Phase 4: Automatic Compaction

### Task 4.1: Add Auto-Compaction Trigger
**Goal**: Automatically compact when approaching token limits.

**Files to modify**:
- `src/agents/agent.ts` - Add threshold checking after messages
- `src/agents/agent-auto-compact.test.ts` - Create test

**Implementation in agent.ts**:
```typescript
// Add configuration field
private _autoCompactConfig = {
  enabled: true,
  threshold: 0.8, // Compact at 80% of limit
  cooldownMs: 60000, // Don't compact again for 1 minute
  lastCompactionTime: 0
};

// In _handleProviderResponse, after recording token usage:
private async _checkAutoCompaction(): Promise<void> {
  if (!this._autoCompactConfig.enabled) return;
  
  // Check cooldown
  const now = Date.now();
  if (now - this._autoCompactConfig.lastCompactionTime < this._autoCompactConfig.cooldownMs) {
    return;
  }
  
  // Check if we should compact
  if (this._tokenBudgetManager) {
    const recommendations = this._tokenBudgetManager.getRecommendations();
    if (recommendations.shouldPrune) {
      logger.info('Auto-compacting due to token limit approaching');
      
      this.emit('agent_thinking_start', { 
        message: 'Approaching token limit, compacting conversation...' 
      });
      
      try {
        await this.compact(this._threadId);
        this._autoCompactConfig.lastCompactionTime = now;
        
        // Reset token budget after compaction
        this._tokenBudgetManager.reset();
        
        this.emit('agent_thinking_complete');
      } catch (error) {
        logger.error('Auto-compaction failed', { error });
        // Don't throw - continue conversation even if compaction fails
      }
    }
  }
}

// Call this after handling each provider response:
await this._checkAutoCompaction();
```

**Test** (`src/agents/agent-auto-compact.test.ts`):
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { MockProvider } from '~/test-utils/mock-provider';
import { setupCoreTest } from '~/test-utils/core-test-setup';

describe('Agent auto-compaction', () => {
  setupCoreTest();
  
  it('should auto-compact when approaching token limit', async () => {
    const threadManager = new ThreadManager();
    const provider = new MockProvider({
      responses: [
        { 
          content: 'First response', 
          toolCalls: [],
          usage: { promptTokens: 8000, completionTokens: 2000, totalTokens: 10000 }
        },
        {
          content: 'Summary: conversation about testing',
          toolCalls: [],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
        },
        {
          content: 'Second response after compaction',
          toolCalls: [],
          usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 }
        }
      ]
    });
    
    const agent = new Agent({
      provider,
      threadManager,
      toolExecutor: null,
      tokenBudget: {
        maxTokens: 12000, // Will trigger at 80% = 9600 tokens
        reserveTokens: 1000,
        warningThreshold: 0.7
      }
    });
    
    const compactSpy = vi.spyOn(agent, 'compact');
    
    // First message uses 10k tokens, triggering auto-compact
    await agent.sendMessage('First message');
    
    expect(compactSpy).toHaveBeenCalled();
    
    // Should have compaction event
    const events = threadManager.getAllEvents(agent.threadId);
    const compactionEvent = events.find(e => e.type === 'COMPACTION');
    expect(compactionEvent).toBeDefined();
  });

  it('should respect compaction cooldown', async () => {
    // Test that rapid messages don't trigger multiple compactions
    // Implementation left as exercise
  });
});
```

**Commit**: `feat: add automatic compaction when approaching token limits`

---

## Phase 5: API and Web UI Integration

### Task 5.1: Add Token Info to API Responses
**Goal**: Include token usage in session/thread API responses.

**Files to modify**:
- `packages/web/app/api/sessions/[sessionId]/route.ts` - Add token info
- `packages/web/types/api.ts` - Update types

**Implementation in types/api.ts**:
```typescript
export interface SessionResponse {
  session: SessionInfo;
  tokenUsage?: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    percentUsed: number;
    nearLimit: boolean;
  };
}
```

**Implementation in route.ts**:
```typescript
// In GET handler:
import { aggregateTokenUsage } from '@/lib/server/token-utils';

const events = agent.getEvents();
const tokenSummary = aggregateTokenUsage(events);

const response: SessionResponse = {
  session: sessionInfo,
  tokenUsage: {
    ...tokenSummary,
    percentUsed: (tokenSummary.totalTokens / contextLimit) * 100,
    nearLimit: tokenSummary.totalTokens > contextLimit * 0.8
  }
};
```

**Commit**: `feat: expose token usage statistics in API responses`

---

### Task 5.2: Add Compaction Status to SSE Events
**Goal**: Emit events when compaction starts/completes.

**Files to modify**:
- `src/agents/agent.ts` - Already emits thinking events
- `packages/web/types/web-sse.ts` - Add compaction event types

**Implementation in web-sse.ts**:
```typescript
export type SessionEvent = 
  | { type: 'COMPACTION_START'; threadId: ThreadId; timestamp: Date; data: { strategy: string } }
  | { type: 'COMPACTION_COMPLETE'; threadId: ThreadId; timestamp: Date; data: { tokensSaved: number } }
  | // ... existing types
```

**Commit**: `feat: add compaction status to SSE event stream`

---

## Testing Guide

### Unit Tests
Run specific test files:
```bash
npm run test:run src/threads/token-aggregation.test.ts
npm run test:run src/threads/compaction/ai-summarization-strategy.test.ts
```

### Integration Tests
Run all thread tests:
```bash
npm run test:run src/threads/
npm run test:run src/agents/
```

### Manual Testing
1. Start the system: `npm run dev`
2. Create a long conversation
3. Type `/compact` to manually compact
4. Verify compaction message appears
5. Continue conversation to verify it still works
6. Watch for auto-compaction at 80% limit

### Full Test Suite
Before committing:
```bash
npm run test:run
npm run lint
npm run typecheck
```

---

## Troubleshooting

### TypeScript Errors
- **Never use `any`**: Use `unknown` and type guards
- **Missing types**: Check `src/types/` for existing definitions
- **Import errors**: Use `~/` prefix for absolute imports

### Test Failures
- **Check test utilities**: `src/test-utils/` has helpers
- **Use real implementations**: Don't mock what you're testing
- **Check setup**: Use `setupCoreTest()` for database/file system

### Compaction Issues
- **Strategy not found**: Check registry registration
- **Token counts wrong**: Verify provider returns usage data
- **AI summary fails**: Check provider is configured correctly

---

## Documentation to Update

After implementation:
1. Update `docs/design/threads.md` - Remove params from CompactionContext
2. Update `CLAUDE.md` - Add compaction commands section
3. Update `packages/web/README.md` - Document token usage UI

---

## Final Checklist

- [ ] All tests pass: `npm run test:run`
- [ ] No linting errors: `npm run lint`
- [ ] No TypeScript errors: `npm run typecheck`
- [ ] Manual testing completed
- [ ] Documentation updated
- [ ] Committed with descriptive messages
- [ ] Created pull request

## Key Reminders

1. **Write tests FIRST** - TDD is required
2. **No `any` types** - Use `unknown` with type guards
3. **Don't mock the system under test** - Test real code
4. **Commit frequently** - Small, focused commits
5. **YAGNI** - Don't add features not in the plan
6. **DRY** - Reuse existing utilities and patterns