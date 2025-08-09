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

## Phase 1: Token Tracking Foundation ✅ **COMPLETED**

### Task 1.1: Add Token Usage to Event Types ✅
**Goal**: Enable events to store token usage data without database changes.

**Status**: ✅ **COMPLETED** - Committed in `760d5087`

**Files modified**:
- `src/threads/types.ts` - Updated event type definitions with TokenUsage interface and AgentMessageData
- `src/threads/types.test.ts` - Created comprehensive type tests
- `src/tools/types.ts` - Added tokenUsage field to ToolResult interface
- `src/persistence/database.ts` - Updated to handle new AgentMessageData type
- Multiple test files updated to use new AGENT_MESSAGE format

**Provider Integration**: Works with **provider-agnostic abstraction layer** supporting:
- **Anthropic Claude** (primary)
- **OpenAI GPT models**
- **LMStudio** (local models) 
- **Ollama** (local models)

Any provider that populates the `usage` field in `ProviderResponse` will automatically have token data tracked.

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

### Task 1.2: Store Token Usage in Agent ✅
**Goal**: When Agent receives responses from providers, store token usage in events.

**Status**: ✅ **COMPLETED** - Committed in `7cfd8888`

**Files modified**:
- `src/agents/agent.ts` - Updated event creation to include token usage from provider responses
- `src/agents/agent-token-tracking.test.ts` - Created integration test to verify functionality

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

### Task 1.3: Add Token Aggregation Helper ✅
**Goal**: Create utility to calculate total tokens used in a conversation.

**Status**: ✅ **COMPLETED** - Committed in `760d5087`

**Files created**:
- `src/threads/token-aggregation.ts` - Token calculation utilities with aggregateTokenUsage() and estimateConversationTokens()
- `src/threads/token-aggregation.test.ts` - Comprehensive tests covering various scenarios

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

**Key Features**:
- `aggregateTokenUsage()`: Sums precise token counts from AGENT_MESSAGE and TOOL_RESULT events
- `estimateConversationTokens()`: Provides fallback estimation when precise data unavailable  
- Handles mixed scenarios (events with/without token usage)
- Comprehensive test coverage

**Commit**: `feat: add token aggregation utilities and agent token tracking test`

---

## Phase 1 Summary ✅ **COMPLETED**

**What was delivered**:
1. ✅ **Token Usage Event Types** - Events can now store precise token consumption data
2. ✅ **Provider Integration** - All AI providers automatically track tokens if supported 
3. ✅ **Agent Token Storage** - Agent stores token usage from provider responses in conversation events
4. ✅ **Aggregation Utilities** - Calculate total tokens used across conversation history

**Breaking Changes Made**:
- `AGENT_MESSAGE` events now use `{ content: string, tokenUsage?: TokenUsage }` instead of raw strings
- All existing code updated to use new format

**Provider Support**:
- **Anthropic Claude**, **OpenAI**, **LMStudio**, **Ollama** - any provider implementing `ProviderResponse.usage`

**Ready for Phase 2**: Foundation is in place for manual `/compact` command and AI-powered compaction strategies.

---

## Phase 2: Manual Compaction Command ✅ **COMPLETED**

### Task 2.1: Add /compact Command Detection ✅ **COMPLETED**
**Goal**: Detect when user sends "/compact" and trigger compaction instead of processing as message.

**Commit**: `0308d029` - feat: implement /compact command detection in Agent

**Files modified**:
- `src/agents/agent.ts` - Added command detection in _processMessage
- `src/agents/agent-commands.test.ts` - Complete test suite for command handling
- `src/agents/agent-token-tracking.test.ts` - Fixed TypeScript issues

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

**What was delivered:**
- ✅ Command detection in Agent._processMessage() before normal processing
- ✅ _handleCompactCommand() method with proper event emission
- ✅ Structured error handling with context information
- ✅ Complete test suite: 4 test cases covering execution, non-commands, events, errors
- ✅ Users can now type `/compact` to manually trigger thread compaction
- ✅ All TypeScript and linting issues resolved

---

### Task 2.2: Create Basic Compaction Logic ✅ **COMPLETED**
**Goal**: Implement thread summarization and event replacement for more efficient compaction.

**Status**: ✅ **COMPLETED** - Committed in `d0f5372c` and refined in `72945241`

**Files implemented**:
- `src/threads/compaction/summarize-strategy.ts` - AI-powered summarization strategy with in-conversation approach
- `src/threads/compaction/summarize-strategy.test.ts` - Comprehensive test suite (7 tests)
- `src/threads/compaction/registry.ts` - Updated to include SummarizeCompactionStrategy
- `src/agents/agent.ts` - Added generateSummary() method for in-conversation summaries

**Implementation Highlights**:

