# Remove Agent.getLaceEvents() Method

**Date:** 2025-10-01
**Status:** Planned
**Part of:** simplify-compaction PR

## Background

Currently Agent has two methods for retrieving events:
- `getLaceEvents()` - Returns working conversation (calls buildWorkingConversation)
- `getAllEvents()` - Returns complete history from ThreadManager

The `getLaceEvents()` method creates confusion and is rarely used correctly. After simplifying compaction, `buildWorkingConversation()` becomes a simple visibility filter, making this method redundant.

## Current State

**Agent.getLaceEvents()** (line ~2454):
```typescript
getLaceEvents(threadId?: string): LaceEvent[] {
  const targetThreadId = threadId || this._threadId;
  return this._threadManager.getEvents(targetThreadId);  // Calls buildWorkingConversation
}
```

**Agent.getAllEvents()** (different method):
```typescript
getAllEvents(): LaceEvent[] {
  return this._threadManager.getAllEvents(this._threadId);  // Returns everything
}
```

## Proposal

**Remove `getLaceEvents()`** and consolidate to single event access pattern:

- **Agent.getAllEvents()**: Gets all events (with visibleToModel flags)
- **ThreadManager.getEvents()**: Filters to visible events only

Callers can filter by visibility themselves if needed:
```typescript
const allEvents = agent.getAllEvents();
const visibleOnly = allEvents.filter(e => e.visibleToModel !== false);
```

## Motivation

1. **Single Responsibility**: Agent provides complete history; ThreadManager handles filtering
2. **Reduce Confusion**: Two similar methods with subtly different behavior is confusing
3. **Simplify After Refactor**: buildWorkingConversation is now trivial, doesn't need Agent wrapper
4. **Tests Should Be Explicit**: Tests that need working conversation should call ThreadManager directly

## Implementation

### Search for Usages

```bash
grep -rn "getLaceEvents" packages/core/src
```

**Expected usages (~31 total):**
- Test files using it to get events
- Possibly Agent internal use

### Migration Strategy

For each usage:

1. **If just need any events**: Change to `agent.getAllEvents()`
2. **If need working conversation**: Use `agent['_threadManager'].getEvents(threadId)`
3. **If testing conversation building**: Consider testing ThreadManager directly

### Files to Update

Based on previous analysis:
- `src/agent-thread-integration.test.ts`
- `src/agents/agent-thread-events.test.ts`
- `src/agents/agent-threadmanager-encapsulation.test.ts`
- `src/tasks/task-notification-integration.test.ts`

### Example Migrations

**Before:**
```typescript
const events = agent.getLaceEvents();
expect(events.length).toBeGreaterThan(0);
```

**After:**
```typescript
const events = agent.getAllEvents();
expect(events.length).toBeGreaterThan(0);
```

**Before (if testing working conversation specifically):**
```typescript
const events = agent.getLaceEvents();
// Expect only visible events
```

**After:**
```typescript
const events = agent['_threadManager'].getEvents(agent.getThreadId());
// Expect only visible events
```

### Remove Method

In `packages/core/src/agents/agent.ts` (around line 2454):

```typescript
// DELETE THIS METHOD
getLaceEvents(threadId?: string): LaceEvent[] {
  const targetThreadId = threadId || this._threadId;
  return this._threadManager.getEvents(targetThreadId);
}
```

## Testing

After removal:
```bash
npm test
```

All tests should pass with updated calls to `getAllEvents()` or `ThreadManager.getEvents()`.

## Decision Log

**Why keep getAllEvents() but remove getLaceEvents()?**
- `getAllEvents()` is used in production (web API needs complete history with visibility flags)
- `getLaceEvents()` is test-only and duplicates functionality
- After simplifying buildWorkingConversation, the distinction becomes meaningless

**Why not keep both?**
- Having two similar methods is confusing
- The working conversation is a ThreadManager concern, not an Agent concern
- Tests that care about conversation building should test ThreadManager directly
- YAGNI - one method is enough

**Can callers still get working conversation?**
Yes, two ways:
1. `agent.getAllEvents().filter(e => e.visibleToModel !== false)`
2. Access ThreadManager if really needed: `agent['_threadManager'].getEvents(threadId)`

## Commit Message

```
refactor(agent): remove getLaceEvents() method

Remove redundant getLaceEvents() method. Callers should use:
- getAllEvents() for complete history with visibility flags
- ThreadManager.getEvents() for working conversation (visible only)

This simplifies the Agent API and eliminates confusion between the two
similar methods.
```
