# Simplify Compaction Architecture

**Date:** 2025-10-01
**Status:** Planned
**Branch:** `simplify-compaction`

## Overview

Simplify the compaction architecture by storing compacted events as first-class database rows with `visibleToModel` flags, rather than nesting them inside COMPACTION events. This eliminates complexity, makes the data model clearer, and makes `visibleToModel` the single source of truth.

## Current Architecture (Complex)

```
Database: [e1, e2, e3, COMPACTION{compactedEvents: [summary]}, e4, e5]

buildWorkingConversation():
  1. Find last COMPACTION event
  2. Extract compactedEvents from COMPACTION.data
  3. Hydrate timestamps (they're strings from JSON)
  4. Merge: [...compactedEvents, COMPACTION, ...eventsAfter]
  5. Filter/deduplicate

Sent to model: [summary, e4, e5]
```

**Problems:**
- Compacted events are "virtual" - nested in COMPACTION event data
- Need special hydration logic for timestamps
- Complex merge logic in buildWorkingConversation (~60 lines)
- Second compaction creates nested structures
- Confusion about what's "real" vs "virtual" events

## New Architecture (Simple)

```
Database: [e1(vis=false), e2(vis=false), e3(vis=false), summary(vis=true), COMPACTION(vis=false), e4, e5]

buildWorkingConversation():
  return events.filter(e => e.visibleToModel !== false)

Sent to model: [summary, e4, e5]
UI shows all: [e1(grey), e2(grey), e3(grey), summary, COMPACTION(grey), e4, e5]
```

**Benefits:**
- All events are first-class database rows
- `visibleToModel` is single source of truth
- `buildWorkingConversation()` reduced from ~60 lines to ~3 lines
- No nested structures
- No hydration needed
- Easier to understand and query
- Manual pruning becomes trivial

## Implementation Plan

### Task 1: Update CompactionData Type

**Files:**
- `packages/core/src/threads/compaction/types.ts`

**Changes:**

```typescript
// OLD
export interface CompactionData {
  strategyId: string;
  originalEventCount: number;
  compactedEvents: LaceEvent[];  // ← Remove this
  metadata?: Record<string, unknown>;
}

// NEW
export interface CompactionData {
  strategyId: string;
  originalEventCount: number;
  compactedEventCount: number;  // Just a count
  metadata?: Record<string, unknown>;  // Can include summary text for UI
}

// ADD
export interface CompactionResult {
  compactionEvent: LaceEvent;  // COMPACTION event (metadata only)
  compactedEvents: LaceEvent[];  // Events to persist as separate rows
}
```

Update CompactionStrategy interface:

```typescript
export interface CompactionStrategy {
  id: string;
  compact(events: LaceEvent[], context: CompactionContext): Promise<CompactionResult>;  // Changed return type
}
```

**Test:** Update `packages/core/src/threads/compaction/types.test.ts` if exists, or add basic type validation test.

**Commit:**
```
refactor(compaction): change CompactionData to remove nested events

Remove compactedEvents array from CompactionData. Strategies now return
CompactionResult with separate compactionEvent and compactedEvents array.
```

---

### Task 2: Update Trim Strategy

**Files:**
- `packages/core/src/threads/compaction/trim-tool-results-strategy.ts`
- `packages/core/src/threads/compaction/trim-tool-results-strategy.test.ts`

**Changes:**

Return CompactionResult instead of single LaceEvent:

```typescript
async compact(events: LaceEvent[], context: CompactionContext): Promise<CompactionResult> {
  const compactedEvents: LaceEvent[] = [];
  let modifiedCount = 0;

  for (const event of events) {
    if (event.type === 'COMPACTION') {
      continue; // Skip COMPACTION events
    } else if (event.type === 'TOOL_RESULT') {
      const trimmedEvent = this.trimToolResult(event);
      compactedEvents.push(trimmedEvent);
      if (trimmedEvent.data !== event.data) {
        modifiedCount++;
      }
    } else {
      compactedEvents.push(event);
    }
  }

  const compactionEvent: LaceEvent = {
    type: 'COMPACTION',
    data: {
      strategyId: this.id,
      originalEventCount: events.length,
      compactedEventCount: compactedEvents.length,  // NEW
      metadata: {
        strategy: 'trim-tool-results',
        modifiedResultCount: modifiedCount,
      },
    },
    context: { threadId: context.threadId },
  };

  return {
    compactionEvent,
    compactedEvents,  // Separate array
  };
}
```

**Tests:** Update assertions to expect CompactionResult instead of single event.

**Commit:**
```
refactor(compaction): update trim strategy to return CompactionResult

Return separate compactionEvent and compactedEvents array instead of
nesting events inside COMPACTION data.
```

---

### Task 3: Update Summarize Strategy

**Files:**
- `packages/core/src/threads/compaction/summarize-strategy.ts`
- `packages/core/src/threads/compaction/summarize-strategy.test.ts`

