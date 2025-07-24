# Phase 2: Compaction Event Implementation

**Date:** 2025-07-23  
**Engineer Context:** You are skilled in JavaScript but new to this codebase, TypeScript, NextJS, and agentic systems  
**Prerequisites:** Phase 1 complete - all shadow thread code removed, core functionality working  
**Goal:** Implement clean compaction event system that replaces conversations with compact summaries

## What You're Building

A compaction system that:
- Stores compaction results as special `COMPACTION` events in the same thread
- Replaces long conversation histories with shorter, summarized versions
- Allows different compaction strategies (trim tool results, summarize conversations, etc.)
- Maintains thread ID stability (threads never change IDs)
- Preserves original events for reconstruction if needed

## Critical TypeScript Rules

1. **NEVER use `any` type** - Always use proper types or `unknown` with type guards
2. **Use strict TypeScript** - The project has strict mode enabled
3. **Define interfaces before implementation** - Think about types first
4. **Use discriminated unions** - For event types with different payloads

## Development Workflow

1. **Test-Driven Development**: Write failing tests first, then implement
2. **Frequent commits**: Commit after each small task completion  
3. **YAGNI**: Don't add features not explicitly required
4. **Start simple**: Build basic functionality before advanced features

## Core Concepts

### Event-Based Compaction
Instead of creating new threads, compaction creates special COMPACTION events with structured data:
```typescript
interface CompactionData {
  strategyId: string;                    // Which strategy was used
  originalEventCount: number;            // How many events were replaced
  compactedEvents: ThreadEvent[];        // The new replacement events
  metadata?: Record<string, unknown>;    // Strategy-specific data
}

// CompactionEvent is just a regular ThreadEvent with COMPACTION type and CompactionData
// No need for a separate type - just use: ThreadEvent with type: 'COMPACTION'
```

### Conversation Reconstruction
The system builds conversations differently after compaction:
- **Before compaction**: Use all events in chronological order
- **After compaction**: Use `compactedEvents` from latest COMPACTION + events after that

### Strategy Pattern
Different compaction approaches implemented as pluggable strategies:
- `TrimToolResultsStrategy` - Truncate tool outputs to save tokens
- `SummarizeStrategy` - Replace old events with AI-generated summaries
- Future strategies can be added easily

## Task Breakdown

### Task 1: Define Core Types

**File to create:**
- `src/threads/compaction/types.ts`

**What to implement:**
```typescript
// ABOUTME: Core interfaces for the compaction event system
// ABOUTME: Defines strategy pattern and event types for conversation compaction

import type { ThreadEvent } from '~/threads/types';
import type { AIProvider } from '~/providers/base-provider';
import type { ToolExecutor } from '~/tools/tool-executor';

export interface CompactionData {
  strategyId: string;
  originalEventCount: number;
  compactedEvents: ThreadEvent[];
  metadata?: Record<string, unknown>;
}

// CompactionEvent is just a regular ThreadEvent with COMPACTION type and CompactionData

export interface CompactionStrategy {
  id: string;
  compact(events: ThreadEvent[], context: CompactionContext): Promise<ThreadEvent>;
}

export interface CompactionContext {
  threadId: string;
  provider?: AIProvider;
  toolExecutor?: ToolExecutor;
}
```

**Also update:**
- `src/threads/types.ts` - Add `'COMPACTION'` to the `EventType` union

**Test your changes:**
```bash
npm run build
# Should build without TypeScript errors
```

**Commit:** "Add core compaction event types and interfaces"

### Task 2: Update Event Type System

**File to modify:**
- `src/threads/types.ts`

**What to add:**
```typescript
// Add to EventType union (should be around line 8):
export type EventType = 
  | 'USER_MESSAGE' 
  | 'AGENT_MESSAGE' 
  | 'TOOL_CALL' 
  | 'TOOL_RESULT'
  | 'THINKING'
  | 'SYSTEM_PROMPT'
  | 'USER_SYSTEM_PROMPT'
  | 'COMPACTION';  // Add this line
```

