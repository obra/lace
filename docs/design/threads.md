# Thread Management Design

## Overview

Lace uses an event-sourcing architecture where conversations are stored as immutable sequences of events. Each conversation is represented by a thread, which provides a durable, resumable record of all interactions between users and AI agents.

## Core Concepts

### Threads
A **thread** represents a complete conversation history. Each thread has:
- A unique ID (format: `lace_YYYYMMDD_randomid`)
- An ordered sequence of events
- Creation and update timestamps
- Support for parent-child relationships (delegation)
- **Stable ID**: Thread IDs never change, even during compaction

### Events
Events are immutable records of actions within a conversation:
- `USER_MESSAGE` - User input
- `AGENT_MESSAGE` - AI response
- `TOOL_CALL` - Tool invocation
- `TOOL_RESULT` - Tool execution result
- `THINKING` - Agent reasoning process
- `SYSTEM_PROMPT` - System instructions
- `LOCAL_SYSTEM_MESSAGE` - UI-only messages
- `COMPACTION` - Compaction event containing compacted conversation state

### Compaction Events
To handle context window limits, threads use compaction events:
- **Compaction Event**: Special event containing compacted conversation history
- **Working Conversation**: Current conversation state built from latest compaction + recent events
- **Complete History**: All events including compaction events (for debugging/audit)

## Architecture

### Layer Structure

```
┌─────────────────────────────────────┐
│         Agent Layer                 │  - Uses threads to build conversations
├─────────────────────────────────────┤
│      ThreadManager                  │  - High-level thread operations
├─────────────────────────────────────┤
│     ThreadPersistence               │  - SQLite storage with migrations
├─────────────────────────────────────┤
│      Event Storage                  │  - Immutable event sequences
└─────────────────────────────────────┘
```

### Key Components

#### ThreadManager (`src/threads/thread-manager.ts`)
Central coordinator for thread operations:
- Thread creation and lifecycle management
- Event addition and retrieval
- Parent-child thread relationships (delegation)
- Compaction strategy registration and execution

Key methods:
```typescript
createThread(threadId: string): Thread
addEvent(threadId: string, type: EventType, data: any): ThreadEvent
getEvents(threadId: string): ThreadEvent[]  // Returns working conversation
getAllEvents(threadId: string): ThreadEvent[]  // Returns complete history
registerCompactionStrategy(strategy: CompactionStrategy): void
compact(threadId: string, strategyId: string): Promise<void>
```

#### ThreadPersistence (`src/threads/persistence.ts`)
SQLite-based storage layer with graceful degradation:
- Database schema management with migrations
- Thread and event persistence
- Transaction support for atomic operations
- Memory-only fallback when disk unavailable

Database schema:
```sql
-- Core tables
threads (id, created_at, updated_at)
events (id, thread_id, type, data, created_at)
```

#### Compaction System (`src/threads/compaction/`)
Event-based strategy for managing context window limits:
- `CompactionStrategy` interface for extensibility
- `TrimToolResultsStrategy` example implementation
- Creates `COMPACTION` events containing compacted conversation state
- Preserves thread ID stability (no new threads created)
- Strategy registry for pluggable compaction approaches

#### Conversation Builder (`src/threads/conversation-builder.ts`)
Logic for reconstructing conversations from events:
- `buildWorkingConversation()` - Returns current conversation state (post-compaction)
- `buildCompleteHistory()` - Returns all events including compaction events
- Automatically uses latest compaction + events after compaction
- Transparent handling of compaction events

## Thread Lifecycle

### 1. Creation
```typescript
const threadId = threadManager.generateThreadId(); // lace_20250703_abc123
const thread = threadManager.createThread(threadId);
```

### 2. Event Addition
```typescript
threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello');
threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'Hi! How can I help?');
```

### 3. Compaction (Manual or Automatic)
When approaching token limits:
```typescript
await threadManager.compact(threadId, 'trim-tool-results');
// Creates COMPACTION event within same thread
// Thread ID remains stable
```

### 4. Working Conversation Retrieval
Get current conversation state:
```typescript
const workingEvents = threadManager.getEvents(threadId);
// Returns compacted conversation (latest compaction + events after)
const allEvents = threadManager.getAllEvents(threadId);
// Returns complete history including all COMPACTION events
```

## Delegation Pattern

