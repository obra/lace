# New Thread Manager Design: Compaction Events

**Date:** 2025-07-23  
**Status:** Design Proposal  
**Replaces:** Thread shadowing with dual-ID system

## Problem Statement

The current thread shadowing implementation (f/thread-shadowing branch) creates significant complexity:

- **Dual-ID system** requires constant translation between canonical and version IDs
- **Complex database schema** with dedicated versioning tables (`thread_versions`, `version_history`)  
- **Lookup table explosion** as version mappings accumulate over time
- **Heavyweight shadow creation** with complex transaction handling
- **Thread IDs change** underneath sessions, causing confusion

Despite this complexity, the compaction strategy preserves most events as "important" (USER_MESSAGE, AGENT_MESSAGE, TOOL_CALL, TOOL_RESULT), providing minimal actual token reduction.

## Design Goals

1. **Stable thread IDs** - Thread IDs never change during compaction
2. **Simple database schema** - No versioning tables or dual-ID lookups
3. **Flexible compaction strategies** - Support different approaches for different conversation types
4. **Full reconstruction capability** - Ability to rebuild pre-compaction state
5. **Persistent compacted views** - Compacted state becomes the new working conversation

## Core Architecture

### Compaction as Special Events

Instead of creating separate shadow threads, compaction results are stored as special `COMPACTION` events within the same thread:

```typescript
interface CompactionEvent extends ThreadEvent {
  type: 'COMPACTION';
  strategyId: string;                    // 'trim-tool-results', 'summarize-and-reload', etc.
  originalEventCount: number;            // Number of events replaced
  compactedEvents: ThreadEvent[];        // New synthetic events replacing originals
  metadata?: Record<string, unknown>;    // Strategy-specific data
}
```

### Timeline Model

**Before Compaction:**
```
[e1, e2, e3, ..., e87]
```

**After Compaction:**
```
[e1, e2, e3, ..., e87, COMPACTION_EVENT, e88, e89, ...]
     └─── replaced by compactedEvents ────┘  └─ continues normally ─┘
```

### Working Conversation Construction

The conversation builder determines what events to use for the current conversation:

```typescript
function buildWorkingConversation(threadId: string): ThreadEvent[] {
  const allEvents = threadManager.getAllEvents(threadId);
  const lastCompaction = findLastEvent(allEvents, 'COMPACTION');
  
  if (!lastCompaction) {
    return allEvents; // No compaction yet
  }
  
  // Use compacted events + everything after compaction
  const eventsAfterCompaction = getEventsAfter(allEvents, lastCompaction.id);
  return [
    ...lastCompaction.compactedEvents,  // Synthetic replacement events
    ...eventsAfterCompaction            // Real events after compaction
  ];
}
```

## API Design

### ThreadManager Interface

```typescript
class ThreadManager {
  // Core thread operations
  createThread(): string
  deleteThread(threadId: string): void
  addEvent(threadId: string, event: ThreadEvent): void
  
  // Event access
  getEvents(threadId: string): ThreadEvent[]     // Current conversation state (post-compaction)
  getAllEvents(threadId: string): ThreadEvent[]  // Complete database events (includes COMPACTION events)
  
  // Compaction
  compact(threadId: string, strategyId: string, params?: unknown): void
  
  // Strategy management
  registerCompactionStrategy(strategy: CompactionStrategy): void
}
```

### Compaction Strategy Interface

```typescript
interface CompactionStrategy {
  id: string;
  compact(events: ThreadEvent[], context: CompactionContext): Promise<CompactionEvent>;
}

interface CompactionContext {
  threadId: string;
  provider?: AIProvider;
  toolExecutor?: ToolExecutor;
}
```

## Strategy Examples

### 1. Trim Tool Results Strategy

Preserves conversation flow but truncates tool result content:

