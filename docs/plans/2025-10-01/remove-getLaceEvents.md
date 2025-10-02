# Remove Agent.getLaceEvents() Method

**Date:** 2025-10-01
**Status:** Planned

## Background

Currently Agent has two methods for retrieving events:
- `getLaceEvents()` - Returns working conversation (post-compaction, for AI)
- `getAllEvents()` - Returns complete history (all events, for UI)

The `getLaceEvents()` method is only used in tests, never in production code. The one production usage (web API route) was incorrectly using it and has been fixed to use `getAllEvents()`.

## Motivation

- **Single Responsibility**: Agent should provide one clear way to access events
- **Reduce Confusion**: Having two similar methods is confusing
- **Simplify API**: Tests can use ThreadManager directly if they need working conversation

## Proposal

1. Remove `Agent.getLaceEvents()` method
2. Update all tests to use one of:
   - `agent.getAllEvents()` - for tests that just need any events
   - `threadManager.getEvents()` - for tests specifically testing conversation building logic
3. Update documentation to clarify the distinction

## Implementation

### Files to Change

**packages/core/src/agents/agent.ts**
- Remove `getLaceEvents()` method (lines ~2454-2457)

**Test files** (4 files, ~31 usages):
- `src/agent-thread-integration.test.ts`
- `src/agents/agent-thread-events.test.ts`
- `src/agents/agent-threadmanager-encapsulation.test.ts`
- `src/tasks/task-notification-integration.test.ts`

### Migration Strategy

For each test using `agent.getLaceEvents()`:

1. **If testing event retrieval generally**: Change to `agent.getAllEvents()`
2. **If testing conversation building**: Use `agent['_threadManager'].getEvents()` or refactor to test ThreadManager directly
3. **If testing that events exist**: Use `agent.getAllEvents()`

### Testing

After changes:
```bash
npm test
```

All existing tests should pass with minimal changes.

## Follow-up

Consider whether tests should directly test ThreadManager.getEvents() for conversation building logic rather than going through Agent.

## Decision Log

**Why keep getAllEvents() but remove getLaceEvents()?**
- `getAllEvents()` is used in production (web API)
- `getLaceEvents()` is test-only
- The web UI needs complete history with visibility flags (getAllEvents)
- The AI provider integration uses ThreadManager.getEvents() directly

**Why not keep both?**
- Having two similar methods is confusing
- The working conversation is an internal detail that tests shouldn't rely on
- Tests that care about conversation building should test ThreadManager directly