**Why this matters:**
- TypeScript will now recognize COMPACTION as a valid event type
- Event processing code can handle compaction events properly
- Maintains type safety throughout the system

**Test your changes:**
```bash
npm run build
# Should build without errors
```

**Commit:** "Add COMPACTION to EventType union"

### Task 3: Create Conversation Builder Logic

**File to create:**
- `src/threads/conversation-builder.ts`

**What to implement:**
```typescript
// ABOUTME: Builds working conversations from thread events, handling compaction
// ABOUTME: Core logic for reconstructing conversations post-compaction

import type { ThreadEvent } from '~/threads/types';
import type { CompactionData } from '~/threads/compaction/types';

export function buildWorkingConversation(events: ThreadEvent[]): ThreadEvent[] {
  const lastCompaction = findLastCompactionEvent(events);
  
  if (!lastCompaction) {
    return events; // No compaction yet, use all events
  }
  
  // Use compacted events + everything after compaction
  const eventsAfterCompaction = getEventsAfter(events, lastCompaction.id);
  const compactionData = lastCompaction.data as CompactionData;
  return [
    ...compactionData.compactedEvents,
    ...eventsAfterCompaction
  ];
}

export function buildCompleteHistory(events: ThreadEvent[]): ThreadEvent[] {
  // Return all events including compaction events (for debugging/inspection)
  return events;
}

function findLastCompactionEvent(events: ThreadEvent[]): ThreadEvent | null {
  // Find the most recent COMPACTION event
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'COMPACTION') {
      return events[i];
    }
  }
  return null;
}

function getEventsAfter(events: ThreadEvent[], afterEventId: string): ThreadEvent[] {
  const afterIndex = events.findIndex(e => e.id === afterEventId);
  if (afterIndex === -1) return [];
  return events.slice(afterIndex + 1);
}
```

**Why this is important:**
- This is the core logic that makes compaction work
- `buildWorkingConversation` is what gets passed to AI providers
- `buildCompleteHistory` preserves all events for debugging

**Test your changes:**
```bash
npm run build
# Should build without errors
```

**Commit:** "Add conversation builder logic for compaction events"

### Task 4: Write Tests for Conversation Builder

**File to create:**
- `src/threads/conversation-builder.test.ts`

