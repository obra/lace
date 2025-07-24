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
Pluggable strategy for managing context window limits:
- `CompactionStrategy` interface for extensibility
- `SummarizeStrategy` default implementation
- Preserves all user/agent messages
- Compresses tool operations and metadata
- Creates new thread versions transparently

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

### 3. Compaction (Automatic)
When approaching token limits:
```typescript
if (threadManager.needsCompaction()) {
  const compactedId = await threadManager.createCompactedVersion('Auto-compaction');
  // ThreadManager automatically switches to compacted version
}
```

### 4. Version Resolution
External references always use canonical ID:
```typescript
const canonicalId = threadManager.getCanonicalId(anyThreadId);
// Returns original thread ID regardless of compaction
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

### Token Management
The default `SummarizeStrategy`:
1. Monitors token usage (configurable threshold, default 100K)
2. Preserves all user and agent messages
3. Compresses tool calls/results into summaries
4. Maintains conversation continuity

### Version Management
- Original thread preserved for audit trail
- New versions created with compacted events
- Automatic switching to latest version
- Cleanup of old versions available (manual)

Example compaction:
```
Original: 15 events, 120K tokens
    ↓
Compacted: 11 events, 45K tokens
- All user/agent messages preserved
- Tool operations summarized
- Metadata compressed
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
- Compaction failure → continue with original thread
- Version lookup miss → treat as canonical ID

### Recovery Mechanisms
- Database corruption → reinitialize schema
- Missing events → fail safely with error
- Orphaned tool calls → handle in conversation builder

## Future Enhancements

### Advanced Compaction
- Semantic clustering of conversations
- User-configurable preservation rules
- Multi-stage compaction strategies
- ML-based importance scoring

### Performance
- Event streaming for large threads
- Distributed storage backends
- Read replicas for scaling
- Event compression

### Features
- Thread branching/merging
- Collaborative editing
- Version diffing
- Export/import capabilities

## Best Practices

### For Developers
1. Always use canonical IDs for external references
2. Let ThreadManager handle version switching
3. Don't modify events after creation
4. Use transactions for multi-step operations

### For Thread Design
1. Keep events focused and atomic
2. Include sufficient context in each event
3. Use appropriate event types
4. Consider compaction when designing event data

### For Performance
1. Monitor token usage proactively
2. Configure appropriate compaction thresholds
3. Clean up old versions periodically
4. Index custom queries appropriately

## Migration Path

The system supports incremental enhancement:
1. Existing threads work without modification
2. Compaction applied only when needed
3. Version tables created on first use
4. Full backward compatibility maintained

## Security Considerations

- Thread IDs include random components
- No sensitive data in thread IDs
- Event data encrypted at rest (SQLite)
- Audit trail via version history

## Conclusion

The thread management system provides a robust foundation for conversational AI with:
- Immutable event sourcing for reliability
- Transparent compaction for scalability
- Version management for continuity
- Extensible architecture for future enhancements

This design enables Lace to handle conversations of any length while maintaining performance, reliability, and full conversation history.