**Original Design (Sidebar Approach)**:
- Separate AI call outside conversation context
- Lost nuance and conversation understanding
- Required additional API tokens

**Redesigned (In-Conversation Approach)** - Committed in `72945241`:
```typescript
// Agent now provides a public method for summaries
async generateSummary(promptContent: string, events: ThreadEvent[]): Promise<string> {
  const messages = this._buildConversationFromEvents(events);
  messages.push({ role: 'user', content: promptContent });
  
  const response = await this._provider.createResponse(
    messages,
    [],
    this.model || 'default'
  );
  
  return response.content;
}
```

**Key Features**:
- ✅ Conversation LLM generates its own summary with full context
- ✅ Event count-based recent event preservation (last 2 events when >3 total)
- ✅ Comprehensive summarization prompt with structured sections
- ✅ Backward compatibility with provider-only fallback
- ✅ Complete test coverage including edge cases

**Summarization Prompt Structure**:
1. User's Primary Request and Intent
2. Current Status (completed/pending)
3. Key Technical Context
4. Code Changes Made
5. Issues Encountered and Solutions
6. User Preferences and Patterns
7. Important Context for Continuation
8. Working State

**Test Coverage**:
- Basic summarization with mixed event types
- Recent event preservation by count
- Tool call/result handling
- Error handling for missing agent/provider
- Empty event list handling
- COMPACTION event filtering
- Provider-only fallback compatibility

**Commits**:
- `d0f5372c`: feat: implement AI-powered conversation summarization strategy
- `72945241`: refactor: redesign compaction to use conversation LLM instead of sidebar

### Task 2.3: Add Compaction Interface Integration ✅ **COMPLETED**
**Goal**: Connect compaction to terminal interface for user feedback.

**Status**: ✅ **COMPLETED** - Committed in `a259e24b`

**Files created/modified**:
- `src/interfaces/compaction-handler.ts` - Handler for compaction events with display interface
- `src/interfaces/compaction-handler.test.ts` - Comprehensive test suite (9 tests)
- `src/interfaces/non-interactive-interface.ts` - Integrated CompactionHandler

**Implementation Highlights**:
- **CompactionHandler**: Listens to agent events and detects compaction operations
- **CompactionDisplay Interface**: Abstraction for different UI implementations
- **ConsoleCompactionDisplay**: CLI implementation with emoji-enhanced messages
- **Event Detection**: Identifies `/compact` commands and tracks compaction lifecycle

**User Experience**:
- 🔄 "Compacting conversation to reduce size..." when compaction starts
- ✅ "Compaction complete! Reduced from X to Y events (Z% reduction)" on success
- ❌ "Compaction failed: [error message]" on failure

**Test Coverage**:
- Compaction start detection
- Regular message filtering
- Compaction completion handling
- Error handling
- Event listener cleanup
- Console display messages

---

## Phase 3: Enhanced AI Summarization Strategy ✅ **COMPLETED**

**Note**: Phase 3 was implemented to enhance the AI-powered summarization from Phase 2 with additional features and improved context preservation.

### Task 3.1: Create AI Summarization Strategy ✅ **COMPLETED**
**Goal**: Enhance the existing summarization strategy with additional features.

**Status**: ✅ **COMPLETED** - Enhanced in latest commits

**Key enhancement**: Preserve ALL user messages instead of just recent ones. This was implemented based on user feedback that "system prompt will be auto-preserved. ditto user-prompt. and we should preserve ALL user messages."

**Files modified**:
- `src/threads/compaction/summarize-strategy.ts` - Updated to preserve ALL user messages
- `src/threads/compaction/enhanced-summarize.test.ts` - Created comprehensive test suite
- `src/threads/compaction/summarize-strategy.test.ts` - Updated tests for new behavior

**Implementation highlights**:
```typescript
// Key change in summarize-strategy.ts:
// Separate events into categories
const allUserMessages = conversationEvents.filter((e) => e.type === 'USER_MESSAGE');
const nonUserEvents = conversationEvents.filter((e) => e.type !== 'USER_MESSAGE');

// Preserve ALL user messages (not just recent ones)
compactedEvents.push(...allUserMessages);

// Only summarize old non-user events
const { oldEvents, recentEvents } = this.categorizeEventsByCount(nonUserEvents);
```

**Test coverage added**:
- Preserve ALL user messages regardless of count
- Summarize old agent messages but keep recent ones  
- Track summary length in metadata
- Avoid duplicating events when preserving
- Include all enhanced metadata fields

### Task 3.2: Register AI Strategy ✅ **COMPLETED**
**Goal**: Add the new strategy to the registry.

**Status**: ✅ **COMPLETED** - SummarizeCompactionStrategy already registered

The SummarizeCompactionStrategy was already registered in the registry as part of Phase 2 implementation.