**What to implement:**
```typescript
import { describe, it, expect } from 'vitest';
import { buildWorkingConversation, buildCompleteHistory } from './conversation-builder';
import type { ThreadEvent } from './types';
import type { CompactionData } from './compaction/types';

describe('conversation-builder', () => {
  const mockEvents: ThreadEvent[] = [
    {
      id: 'e1',
      threadId: 'test-thread',
      type: 'USER_MESSAGE',
      timestamp: new Date('2024-01-01T10:00:00Z'),
      data: 'Hello'
    },
    {
      id: 'e2', 
      threadId: 'test-thread',
      type: 'AGENT_MESSAGE',
      timestamp: new Date('2024-01-01T10:01:00Z'),
      data: 'Hi there'
    },
    {
      id: 'e3',
      threadId: 'test-thread', 
      type: 'USER_MESSAGE',
      timestamp: new Date('2024-01-01T10:02:00Z'),
      data: 'How are you?'
    }
  ];

  describe('buildWorkingConversation', () => {
    it('returns all events when no compaction exists', () => {
      const result = buildWorkingConversation(mockEvents);
      expect(result).toEqual(mockEvents);
    });

    it('uses compacted events when compaction exists', () => {
      const compactionEvent: ThreadEvent = {
        id: 'comp1',
        threadId: 'test-thread',
        type: 'COMPACTION',
        timestamp: new Date('2024-01-01T10:03:00Z'),
        data: {
          strategyId: 'test-strategy',
          originalEventCount: 2,
          compactedEvents: [
            {
              id: 'c1',
              threadId: 'test-thread',
              type: 'AGENT_MESSAGE',
              timestamp: new Date('2024-01-01T10:01:00Z'),
              data: 'Summary: User said hello, I replied'
            }
          ]
        }
      };

      const newEvent: ThreadEvent = {
        id: 'e4',
        threadId: 'test-thread',
        type: 'AGENT_MESSAGE', 
        timestamp: new Date('2024-01-01T10:04:00Z'),
        data: 'I am fine'
      };

      const eventsWithCompaction = [...mockEvents, compactionEvent, newEvent];
      const result = buildWorkingConversation(eventsWithCompaction);

      expect(result).toEqual([
        (compactionEvent.data as CompactionData).compactedEvents[0],
        mockEvents[2], // Event after compaction
        newEvent
      ]);
    });

    it('uses latest compaction when multiple exist', () => {
      const firstCompaction: ThreadEvent = {
        id: 'comp1',
        threadId: 'test-thread',
        type: 'COMPACTION',
        timestamp: new Date('2024-01-01T10:03:00Z'),
        data: {
          strategyId: 'test-strategy',
          originalEventCount: 2,
          compactedEvents: [{
            id: 'c1',
            threadId: 'test-thread', 
            type: 'AGENT_MESSAGE',
            timestamp: new Date('2024-01-01T10:01:00Z'),
            data: 'First summary'
          }]
        }
      };

      const secondCompaction: ThreadEvent = {
        id: 'comp2',
        threadId: 'test-thread',
        type: 'COMPACTION', 
        timestamp: new Date('2024-01-01T10:05:00Z'),
        data: {
          strategyId: 'test-strategy',
          originalEventCount: 3,
          compactedEvents: [{
            id: 'c2',
            threadId: 'test-thread',
            type: 'AGENT_MESSAGE',
            timestamp: new Date('2024-01-01T10:01:00Z'),
            data: 'Second summary'
          }]
        }
      };

      const eventsWithTwoCompactions = [...mockEvents, firstCompaction, secondCompaction];
      const result = buildWorkingConversation(eventsWithTwoCompactions);

      expect(result).toEqual((secondCompaction.data as CompactionData).compactedEvents);
    });
  });

  describe('buildCompleteHistory', () => {
    it('returns all events including compaction events', () => {
      const compactionEvent: ThreadEvent = {
        id: 'comp1',
        threadId: 'test-thread',
        type: 'COMPACTION',
        timestamp: new Date('2024-01-01T10:03:00Z'), 
        data: {
          strategyId: 'test-strategy',
          originalEventCount: 2,
          compactedEvents: []
        }
      };

      const allEvents = [...mockEvents, compactionEvent];
      const result = buildCompleteHistory(allEvents);
      
      expect(result).toEqual(allEvents);
    });
  });
});
```

**Run your tests:**
```bash
npm test src/threads/conversation-builder.test.ts
# All tests should pass
```

**Commit:** "Add comprehensive tests for conversation builder"

### Task 5: Update ThreadManager with New API

**File to modify:**
- `src/threads/thread-manager.ts`

**What to add:**
```typescript
// Add these imports at the top:
import { buildWorkingConversation, buildCompleteHistory } from './conversation-builder';
import type { CompactionStrategy } from './compaction/types';

// Add these properties to the ThreadManager class:
private _compactionStrategies = new Map<string, CompactionStrategy>();

// Add these methods to the ThreadManager class:

/**
 * Get current conversation state (post-compaction events)
 * This is what should be passed to AI providers
 */
getEvents(threadId: string): ThreadEvent[] {
  const thread = this.getThread(threadId);
  if (!thread) return [];
  
  return buildWorkingConversation(thread.events);
}

/**
 * Get complete event history including compaction events
 * This is for debugging and inspection
 */
getAllEvents(threadId: string): ThreadEvent[] {
  const thread = this.getThread(threadId);
  if (!thread) return [];
  
  return buildCompleteHistory(thread.events);
}

/**
 * Register a compaction strategy
 */
registerCompactionStrategy(strategy: CompactionStrategy): void {
  this._compactionStrategies.set(strategy.id, strategy);
}

/**
 * Perform compaction using specified strategy
 */
async compact(threadId: string, strategyId: string, params?: unknown): Promise<void> {
  const strategy = this._compactionStrategies.get(strategyId);
  if (!strategy) {
    throw new Error(`Unknown compaction strategy: ${strategyId}`);
  }

  const thread = this.getThread(threadId);
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }

  // Create compaction context
  const context = {
    threadId,
    params
  };

  // Run compaction strategy
  const compactionEvent = await strategy.compact(thread.events, context);
  
  // Add the compaction event to the thread
  // The compactionEvent is already a complete ThreadEvent with data in the data field
  await this.addEvent(threadId, 'COMPACTION', compactionEvent.data);
}
```