Child threads for sub-conversations:
```
parent_thread_id
├── parent_thread_id.1  (first delegate)
├── parent_thread_id.2  (second delegate)
└── parent_thread_id.1.1 (nested delegate)
```

## Compaction Strategy

### Event-Based Compaction
The system uses `COMPACTION` events to manage token usage:
1. Strategy determines how to compact conversation events
2. Creates new `COMPACTION` event containing compacted conversation state
3. Conversation rebuilder uses latest compaction + subsequent events
4. Thread ID remains stable throughout compaction process

### Strategy Types
- **TrimToolResultsStrategy**: Truncates tool outputs to save tokens
- **Future strategies**: Summarization, semantic clustering, etc.

### Compaction Process
```typescript
interface CompactionData {
  strategyId: string;
  originalEventCount: number;
  compactedEvents: ThreadEvent[];
  metadata?: Record<string, unknown>;
}
```

Example compaction workflow:
```
Thread events: [USER_MESSAGE, TOOL_CALL, TOOL_RESULT(long), AGENT_MESSAGE]
                           ↓ (compact using trim-tool-results)
Compacted thread: [COMPACTION_EVENT{compactedEvents: [USER_MESSAGE, TOOL_CALL, TOOL_RESULT(trimmed), AGENT_MESSAGE]}]
Working conversation: [USER_MESSAGE, TOOL_CALL, TOOL_RESULT(trimmed), AGENT_MESSAGE]
```

## Implementation Details

### Thread ID Format
```
lace_YYYYMMDD_randomid
```
- Date component for human readability
- Random component for uniqueness
- Hierarchical for delegation (.1, .2, etc)

### Event Ordering
- Events have auto-incrementing IDs
- Ordered by ID, not timestamp
- Critical for consistent reconstruction

### Transaction Safety
- All database operations use transactions
- Atomic creation of compacted versions
- Foreign key constraints ensure integrity

### Performance Optimizations
- Lazy loading of events
- Indexed queries on thread_id
- Configurable retention policies
- Background compaction available

## Error Handling

### Graceful Degradation
- SQLite unavailable → memory-only operation
- Compaction failure → continue with uncompacted thread
- Strategy not found → throw descriptive error

### Recovery Mechanisms
- Database corruption → reinitialize schema
- Missing events → fail safely with error
- Orphaned tool calls → handle in conversation builder
- Invalid compaction data → skip compaction and use all events

## Future Enhancements

### Advanced Compaction
- AI-powered conversation summarization strategies
- User-configurable preservation rules
- Multi-stage compaction (e.g., trim then summarize)
- Context-aware compaction based on conversation topics

### Performance
- Auto-compaction triggers based on token thresholds
- Lazy loading of compacted events
- Background compaction processing
- Configurable compaction policies

### Features
- Compaction analytics and effectiveness tracking
- Custom compaction strategies via plugins
- Conversation diffing before/after compaction
- Export/import of compacted conversations

## Best Practices

### For Developers
1. Use `getEvents()` for working conversation, `getAllEvents()` for debugging
2. Register compaction strategies during ThreadManager initialization
3. Don't modify events after creation (immutability principle)
4. Use transactions for multi-step operations

### For Thread Design
1. Keep events focused and atomic
2. Include sufficient context in each event
3. Use appropriate event types
4. Design event data with compaction in mind (avoid excessive nesting)

### For Compaction
1. Test compaction strategies thoroughly with real conversation data
2. Monitor compaction effectiveness (token reduction ratios)
3. Choose strategies appropriate for conversation patterns
4. Consider multiple compaction stages for large conversations

## Migration Path

The system supports incremental enhancement:
1. Existing threads work without modification
2. Compaction applied only when manually triggered or auto-compaction enabled
3. No database schema changes required (uses existing events table)
4. Full backward compatibility maintained

## Security Considerations

- Thread IDs include random components
- No sensitive data in thread IDs
- Event data encrypted at rest (SQLite)
- Audit trail via version history

## Conclusion

The thread management system provides a robust foundation for conversational AI with:
- Immutable event sourcing for reliability
- Event-based compaction for scalability
- Thread ID stability for simplicity
- Extensible strategy pattern for different compaction approaches

This design enables Lace to handle conversations of any length while maintaining performance, reliability, and full conversation history. The elimination of complex dual-ID systems and thread versioning makes the system much more maintainable and easier to reason about.