```typescript
// Input: 87 events with large tool results
// Output compactedEvents:
[
  { type: 'USER_MESSAGE', content: 'List files' },
  { type: 'TOOL_CALL', name: 'list_files', args: {} },
  { 
    type: 'TOOL_RESULT', 
    data: { 
      content: [{ 
        type: 'text', 
        text: 'file1.txt\nfile2.txt\nfile3.txt\n[results truncated to save space.]' 
      }] 
    }
  },
  { type: 'AGENT_MESSAGE', content: 'I found these files...' }
]
```

### 2. Summarize and Reload Important Files Strategy

Replaces detailed tool interactions with summary and reloads key files:

```typescript
// Input: 87 events with extensive file operations
// Output compactedEvents:
[
  { 
    type: 'AGENT_MESSAGE', 
    content: `## Session Summary
I helped debug an authentication system. Key activities:
- Read 12 files across auth system and tests  
- Found issue in JWT token validation due to timezone handling
- Made 3 code edits to fix the middleware
- Verified fixes with test runs

## Important Files Reloaded:` 
  },
  { type: 'TOOL_CALL', name: 'read_file', args: { path: 'src/auth/middleware.ts' } },
  { type: 'TOOL_RESULT', data: { content: [{ type: 'text', text: '...' }] } },
  // ... 4 more important file reloads
]
```

## Key Benefits

### 1. Stable Thread IDs
- Thread IDs never change throughout compaction process
- No dual-ID lookup complexity
- APIs remain simple and consistent

### 2. Simple Database Schema
```sql
-- No versioning tables needed
CREATE TABLE threads (id TEXT PRIMARY KEY, ...);
CREATE TABLE events (id TEXT, thread_id TEXT, type TEXT, ...);
```

### 3. Full Reconstruction Capability
```typescript
// Get working conversation (compacted)
const workingEvents = threadManager.getEvents(threadId);

// Get complete history for debugging
const allEvents = threadManager.getAllEvents(threadId);

// Reconstruct pre-compaction state
const preCompactionEvents = allEvents.filter(e => e.type !== 'COMPACTION');
```

### 4. Strategy Flexibility
Different conversation types can use different compaction approaches:
- **Coding sessions**: Preserve user dialogue, summarize tool interactions, reload key files
- **Research conversations**: Compress information gathering, preserve insights
- **Creative writing**: Maintain narrative flow, compress revision cycles

### 5. Multiple Compaction Support
Strategies receive complete event history and can choose their scope:
- **Incremental**: Only compact events since last compaction
- **Full recompaction**: Ignore previous compactions, work from original events
- **Hybrid**: Build upon previous compactions selectively

## Implementation Notes

### Event Ordering
- Events ordered by timestamp rather than relying on synthetic IDs
- Conversation builder sorts by timestamp naturally
- No special handling needed for synthetic event ordering

### Tool Execution During Compaction
- Strategies can execute tools (e.g., reloading files) during compaction
- Tool execution provides fresh context when files may have changed
- Non-deterministic but intentionally so - reflects current state

### Storage Considerations
- Original events preserved alongside compaction events
- Storage increases initially but provides complete audit capability
- Consider cleanup policies for very old threads if needed

## Migration Path

1. **Phase 1**: Implement compaction event system alongside current shadow threads
2. **Phase 2**: Migrate existing strategies to new compaction event model
3. **Phase 3**: Remove dual-ID system and versioning tables
4. **Phase 4**: Clean up shadow thread remnants

## Comparison to Current System

| Aspect | Current (Shadow Threads) | New (Compaction Events) |
|--------|-------------------------|-------------------------|
| Thread ID stability | IDs change (canonical vs version) | IDs never change |
| Database schema | Complex versioning tables | Simple events table |
| Lookup complexity | Dual-ID translation required | Direct event access |
| Strategy flexibility | Fixed shadow creation process | Pluggable compaction strategies |
| Reconstruction | Complex version traversal | Filter out compaction events |
| Storage overhead | Duplicate thread data | Preserve original + compaction events |

## Open Questions

1. **Auto-compaction triggers**: When should compaction happen automatically?
2. **Cleanup policies**: Should very old compaction events be garbage collected?
3. **Strategy parameters**: How should strategy configuration be persisted?
4. **Error handling**: What happens if compaction strategy fails mid-process?