**IMPORTANT:** 
- The existing `getEvents` method (if any) should be replaced
- Keep all other ThreadManager functionality intact
- Don't break existing thread creation, event adding, etc.

**Test your changes:**
```bash
npm run build
# Should build without errors
```

**Commit:** "Add compaction API methods to ThreadManager"

### Task 6: Create a Simple Compaction Strategy

**File to create:**
- `src/threads/compaction/trim-tool-results-strategy.ts`

**What to implement:**
```typescript
// ABOUTME: Compaction strategy that truncates tool results to save token space
// ABOUTME: Preserves conversation flow while reducing tool output size

import type { ThreadEvent } from '~/threads/types';  
import type { CompactionStrategy, CompactionContext } from './types';

export class TrimToolResultsStrategy implements CompactionStrategy {
  id = 'trim-tool-results';
  
  async compact(events: ThreadEvent[], context: CompactionContext): Promise<ThreadEvent> {
    const compactedEvents: ThreadEvent[] = [];
    let modifiedCount = 0;

    for (const event of events) {
      if (event.type === 'TOOL_RESULT') {
        // Trim tool result content
        const trimmedEvent = this.trimToolResult(event);
        compactedEvents.push(trimmedEvent);
        if (trimmedEvent.data !== event.data) {
          modifiedCount++;
        }
      } else {
        // Keep other events unchanged
        compactedEvents.push(event);
      }
    }

    // Create the compaction event with data in the data field
    const compactionEvent: ThreadEvent = {
      id: this.generateEventId(),
      threadId: context.threadId,
      type: 'COMPACTION',
      timestamp: new Date(),
      data: {
        strategyId: this.id,
        originalEventCount: events.length,
        compactedEvents,
        metadata: {
          toolResultsModified: modifiedCount,
          maxLines: 3,
          truncationMessage: '[results truncated to save space.]'
        }
      }
    };

    return compactionEvent;
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private trimToolResult(event: ThreadEvent): ThreadEvent {
    if (typeof event.data === 'string') {
      return {
        ...event,
        data: this.truncateString(event.data)
      };
    }

    // Handle ToolResult objects (they have a 'content' field)
    if (event.data && typeof event.data === 'object' && 'content' in event.data) {
      const toolResult = event.data as { content: Array<{ type: string; text?: string }>; [key: string]: unknown };
      
      const truncatedContent = toolResult.content.map(block => {
        if (block.type === 'text' && block.text) {
          return {
            ...block,
            text: this.truncateString(block.text)
          };
        }
        return block;
      });

      return {
        ...event,
        data: {
          ...toolResult,
          content: truncatedContent
        }
      };
    }

    // If we don't recognize the format, return unchanged
    return event;
  }

  private truncateString(text: string): string {
    const lines = text.split('\n');
    if (lines.length <= 3) {
      return text; // No truncation needed
    }

    const truncatedLines = lines.slice(0, 3);
    truncatedLines.push('[results truncated to save space.]');
    return truncatedLines.join('\n');
  }
}
```

**Test your changes:**
```bash
npm run build
# Should build without errors
```

**Commit:** "Add TrimToolResultsStrategy compaction implementation"

### Task 7: Write Tests for TrimToolResultsStrategy

**File to create:**
- `src/threads/compaction/trim-tool-results-strategy.test.ts`