**Changes:**

Similar to trim strategy - return CompactionResult:

```typescript
async compact(events: LaceEvent[], context: CompactionContext): Promise<CompactionResult> {
  // ... generate summary via AI ...

  const summaryEvent: LaceEvent = {
    type: 'USER_MESSAGE',
    data: summaryText,
    context: { threadId: context.threadId },
  };

  const compactionEvent: LaceEvent = {
    type: 'COMPACTION',
    data: {
      strategyId: this.id,
      originalEventCount: events.length,
      compactedEventCount: 1,  // Just the summary
      metadata: {
        strategy: 'summarize',
        summary: summaryText,  // For UI display
        preservedUserMessages,
        recentEventCount,
      },
    },
    context: { threadId: context.threadId },
  };

  return {
    compactionEvent,
    compactedEvents: [summaryEvent],  // Will be persisted as real event
  };
}
```

**Tests:** Update to expect CompactionResult.

**Commit:**
```
refactor(compaction): update summarize strategy to return CompactionResult

Return separate compactionEvent and summary event instead of nesting
summary inside COMPACTION data.
```

---

### Task 4: Update ThreadManager.compact()

**Files:**
- `packages/core/src/threads/thread-manager.ts`

**Changes:**

Update to persist compacted events as first-class rows:

```typescript
async compact(
  threadId: string,
  strategyId: string,
  params?: unknown
): Promise<{
  compactionEvent: LaceEvent;
  hiddenEventIds: string[];
}> {
  const strategy = this._compactionStrategies.get(strategyId);
  if (!strategy) {
    throw new Error(`Unknown compaction strategy: ${strategyId}`);
  }

  const thread = this.getThread(threadId);
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }

  const context = {
    threadId,
    ...(params as object),
  };

  // Run compaction strategy - now returns CompactionResult
  const result = await strategy.compact(thread.events, context);

  // 1. Persist compacted events as first-class events (marked visible)
  for (const event of result.compactedEvents) {
    this.addEvent({
      ...event,
      visibleToModel: true,  // Explicitly mark as visible
      context: { ...event.context, threadId },
    });
  }

  // 2. Persist COMPACTION event (marked not visible - it's metadata)
  const addedCompactionEvent = this.addEvent({
    ...result.compactionEvent,
    visibleToModel: false,
    context: { threadId },
  });

  // 3. Mark pre-compaction events as not visible
  const hiddenEventIds: string[] = [];

  // Invalidate cache FIRST
  processLocalThreadCache.delete(threadId);

  const updatedThread = this.getThread(threadId);

  if (updatedThread) {
    const compactionIndex = updatedThread.events.findIndex(
      (e) => e.id === addedCompactionEvent?.id
    );

    // Mark all events before compaction as not visible
    for (let i = 0; i < compactionIndex; i++) {
      const event = updatedThread.events[i];
      if (event.id) {
        this._persistence.updateEventVisibility(event.id, false);
        hiddenEventIds.push(event.id);
      }
    }

    // Mark COMPACTION event itself as not visible
    if (addedCompactionEvent?.id) {
      // Already persisted with visibleToModel=false, just add to list
      hiddenEventIds.push(addedCompactionEvent.id);
    }

    processLocalThreadCache.delete(threadId);
  }

  logger.info('THREADMANAGER: Compaction complete', {
    threadId,
    strategyId,
    hiddenEventCount: hiddenEventIds.length,
    compactedEventCount: result.compactedEvents.length,
  });

  return {
    compactionEvent: addedCompactionEvent!,
    hiddenEventIds,
  };
}
```

**Test:** Update compaction tests to verify compacted events are persisted as real rows.

**Commit:**
```
refactor(threads): persist compacted events as first-class database rows

Store compacted events as real database rows instead of nesting them
inside COMPACTION event data. Simplifies data model and makes
visibleToModel the single source of truth.
```

---

### Task 5: Simplify buildWorkingConversation()

**Files:**
- `packages/core/src/threads/conversation-builder.ts`
- `packages/core/src/threads/conversation-builder.test.ts`

**Changes:**

Replace entire function with simple filter:

```typescript
export function buildWorkingConversation(events: LaceEvent[]): LaceEvent[] {
  // Filter to only events visible to model
  const visibleEvents = events.filter(e => e.visibleToModel !== false);

  // Apply tool result deduplication
  return deduplicateToolResults(visibleEvents);
}
```

Remove helper functions (no longer needed):
- `findLastCompactionEventWithIndex()`
- `isCompactionData()` type guard

**Tests:** Update to test simple filtering logic instead of complex merge logic.

**Commit:**
```
refactor(conversation): simplify buildWorkingConversation to filter by visibility

Replace complex compaction event extraction logic with simple filter by
visibleToModel flag. Reduces function from ~60 lines to ~3 lines.
```

---

### Task 6: Remove Event Hydration

