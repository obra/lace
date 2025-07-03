# Thread Shadowing Implementation Specification

## Overview
Thread shadowing allows conversations to continue working with compacted versions of threads while preserving the original history. When a thread grows too large, a "shadow" version is created with summarized/compacted content, and all operations transparently use the shadow.

## Background for Engineers

### What is Lace?
Lace is an AI coding assistant that stores conversations as sequences of events (event sourcing). Each conversation has a thread ID like `lace_20250703_abc123`.

### Current Problem
- Conversations hit token limits (context window overflow)
- Current compaction only truncates tool outputs
- Need deeper compaction that can summarize/remove old messages
- Thread IDs must remain stable for external references

### Key Files to Understand
- `src/threads/thread-manager.ts` - Manages thread lifecycle
- `src/threads/persistence.ts` - SQLite storage layer
- `src/threads/types.ts` - Thread and Event type definitions
- `src/agents/agent.ts` - Uses threads to build conversations

## Implementation Plan

### Phase 1: Database Schema Updates

**Task 1.1: Add thread versioning table**

1. Create migration in `src/threads/persistence.ts`
2. Add new table:
```sql
CREATE TABLE thread_versions (
  canonical_id TEXT PRIMARY KEY,
  current_version_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (current_version_id) REFERENCES threads(id)
);

CREATE TABLE version_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,
  FOREIGN KEY (canonical_id) REFERENCES thread_versions(canonical_id)
);
```

3. Write tests in `src/threads/__tests__/persistence.test.ts`:
   - Test table creation
   - Test foreign key constraints
   - Test migration from existing database

**Commit after tests pass**: "feat: add thread versioning schema"

### Phase 2: Update ThreadPersistence Class

**Task 2.1: Add version management methods**

File: `src/threads/persistence.ts`

Add methods:
```typescript
class ThreadPersistence {
  // Get current version for a canonical ID
  getCurrentVersion(canonicalId: string): string | null

  // Create new version for a thread
  createVersion(canonicalId: string, newVersionId: string, reason: string): void

  // Get version history
  getVersionHistory(canonicalId: string): VersionHistoryEntry[]
}
```

Tests to write:
- Test getCurrentVersion returns null for non-versioned threads
- Test getCurrentVersion returns current version
- Test createVersion creates first version
- Test createVersion updates existing version
- Test version history tracking

**Commit**: "feat: add thread version management to persistence"

**Task 2.2: Update loadThread to check versions**

Modify `loadThread()` to:
1. Check if thread ID exists in thread_versions as canonical_id
2. If yes, load current_version_id instead
3. If no, load normally

Tests:
- Test loading non-versioned thread works normally
- Test loading canonical ID returns current version
- Test loading specific version ID works

**Commit**: "feat: make loadThread version-aware"

### Phase 3: Update ThreadManager

**Task 3.1: Add version-aware methods**

File: `src/threads/thread-manager.ts`

Add:
```typescript
class ThreadManager {
  // Create shadow version of current thread
  async createShadowThread(reason: string): Promise<string>
  
  // Get canonical ID for any thread
  getCanonicalId(threadId: string): string
}
```

Implementation notes:
- createShadowThread should:
  1. Generate new thread ID
  2. Copy current thread to new ID (without events initially)
  3. Update thread_versions table
  4. Switch current thread to shadow

Tests:
- Test shadow creation
- Test canonical ID resolution
- Test thread switching after shadow creation

**Commit**: "feat: add shadow thread creation to ThreadManager"

### Phase 4: Implement Compaction Strategy

**Task 4.1: Create CompactionStrategy interface**

File: `src/threads/compaction/types.ts` (new)

```typescript
interface CompactionStrategy {
  // Analyze thread and determine if compaction needed
  shouldCompact(thread: Thread): boolean
  
  // Create compacted version of events
  compact(events: ThreadEvent[]): ThreadEvent[]
}
```

**Commit**: "feat: define compaction strategy interface"

**Task 4.2: Implement basic summarization strategy**

File: `src/threads/compaction/summarize-strategy.ts` (new)

Create a basic strategy that:
1. Groups old conversation segments
2. Creates summary events
3. Preserves recent messages
4. Preserves task-related messages

Tests:
- Test shouldCompact triggers at token limit
- Test summarization preserves key information
- Test recent messages kept intact

**Commit**: "feat: implement basic summarization compaction"

### Phase 5: Integration

**Task 5.1: Add compaction trigger to Agent**

File: `src/agents/agent.ts`

In the message processing flow:
1. Before building conversation, check if compaction needed
2. If yes, create shadow thread and compact
3. Continue with shadow thread

Tests:
- Test agent continues working after compaction
- Test thread ID stability in responses

**Commit**: "feat: integrate automatic compaction into agent"

### Phase 6: Testing & Documentation

**Task 6.1: End-to-end tests**

File: `src/threads/__tests__/compaction-e2e.test.ts` (new)

Test scenarios:
1. Long conversation triggers compaction
2. Multiple compactions on same thread
3. Compaction preserves conversation coherence

**Task 6.2: Update documentation**

Files to update:
- `CLAUDE.md` - Add note about thread versioning
- `docs/design/thread-shadowing.md` (new) - Technical details

## Testing Strategy

### Unit Tests
- Each new method gets comprehensive tests
- Mock database for isolation
- Test error cases

### Integration Tests  
- Test full compaction flow
- Test with real SQLite database
- Verify thread ID stability

### Manual Testing
1. Start conversation
2. Add many messages until context limit approached
3. Verify automatic compaction occurs
4. Verify conversation continues normally
5. Check database has shadow thread

## Key Considerations

### Performance
- Compaction should be async where possible
- Don't block agent responses
- Cache canonical ID lookups

### Backwards Compatibility
- Existing threads without versions must work
- Database migration must be safe
- No breaking changes to public APIs

### Error Handling
- Compaction failures shouldn't crash agent
- Fall back to original thread if shadow creation fails
- Log all compaction events

## Dependencies
- No new npm packages needed
- Uses existing SQLite infrastructure
- Builds on current event system

## Rollout Plan
1. Deploy with feature flag disabled
2. Test with internal threads
3. Enable for new threads only
4. Migrate existing threads as needed

## Success Metrics
- Conversations continue past previous token limits
- Thread IDs remain stable in UI
- No performance degradation
- Compaction reduces token usage by >50%