**What to implement:**
```typescript
import { describe, it, expect } from 'vitest';
import { TrimToolResultsStrategy } from './trim-tool-results-strategy';
import type { ThreadEvent } from '~/threads/types';
import type { CompactionContext } from './types';

describe('TrimToolResultsStrategy', () => {
  const strategy = new TrimToolResultsStrategy();
  
  const mockContext: CompactionContext = {
    threadId: 'test-thread'
  };

  it('has correct strategy id', () => {
    expect(strategy.id).toBe('trim-tool-results');
  });

  describe('compact', () => {
    it('preserves non-tool-result events unchanged', async () => {
      const events: ThreadEvent[] = [
        {
          id: 'e1',
          threadId: 'test-thread',
          type: 'USER_MESSAGE',
          timestamp: new Date(),
          data: 'Hello'
        },
        {
          id: 'e2', 
          threadId: 'test-thread',
          type: 'AGENT_MESSAGE',
          timestamp: new Date(),
          data: 'Hi there'
        }
      ];

      const result = await strategy.compact(events, mockContext);
      
      expect(result.type).toBe('COMPACTION');
      expect(result.data.compactedEvents).toEqual(events);
      expect(result.data.strategyId).toBe('trim-tool-results');
      expect(result.data.originalEventCount).toBe(2);
    });

    it('truncates string tool results longer than 3 lines', async () => {
      const longResult = 'line1\nline2\nline3\nline4\nline5';
      const events: ThreadEvent[] = [
        {
          id: 'e1',
          threadId: 'test-thread', 
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: longResult
        }
      ];

      const result = await strategy.compact(events, mockContext);
      
      expect(result.data.compactedEvents[0].data).toBe(
        'line1\nline2\nline3\n[results truncated to save space.]'
      );
    });

    it('preserves short tool results unchanged', async () => {
      const shortResult = 'line1\nline2';
      const events: ThreadEvent[] = [
        {
          id: 'e1',
          threadId: 'test-thread',
          type: 'TOOL_RESULT', 
          timestamp: new Date(),
          data: shortResult
        }
      ];

      const result = await strategy.compact(events, mockContext);
      
      expect(result.data.compactedEvents[0].data).toBe(shortResult);
    });

    it('handles ToolResult objects with content array', async () => {
      const toolResult = {
        content: [
          { 
            type: 'text', 
            text: 'line1\nline2\nline3\nline4\nline5' 
          }
        ],
        isError: false,
        id: 'tool-123'
      };

      const events: ThreadEvent[] = [
        {
          id: 'e1',
          threadId: 'test-thread',
          type: 'TOOL_RESULT',
          timestamp: new Date(), 
          data: toolResult
        }
      ];

      const result = await strategy.compact(events, mockContext);
      
      const compactedData = result.data.compactedEvents[0].data as typeof toolResult;
      expect(compactedData.content[0].text).toBe(
        'line1\nline2\nline3\n[results truncated to save space.]'
      );
      expect(compactedData.isError).toBe(false);
      expect(compactedData.id).toBe('tool-123');
    });

    it('includes correct metadata', async () => {
      const events: ThreadEvent[] = [
        {
          id: 'e1',
          threadId: 'test-thread',
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: 'line1\nline2\nline3\nline4'
        },
        {
          id: 'e2',
          threadId: 'test-thread', 
          type: 'USER_MESSAGE',
          timestamp: new Date(),
          data: 'Hello'
        }
      ];

      const result = await strategy.compact(events, mockContext);
      
      expect(result.data.metadata).toEqual({
        toolResultsModified: 1,
        maxLines: 3,
        truncationMessage: '[results truncated to save space.]'
      });
    });
  });
});
```

**Run your tests:**
```bash
npm test src/threads/compaction/trim-tool-results-strategy.test.ts
# All tests should pass
```

**Commit:** "Add comprehensive tests for TrimToolResultsStrategy"

### Task 8: Create Strategy Registry

**File to create:**
- `src/threads/compaction/registry.ts`