**Files:**
- Delete `packages/core/src/threads/event-hydration.ts`
- `packages/core/src/threads/conversation-builder.ts` (remove import)

**Justification:** Events are now real database rows with proper timestamps. No need for hydration logic that converts timestamp strings to Date objects.

**Commit:**
```
refactor(threads): remove event hydration module

Remove event-hydration.ts as compacted events are now persisted as
first-class database rows with proper Date timestamps.
```

---

### Task 7: Update Web CompactionEntry Component

**Files:**
- `packages/web/components/timeline/CompactionEntry.tsx`

**Changes:**

Update to read from metadata instead of compactedEvents array:

```typescript
export function CompactionEntry({ data, timestamp }: CompactionEntryProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const summary = data.metadata?.summary as string | undefined;
  const hasMetadata = Boolean(summary);
  const preservedMessages = data.metadata?.preservedUserMessages as number | undefined;
  const recentEvents = data.metadata?.recentEventCount as number | undefined;
  const strategy = (data.metadata?.strategy as string) || data.strategyId || 'unknown';

  return (
    <div className="my-4">
      {/* ... existing UI ... */}
      <div className="p-3 bg-warning/5 border-b border-warning/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-base-content/70">
              <strong className="text-base-content">{String(data.originalEventCount)}</strong>
              {' → '}
              <strong className="text-base-content">
                {String(data.compactedEventCount)}  {/* Changed from .compactedEvents.length */}
              </strong>
              {' events'}
            </span>
            {/* ... rest of stats ... */}
          </div>
        </div>
      </div>
      {/* ... rest of component ... */}
    </div>
  );
}
```

**Commit:**
```
refactor(web): update CompactionEntry to use compactedEventCount

Read event count from CompactionData.compactedEventCount instead of
compactedEvents.length since events are now persisted separately.
```

---

## Testing Strategy

### Critical Tests to Update

1. **conversation-builder.test.ts**
   - Remove tests expecting complex merge logic
   - Add tests verifying simple visibility filter
   - Test that visibleToModel=false events are filtered out

2. **Compaction strategy tests**
   - Update to expect CompactionResult return type
   - Verify compactedEvents are returned separately

3. **compaction-integration.test.ts**
   - Verify compacted events are persisted as real DB rows
   - Verify they have visibleToModel=true
   - Verify working conversation only includes visible events

### Manual Testing

```bash
# 1. Create conversation
# 2. Trigger compaction
# 3. Check database:
sqlite3 ~/.lace/lace.db "SELECT id, type, visible_to_model FROM events ORDER BY timestamp"

# Should see:
# - Pre-compaction events with visible_to_model=0
# - Summary event with visible_to_model=1 (or NULL)
# - COMPACTION event with visible_to_model=0
# - Post-compaction events with visible_to_model=NULL

# 4. Trigger second compaction
# 5. Verify first summary now has visible_to_model=0
```

## Breaking Changes

**BREAKING:** Existing COMPACTION events will not work correctly after this change.

**Old format:**
```json
{
  "type": "COMPACTION",
  "data": {
    "strategyId": "summarize",
    "originalEventCount": 50,
    "compactedEvents": [...]  // Events nested here
  }
}
```

**New format:**
```json
{
  "type": "COMPACTION",
  "data": {
    "strategyId": "summarize",
    "originalEventCount": 50,
    "compactedEventCount": 1,  // Just a count
    "metadata": { "summary": "..." }
  }
}
```

**Migration:** Not needed - we're pre-deploy and can break compatibility.

## Code Size Reduction

**Files that get simpler:**
- `conversation-builder.ts`: ~60 lines → ~10 lines
- `thread-manager.ts`: Simpler compact() logic
- Delete `event-hydration.ts`: ~50 lines removed

**Files that get slightly more complex:**
- Compaction strategies: Need to return CompactionResult (marginal)

**Net effect:** ~100 lines of code removed, significantly reduced complexity.

## Success Metrics

- [ ] `buildWorkingConversation()` is <10 lines
- [ ] `event-hydration.ts` deleted
- [ ] All tests pass
- [ ] Second compaction works cleanly
- [ ] Database queries show compacted events as separate rows
- [ ] UI correctly displays all events with visibility styling

## Follow-up Work

After this refactor:
- Implement event visibility UI (from event-visibility.md plan)
- Remove Agent.getLaceEvents() (from remove-getLaceEvents.md plan)
- Add manual pruning UI (future)

## Decision Log

**Q: Why not migrate existing COMPACTION events?**
A: We're pre-deploy and can break compatibility. Clean break is simpler than migration.

**Q: Should compacted events have explicit visibleToModel=true?**
A: Yes! During second compaction, they'll be marked false, so explicit true prevents confusion.

**Q: What if a strategy returns no events (complete summarization)?**
A: Still valid - compactedEvents can be empty array, just COMPACTION event persisted.