### Task 3.3: Update Agent compact() to Use AI Strategy ✅ **COMPLETED**
**Goal**: Make agent use AI strategy and pass required context.

**Status**: ✅ **COMPLETED** - Agent already uses SummarizeCompactionStrategy

The Agent.compact() method was updated in Phase 2 to use the SummarizeCompactionStrategy with the agent's own context.

## Phase 3 Summary ✅ **COMPLETED**

**What was delivered**:
1. ✅ **Preserve ALL User Messages** - Changed strategy to preserve all USER_MESSAGE events instead of just recent ones
2. ✅ **Enhanced Metadata Tracking** - Added preservedUserMessages count and summaryLength to metadata
3. ✅ **Comprehensive Test Suite** - Created enhanced-summarize.test.ts with 5 test cases
4. ✅ **Updated Existing Tests** - Fixed summarize-strategy.test.ts to match new behavior

**Key Enhancement Based on User Feedback**:
- User specified: "system prompt will be auto-preserved. ditto user-prompt. and we should preserve ALL user messages."
- This was implemented to ensure no user context is lost during compaction
- Only agent responses and tool interactions are summarized

---

## Phase 4: Automatic Compaction ✅ **COMPLETED**

### Task 4.1: Add Auto-Compaction Trigger ✅ **COMPLETED**
**Goal**: Automatically compact when approaching token limits.

**Status**: ✅ **COMPLETED** - Committed in `48e8643d`

**Files implemented**:
- `src/agents/agent.ts` - Added auto-compaction configuration and _checkAutoCompaction() method
- `src/agents/agent-auto-compact.test.ts` - Comprehensive test suite with 4 test cases

**Key Features**:
- 80% threshold trigger (configurable via TokenBudget)
- 60-second cooldown between compactions
- Graceful failure handling - continues conversation even if compaction fails
- Integrates with TokenBudgetManager's shouldPrune recommendation

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

## Phase 4 Summary ✅ **COMPLETED**

**What was delivered**:
1. ✅ **Automatic Compaction Trigger** - Compacts at 80% token limit threshold
2. ✅ **Cooldown Period** - Prevents excessive compaction with 60-second cooldown
3. ✅ **Graceful Failure Handling** - Continues conversation even if compaction fails
4. ✅ **TokenBudgetManager Integration** - Uses existing token budget recommendations

The system now automatically compacts conversations when approaching token limits, preventing context window overflow without user intervention.

---

## Phase 5: API and Web UI Integration ✅ **COMPLETED**

### Task 5.1: Add Token Info to API Responses ✅ **COMPLETED**
**Goal**: Include token usage in session/thread API responses.

**Status**: ✅ **COMPLETED** - Committed in `681ff8f1`

**Files implemented**:
- `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.ts` - Added token usage calculation
- `packages/web/types/api.ts` - Updated SessionResponse type with tokenUsage field
- `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.token.test.ts` - Comprehensive tests

**Key Features**:
- Token usage summary includes totalPromptTokens, totalCompletionTokens, totalTokens, eventCount
- Calculates percentUsed based on model's context limit
- nearLimit flag when usage exceeds 80% of context limit
- Graceful failure handling - token calculation errors don't fail the request

**Commit**: `feat: add token usage statistics to session API responses`

---

### Task 5.2: Add Compaction Status to SSE Events ✅ **COMPLETED**
**Goal**: Emit events when compaction starts/completes.

**Status**: ✅ **COMPLETED** - Committed in `f32f8734`

**Files implemented**:
- `packages/web/lib/server/session-service.ts` - Added compaction event handlers
- `packages/web/types/web-sse.ts` - Added COMPACTION_START and COMPACTION_COMPLETE event types
- `packages/web/lib/server/session-service.compaction.test.ts` - Comprehensive tests

**Key Features**:
- Listens to agent_thinking_start/complete events to detect compaction
- Emits COMPACTION_START when compaction begins with strategy and message
- Emits COMPACTION_COMPLETE when compaction finishes with success status
- Tracks compaction state to avoid false positives from non-compaction thinking events
- Full test coverage for manual and auto-compaction scenarios

**Commit**: `feat: add compaction status to SSE event stream`

## Phase 5 Summary ✅ **COMPLETED**

**What was delivered**:
1. ✅ **Token Usage in API** - Session API responses now include comprehensive token statistics
2. ✅ **Real-time Compaction Events** - SSE stream emits COMPACTION_START and COMPACTION_COMPLETE events
3. ✅ **Web UI Integration** - Full integration with web package for token monitoring and compaction status

The web UI can now:
- Display current token usage and percentage of context limit used
- Warn users when approaching token limits (>80% usage)
- Show real-time notifications when compaction is in progress
- Notify users when compaction completes successfully

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