**What to implement:**
```typescript
// ABOUTME: Central registry for compaction strategies  
// ABOUTME: Handles strategy registration and initialization

import { TrimToolResultsStrategy } from './trim-tool-results-strategy';
import type { CompactionStrategy } from './types';

export function createDefaultStrategies(): CompactionStrategy[] {
  return [
    new TrimToolResultsStrategy()
  ];
}

export function registerDefaultStrategies(
  registerFn: (strategy: CompactionStrategy) => void
): void {
  const strategies = createDefaultStrategies();
  for (const strategy of strategies) {
    registerFn(strategy);
  }
}
```

**Why this exists:**
- Centralized place to add new strategies
- Makes it easy to register all available strategies
- Future strategies can be added here

**Test your changes:**
```bash
npm run build
# Should build without errors
```

**Commit:** "Add compaction strategy registry"

### Task 9: Update ThreadManager to Auto-Register Strategies

**File to modify:**
- `src/threads/thread-manager.ts`

**What to add:**
```typescript
// Add import:
import { registerDefaultStrategies } from './compaction/registry';

// In the constructor, add:
constructor() {
  this._persistence = getPersistence();
  this._compactionStrategy = new SummarizeStrategy();
  
  // Register default compaction strategies
  registerDefaultStrategies((strategy) => {
    this.registerCompactionStrategy(strategy);
  });
}
```

**Also remove:**
- `this._compactionStrategy = new SummarizeStrategy();` (this was shadow thread code)
- Any other shadow thread initialization

**Why this is needed:**
- ThreadManager needs to know about available strategies
- Auto-registration makes strategies available immediately
- No manual setup required

**Test your changes:**
```bash
npm run build
# Should build without errors
```

**Commit:** "Auto-register compaction strategies in ThreadManager"

### Task 10: Write Integration Tests

**File to create:**
- `src/threads/compaction-integration.test.ts`

**What to implement:**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadManager } from './thread-manager';
import { TrimToolResultsStrategy } from './compaction/trim-tool-results-strategy';

describe('Compaction Integration', () => {
  let threadManager: ThreadManager;
  let threadId: string;

  beforeEach(() => {
    threadManager = new ThreadManager();
    threadId = threadManager.createThread();
  });

  it('creates working conversation without compaction', () => {
    // Add some events
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello');
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'Hi there');
    
    const workingEvents = threadManager.getEvents(threadId);
    const allEvents = threadManager.getAllEvents(threadId);
    
    expect(workingEvents).toHaveLength(2);
    expect(allEvents).toHaveLength(2);
    expect(workingEvents).toEqual(allEvents);
  });

  it('compacts conversation using trim-tool-results strategy', async () => {
    // Add events including a long tool result
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'List files');
    threadManager.addEvent(threadId, 'TOOL_CALL', { name: 'list_files', args: {} });
    threadManager.addEvent(threadId, 'TOOL_RESULT', 'file1.txt\nfile2.txt\nfile3.txt\nfile4.txt\nfile5.txt');
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'Found 5 files');
    
    expect(threadManager.getAllEvents(threadId)).toHaveLength(4);
    
    // Perform compaction
    await threadManager.compact(threadId, 'trim-tool-results');
    
    // Check results
    const allEvents = threadManager.getAllEvents(threadId);
    const workingEvents = threadManager.getEvents(threadId);
    
    expect(allEvents).toHaveLength(5); // Original 4 + 1 compaction event
    expect(workingEvents).toHaveLength(4); // Compacted conversation length
    
    // Find the tool result in working conversation
    const toolResult = workingEvents.find(e => e.type === 'TOOL_RESULT');
    expect(toolResult).toBeDefined();
    expect(toolResult!.data).toBe('file1.txt\nfile2.txt\nfile3.txt\n[results truncated to save space.]');
  });

  it('continues conversation after compaction', async () => {
    // Set up conversation and compact it
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello');
    threadManager.addEvent(threadId, 'TOOL_RESULT', 'line1\nline2\nline3\nline4\nline5');
    
    await threadManager.compact(threadId, 'trim-tool-results');
    
    // Add more events after compaction
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'What next?');
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'Let me help');
    
    const workingEvents = threadManager.getEvents(threadId);
    const allEvents = threadManager.getAllEvents(threadId);
    
    // Working conversation should include compacted events + new events
    expect(workingEvents).toHaveLength(4); // 2 compacted + 2 new
    
    // All events should include original + compaction event + new events  
    expect(allEvents).toHaveLength(6); // 2 original + 1 compaction + 2 new
    
    // Last two events should be the new ones
    expect(workingEvents[2].data).toBe('What next?');
    expect(workingEvents[3].data).toBe('Let me help');
  });

  it('handles multiple compactions', async () => {
    // Create initial conversation
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello');
    threadManager.addEvent(threadId, 'TOOL_RESULT', 'long\nresult\nhere\nextra\nlines');
    
    // First compaction
    await threadManager.compact(threadId, 'trim-tool-results');
    
    // Add more events
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'Continue');
    threadManager.addEvent(threadId, 'TOOL_RESULT', 'another\nlong\nresult\nwith\nextra\nlines');
    
    // Second compaction
    await threadManager.compact(threadId, 'trim-tool-results');
    
    const workingEvents = threadManager.getEvents(threadId);
    const allEvents = threadManager.getAllEvents(threadId);
    
    // Should use the latest compaction
    expect(workingEvents).toHaveLength(4); // Latest compaction results
    expect(allEvents).toHaveLength(8); // All events including both compactions
    
    // Check that latest compaction is used
    const compactionEvents = allEvents.filter(e => e.type === 'COMPACTION');
    expect(compactionEvents).toHaveLength(2);
  });

  it('throws error for unknown strategy', async () => {
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello');
    
    await expect(
      threadManager.compact(threadId, 'unknown-strategy')
    ).rejects.toThrow('Unknown compaction strategy: unknown-strategy');
  });

  it('throws error for non-existent thread', async () => {
    await expect(
      threadManager.compact('non-existent-thread', 'trim-tool-results')
    ).rejects.toThrow('Thread non-existent-thread not found');
  });
});
```

**Run your tests:**
```bash
npm test src/threads/compaction-integration.test.ts
# All tests should pass
```

**Commit:** "Add comprehensive compaction integration tests"

### Task 11: Update Agent to Use New API

**File to modify:**
- `src/agents/agent.ts`

**What to change:**
Find the conversation building logic in Agent (around `buildConversationFromEvents` or similar) and update it to use the new API:

```typescript
// OLD (probably something like):
// const events = this._threadManager.getEvents(this._threadId);

// NEW:
const events = this._threadManager.getEvents(this._threadId); // This now returns working conversation
```

**Important notes:**
- The `getEvents()` method now returns the working conversation (post-compaction)
- You don't need to change the method call, just verify it uses the new implementation
- The Agent should not need to know about compaction - it just gets clean conversation events

**Test your changes:**
```bash
npm run build
npm run test:unit
# Agent tests should pass
```

**Commit:** "Update Agent to use new conversation building API"

### Task 12: Add Manual Compaction Command (Optional)

**File to create:**
- `src/commands/compact.ts`

**What to implement:**
```typescript
// ABOUTME: CLI command for manually triggering conversation compaction
// ABOUTME: Useful for testing and manual conversation maintenance

import { ThreadManager } from '~/threads/thread-manager';
import { logger } from '~/utils/logger';

export interface CompactOptions {
  threadId: string;
  strategy: string;
}

export async function compactCommand(options: CompactOptions): Promise<void> {
  const threadManager = new ThreadManager();
  
  try {
    const beforeEvents = threadManager.getAllEvents(options.threadId);
    logger.info(`Thread ${options.threadId} has ${beforeEvents.length} events before compaction`);
    
    await threadManager.compact(options.threadId, options.strategy);
    
    const afterAllEvents = threadManager.getAllEvents(options.threadId);
    const afterWorkingEvents = threadManager.getEvents(options.threadId);
    
    logger.info(`Compaction complete:`, {
      totalEvents: afterAllEvents.length,
      workingEvents: afterWorkingEvents.length,
      strategy: options.strategy
    });
    
  } catch (error) {
    logger.error('Compaction failed:', error);
    throw error;
  }
}
```

**Why this is useful:**
- Allows manual testing of compaction
- Provides visibility into compaction results
- Can be used for maintenance operations

**Test your changes:**
```bash
npm run build
# Should build without errors
```

**Commit:** "Add manual compaction CLI command"

### Task 13: Run Full Test Suite

**What to do:**
```bash
npm run build
npm run lint  
npm test
```

**Expected results:**
- Build should succeed
- Linting should pass
- All tests should pass
- No TypeScript errors

**If tests fail:**
1. Check error messages carefully
2. Look for missing imports or type errors
3. Verify you didn't break existing functionality
4. Make sure your new code follows TypeScript strict mode

**Common issues:**
- Missing imports for new types
- Incorrect event type handling
- Thread ID mismatching in tests

**Commit:** "All tests passing after compaction implementation"

### Task 14: Manual Testing

**What to test:**
```bash
# Start the application
npm start

# Create a conversation with tool calls that generate long results
# Let conversation accumulate events
# Manually trigger compaction (if you added the command)
# Verify conversation continues normally
```

**What should work:**
- Creating conversations
- Adding events
- Compacting conversations
- Continuing conversations after compaction
- Thread IDs remain stable throughout

**What to verify:**
- Compacted conversations are shorter but maintain key information
- New events after compaction work normally
- Thread persistence works correctly
- No performance regressions

**Commit:** "Manual testing complete - compaction system working"

## Success Criteria

When Phase 2 is complete:

1. **Compaction events work** - Can compact conversations using strategies
2. **Conversation reconstruction works** - Working conversations built correctly
3. **Multiple strategies supported** - At least TrimToolResultsStrategy working
4. **Thread IDs stable** - Threads never change IDs during compaction
5. **Tests comprehensive** - Good test coverage for new functionality
6. **Integration complete** - Agent and ThreadManager work with new system
7. **Original events preserved** - Can still access complete history for debugging

## What You've Accomplished

- Built a clean, extensible compaction system
- Implemented strategy pattern for different compaction approaches
- Maintained thread ID stability (no dual-ID complexity)
- Created comprehensive test coverage
- Preserved all original functionality while adding compaction capability

The system now has clean, maintainable compaction without the complexity of the old shadow thread system.

## Advanced Features (Future Work)

These are NOT required for Phase 2 completion, but could be added later:

- **Auto-compaction triggers** - Compact when conversations reach token limits
- **Multiple strategy types** - Summarization, semantic clustering, etc.  
- **Compaction policies** - Rules about when/how to compact
- **Performance optimizations** - Caching, lazy loading
- **Compaction analytics** - Track compaction effectiveness

## If You Get Stuck

1. **TypeScript errors:** Focus on proper typing, never use `any`
2. **Test failures:** Make sure test data matches your type definitions
3. **Integration issues:** Verify the conversation builder logic is correct
4. **Build errors:** Check all imports and exports are correct

Remember: The goal is working compaction with clean, maintainable code. When in doubt, keep it simple and well-tested.

## Implementation Status (2025-07-23)

**NOT STARTED:** Phase 2 compaction events implementation is ready to begin.

### Prerequisites Completed
- Phase 1 shadow thread removal is complete
- Core thread management functionality is working
- Database is reset to clean state
- Codebase is ready for compaction event implementation

### Current Status
**⏳ Ready to Begin:** All 14 tasks in Phase 2 are pending implementation  
**🔄 Next: Task 1** - Define Core Types (CompactionData, CompactionStrategy interfaces)
**⏳ Pending: Tasks 2-14** - Event types, conversation builder, ThreadManager API, strategies, tests

### What Needs to Be Built
The compaction event system as specified in the task breakdown above, starting with Task 1: Define Core Types.