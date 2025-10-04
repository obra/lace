# Event Visibility Implementation Plan

**Date:** 2025-10-01
**Feature:** Show compacted events in UI with visual indication they're not sent to model

## Overview

Currently, when conversation history is compacted to save tokens, the pre-compaction events are completely hidden from the web UI. This plan implements a `visibleToModel` flag on events so the UI can show all events but visually distinguish which ones are still sent to the AI model (normal appearance) vs. which have been compacted away (greyed out).

## Background: How Compaction Works

Lace uses an event-sourcing architecture where conversations are stored as immutable event sequences. When a conversation gets too long, we "compact" it:

1. **Before compaction:** Events 1-100 exist in database
2. **Compaction happens:** AI summarizes events 1-100 into a summary
3. **After compaction:**
   - Events 1-100 still in database but marked `visibleToModel: false`
   - New summary event (USER_MESSAGE) created with `visibleToModel: true`
   - COMPACTION event created as metadata marker with `visibleToModel: false`
   - Future events (101+) continue with `visibleToModel: undefined` (treated as true)

When the AI processes the next message, it only sees:
- The summary event
- The COMPACTION event is NOT sent (it's metadata)
- Events after compaction

**Key insight:** Multiple compactions can happen. A second compaction would mark the first summary event as `visibleToModel: false` and create a new summary.

## Architecture Notes

### Event Flow
```
User Input → LaceEvent created → Persisted to SQLite → Emitted via EventEmitter
→ SSE to web clients → UI renders
```

### Key Components
- **ThreadManager** (`packages/core/src/threads/thread-manager.ts`): Manages events and compaction
- **Agent** (`packages/core/src/agents/agent.ts`): Event hub that emits transient events
- **Database** (`packages/core/src/persistence/database.ts`): SQLite persistence with migrations
- **Types** (`packages/core/src/threads/types.ts`): Single source of truth for event types

### Event Naming Convention
- Event types: `SCREAMING_SNAKE_CASE` (e.g., `USER_MESSAGE`, `COMPACTION_START`)
- Stored in `EVENT_TYPES` array
- Discriminated union `LaceEvent` for type safety

### Testing Philosophy
- **TDD:** Write failing tests first, implement to make them pass
- **Co-location:** Tests next to source files (e.g., `agent.ts` → `agent.test.ts`)
- **Test framework:** Vitest
- **Integration tests:** Test cross-component interactions
- **E2E tests:** Playwright for full web UI flows

## Implementation Tasks

### Task 1: Database Schema Migration

**Objective:** Add `visible_to_model` column to events table.

**Why this first:** Foundation for everything else. No code can use the field until the schema supports it.

**Files to modify:**
- `packages/core/src/persistence/database.ts`

**Steps:**

1. Find the `runMigrations()` method (around line 290)
2. Add migration check:
```typescript
if (currentVersion < 14) {
  this.migrateToV14();
}
```

3. Add migration method after `upgradeToVersion13()`:
```typescript
private migrateToV14(): void {
  if (!this.db) return;

  // Add visible_to_model column to events table
  // NULL means visible (default), 0 means not visible to model
  this.db.exec(`
    ALTER TABLE events ADD COLUMN visible_to_model BOOLEAN;
  `);

  this.setSchemaVersion(14);

  logger.info('DATABASE: Migrated to schema version 14 (event visibility)');
}
```

**Why BOOLEAN not INTEGER:** SQLite stores booleans as integers (0/1/NULL) but accepts BOOLEAN as type affinity for clarity.

**Testing:**

Create `packages/core/src/persistence/database-migration-v14.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabasePersistence } from '@lace/core/persistence/database';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Database Migration v14: Event Visibility', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-test-'));
    dbPath = join(tempDir, 'test.db');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should add visible_to_model column to events table', () => {
    const db = new DatabasePersistence(dbPath);

    // Create a thread and add an event
    const threadId = 'lace_20251001_test01';
    db.createThread(threadId);

    const event = {
      type: 'USER_MESSAGE' as const,
      data: 'test message',
      context: { threadId },
    };

    db.addEvent(event);

    // Query the event directly from database to check column exists
    const result = db['db']!.prepare(
      'SELECT visible_to_model FROM events WHERE thread_id = ?'
    ).get(threadId) as { visible_to_model: number | null };

    // Should be NULL (treated as visible)
    expect(result.visible_to_model).toBeNull();
  });

  it('should allow setting visible_to_model to false', () => {
    const db = new DatabasePersistence(dbPath);

    const threadId = 'lace_20251001_test02';
    db.createThread(threadId);

    const event = {
      type: 'USER_MESSAGE' as const,
      data: 'test message',
      context: { threadId },
    };

    const addedEvent = db.addEvent(event);

    // Update visible_to_model to false
    db['db']!.prepare(
      'UPDATE events SET visible_to_model = 0 WHERE id = ?'
    ).run(addedEvent!.id);

    const result = db['db']!.prepare(
      'SELECT visible_to_model FROM events WHERE id = ?'
    ).get(addedEvent!.id) as { visible_to_model: number };

    expect(result.visible_to_model).toBe(0);
  });
});
```

**How to test:**
```bash
npm test database-migration-v14.test.ts
```

**Commit message:**
```
feat(db): add visible_to_model column for event visibility tracking

Add schema migration v14 that adds visible_to_model BOOLEAN column to
events table. NULL/undefined means visible to model (default), false
means not visible (compacted away or manually pruned).
```

---

### Task 2: Add EVENT_UPDATED Type Definition

**Objective:** Define the new transient event type for notifying clients about visibility changes.

**Why this next:** Types are the contract. Define them before implementing logic.

**Files to modify:**
- `packages/core/src/threads/types.ts`

**Steps:**

1. Add `'EVENT_UPDATED'` to `EVENT_TYPES` array (in transient section, around line 47):
```typescript
  // Error events (transient)
  'AGENT_ERROR',
  // Event visibility updates (transient)
  'EVENT_UPDATED',
  // MCP events (transient)
  'MCP_CONFIG_CHANGED',
```

2. Add data interface after `AgentErrorData` (around line 384):
```typescript
// Event visibility update data
export interface EventUpdatedData {
  eventId: string;
  visibleToModel: boolean;
}
```

3. Add to `LaceEvent` discriminated union (after `AGENT_ERROR` case, around line 498):
```typescript
  | (BaseLaceEvent & {
      type: 'AGENT_ERROR';
      data: AgentErrorData;
    })
  | (BaseLaceEvent & {
      type: 'EVENT_UPDATED';
      data: EventUpdatedData;
    })
  | (BaseLaceEvent & {
      type: 'MCP_CONFIG_CHANGED';
      data: MCPConfigChangedData;
    })
```

4. Update `isTransientEventType()` helper (around line 58):
```typescript
    // Error events
    'AGENT_ERROR',
    // Event visibility updates
    'EVENT_UPDATED',
    // MCP events
    'MCP_CONFIG_CHANGED',
```

5. Add to `createLaceEventFromDb()` switch statement in `packages/core/src/persistence/database.ts` (around line 175):
```typescript
    case 'EVENT_UPDATED':
      // EVENT_UPDATED is transient and should never be in database
      throw new TransientEventError(type, id, threadId);
```

**Testing:**

Add to existing `packages/core/src/threads/types.test.ts`:

```typescript
describe('EVENT_UPDATED type', () => {
  it('should be recognized as a transient event type', () => {
    expect(isTransientEventType('EVENT_UPDATED')).toBe(true);
  });

  it('should not be a conversation event', () => {
    expect(isConversationEvent('EVENT_UPDATED')).toBe(false);
  });

  it('should create a well-formed EVENT_UPDATED event', () => {
    const event: LaceEvent = {
      type: 'EVENT_UPDATED',
      data: {
        eventId: 'evt_123',
        visibleToModel: false,
      },
      transient: true,
      context: {
        threadId: 'lace_20251001_test01',
      },
    };

    expect(event.type).toBe('EVENT_UPDATED');
    expect(event.data.eventId).toBe('evt_123');
    expect(event.data.visibleToModel).toBe(false);
  });
});
```

**How to test:**
```bash
npm test types.test.ts
```

**Commit message:**
```
feat(types): add EVENT_UPDATED transient event type

Add EVENT_UPDATED event type for real-time visibility updates when
events are marked as not visible to model during compaction or manual
pruning.
```

---

### Task 3: Add visibleToModel Field to LaceEvent Persistence

**Objective:** Support reading and writing the `visibleToModel` field when persisting events.

**Why this next:** Database layer needs to handle the new field before ThreadManager can use it.

**Files to modify:**
- `packages/core/src/persistence/database.ts`

**Steps:**

1. Update `addEvent()` method to handle `visibleToModel` field (around line 580):

Find the INSERT statement:
```typescript
const result = this.db
  .prepare(
    `INSERT INTO events (id, thread_id, type, timestamp, data)
     VALUES (?, ?, ?, ?, ?)`
  )
```

Change to:
```typescript
const result = this.db
  .prepare(
    `INSERT INTO events (id, thread_id, type, timestamp, data, visible_to_model)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  .run(
    eventId,
    threadId,
    event.type,
    timestamp.toISOString(),
    JSON.stringify(eventData),
    event.visibleToModel === false ? 0 : null // NULL = visible, 0 = not visible
  );
```

2. Update `getEvents()` method to read the field (around line 650):

Find the SELECT:
```typescript
const rows = this.db
  .prepare(
    `SELECT id, thread_id, type, timestamp, data
     FROM events
     WHERE thread_id = ?
     ORDER BY timestamp ASC`
  )
```

Change to:
```typescript
const rows = this.db
  .prepare(
    `SELECT id, thread_id, type, timestamp, data, visible_to_model
     FROM events
     WHERE thread_id = ?
     ORDER BY timestamp ASC`
  )
  .all(threadId) as Array<{
    id: string;
    thread_id: string;
    type: string;
    timestamp: string;
    data: string;
    visible_to_model: number | null;
  }>;
```

3. Update event creation to include `visibleToModel` (in the loop):
```typescript
for (const row of rows) {
  const data = JSON.parse(row.data);
  const event = createLaceEventFromDb(
    row.id,
    row.thread_id,
    row.type as LaceEventType,
    new Date(row.timestamp),
    data,
    { sessionId: thread.sessionId, projectId: thread.projectId }
  );

  // Return new object if visibility explicitly set to false (maintains immutability)
  const finalEvent = row.visible_to_model === 0
    ? { ...event, visibleToModel: false }
    : event;
  // If NULL or 1, leave as undefined (treated as true)

  events.push(finalEvent);
}
```

4. Add new method `updateEventVisibility()` after `addEvent()`:
```typescript
/**
 * Update the visibility flag for a specific event
 * Used during compaction to mark events as not visible to model
 */
updateEventVisibility(eventId: string, visibleToModel: boolean): void {
  if (!this.db) {
    logger.warn('DATABASE: Cannot update event visibility - database not initialized');
    return;
  }

  const value = visibleToModel ? null : 0; // NULL = visible, 0 = not visible

  this.db
    .prepare('UPDATE events SET visible_to_model = ? WHERE id = ?')
    .run(value, eventId);

  logger.debug('DATABASE: Updated event visibility', {
    eventId,
    visibleToModel,
  });
}
```

**Testing:**

Create `packages/core/src/persistence/event-visibility.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabasePersistence } from '@lace/core/persistence/database';
import type { LaceEvent } from '@lace/core/threads/types';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Event Visibility Persistence', () => {
  let tempDir: string;
  let dbPath: string;
  let db: DatabasePersistence;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-test-'));
    dbPath = join(tempDir, 'test.db');
    db = new DatabasePersistence(dbPath);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should persist visibleToModel: false correctly', () => {
    const threadId = 'lace_20251001_test01';
    db.createThread(threadId);

    const event: LaceEvent = {
      type: 'USER_MESSAGE',
      data: 'test message',
      visibleToModel: false,
      context: { threadId },
    };

    const added = db.addEvent(event);
    expect(added).not.toBeNull();
    expect(added!.visibleToModel).toBe(false);

    // Verify it persisted correctly
    const events = db.getEvents(threadId);
    expect(events).toHaveLength(1);
    expect(events[0].visibleToModel).toBe(false);
  });

  it('should treat undefined visibleToModel as visible (not set in db)', () => {
    const threadId = 'lace_20251001_test02';
    db.createThread(threadId);

    const event: LaceEvent = {
      type: 'USER_MESSAGE',
      data: 'test message',
      context: { threadId },
    };

    const added = db.addEvent(event);
    expect(added).not.toBeNull();
    expect(added!.visibleToModel).toBeUndefined();

    const events = db.getEvents(threadId);
    expect(events).toHaveLength(1);
    expect(events[0].visibleToModel).toBeUndefined();
  });

  it('should update event visibility from visible to not visible', () => {
    const threadId = 'lace_20251001_test03';
    db.createThread(threadId);

    const event: LaceEvent = {
      type: 'USER_MESSAGE',
      data: 'test message',
      context: { threadId },
    };

    const added = db.addEvent(event);
    expect(added!.visibleToModel).toBeUndefined();

    // Update to not visible
    db.updateEventVisibility(added!.id!, false);

    const events = db.getEvents(threadId);
    expect(events[0].visibleToModel).toBe(false);
  });

  it('should update event visibility from not visible to visible', () => {
    const threadId = 'lace_20251001_test04';
    db.createThread(threadId);

    const event: LaceEvent = {
      type: 'USER_MESSAGE',
      data: 'test message',
      visibleToModel: false,
      context: { threadId },
    };

    const added = db.addEvent(event);
    expect(added!.visibleToModel).toBe(false);

    // Update to visible
    db.updateEventVisibility(added!.id!, true);

    const events = db.getEvents(threadId);
    expect(events[0].visibleToModel).toBeUndefined(); // NULL is treated as undefined
  });

  it('should handle multiple events with mixed visibility', () => {
    const threadId = 'lace_20251001_test05';
    db.createThread(threadId);

    const events: LaceEvent[] = [
      {
        type: 'USER_MESSAGE',
        data: 'visible message 1',
        context: { threadId },
      },
      {
        type: 'AGENT_MESSAGE',
        data: { content: 'not visible message' },
        visibleToModel: false,
        context: { threadId },
      },
      {
        type: 'USER_MESSAGE',
        data: 'visible message 2',
        context: { threadId },
      },
    ];

    for (const event of events) {
      db.addEvent(event);
    }

    const retrieved = db.getEvents(threadId);
    expect(retrieved).toHaveLength(3);
    expect(retrieved[0].visibleToModel).toBeUndefined();
    expect(retrieved[1].visibleToModel).toBe(false);
    expect(retrieved[2].visibleToModel).toBeUndefined();
  });
});
```

**How to test:**
```bash
npm test event-visibility.test.ts
```

**Commit message:**
```
feat(db): persist and read visibleToModel field for events

Add support for reading/writing visibleToModel field when persisting
events. Add updateEventVisibility() method for marking events as not
visible during compaction.
```

---

### Task 4: Implement ThreadManager.compact() Visibility Updates

**Objective:** When compaction runs, mark pre-compaction events as `visibleToModel: false` and return info about which events changed.

**Why this next:** Core logic for setting visibility flags during compaction.

**Files to modify:**
- `packages/core/src/threads/thread-manager.ts`

**Steps:**

1. Find the `compact()` method (around line 495)

2. Modify the method signature to return metadata:
```typescript
async compact(
  threadId: string,
  strategyId: string = 'summarize',
  context?: Partial<CompactionContext>
): Promise<{
  compactionEvent: LaceEvent;
  hiddenEventIds: string[];
}> {
```

3. After the compaction event is added, mark events as not visible:

Find this section (after `this.addEvent(threadId, compactionEvent)`):
```typescript
logger.info('THREADMANAGER: Compaction complete', {
  threadId,
  strategyId,
  originalEventCount,
  compactedEventCount,
});

return compactionEvent;
```

Replace with:
```typescript
// Mark pre-compaction events as not visible to model
const hiddenEventIds: string[] = [];

// Invalidate cache FIRST to ensure we read fresh data and prevent race conditions
processLocalThreadCache.delete(threadId);

// NOW get fresh thread data
const thread = this.getThread(threadId);

if (thread) {
  // Find the index of the compaction event we just added
  const compactionIndex = thread.events.findIndex(e => e.id === compactionEvent.id);

  // Mark all events before the compaction as not visible
  for (let i = 0; i < compactionIndex; i++) {
    const event = thread.events[i];
    if (event.id) {
      this._persistence.updateEventVisibility(event.id, false);
      hiddenEventIds.push(event.id);
    }
  }

  // Mark the compaction event itself as not visible (it's metadata)
  if (compactionEvent.id) {
    this._persistence.updateEventVisibility(compactionEvent.id, false);
    hiddenEventIds.push(compactionEvent.id);
  }

  // Note: Compacted replacement events (in compactionData.compactedEvents)
  // are already persisted as visible (undefined/NULL), no action needed
}

logger.info('THREADMANAGER: Compaction complete', {
  threadId,
  strategyId,
  originalEventCount,
  compactedEventCount,
  hiddenEventCount: hiddenEventIds.length,
});

return {
  compactionEvent,
  hiddenEventIds,
};
```

**Testing:**

Create `packages/core/src/threads/compaction-visibility.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThreadManager } from '@lace/core/threads/thread-manager';
import type { LaceEvent } from '@lace/core/threads/types';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Compaction Visibility', () => {
  let tempDir: string;
  let manager: ThreadManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-test-'));
    process.env.LACE_DIR = tempDir;
    manager = new ThreadManager();
  });

  afterEach(() => {
    delete process.env.LACE_DIR;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should mark pre-compaction events as not visible', async () => {
    const threadId = manager.generateThreadId();
    manager.createThread(threadId);

    // Add some events
    const event1 = manager.addEvent(threadId, {
      type: 'USER_MESSAGE',
      data: 'First message',
      context: { threadId },
    });

    const event2 = manager.addEvent(threadId, {
      type: 'AGENT_MESSAGE',
      data: { content: 'First response' },
      context: { threadId },
    });

    const event3 = manager.addEvent(threadId, {
      type: 'USER_MESSAGE',
      data: 'Second message',
      context: { threadId },
    });

    // Verify all start as visible
    expect(event1!.visibleToModel).toBeUndefined();
    expect(event2!.visibleToModel).toBeUndefined();
    expect(event3!.visibleToModel).toBeUndefined();

    // Compact using trim strategy (doesn't need AI)
    const result = await manager.compact(threadId, 'trim-tool-results');

    // All pre-compaction events should be hidden
    expect(result.hiddenEventIds).toContain(event1!.id);
    expect(result.hiddenEventIds).toContain(event2!.id);
    expect(result.hiddenEventIds).toContain(event3!.id);

    // COMPACTION event itself should be hidden
    expect(result.hiddenEventIds).toContain(result.compactionEvent.id);

    // Verify by reading from database
    const thread = manager.getThread(threadId);
    const event1Updated = thread!.events.find(e => e.id === event1!.id);
    expect(event1Updated!.visibleToModel).toBe(false);
  });

  it('should keep post-compaction events visible', async () => {
    const threadId = manager.generateThreadId();
    manager.createThread(threadId);

    // Add events before compaction
    manager.addEvent(threadId, {
      type: 'USER_MESSAGE',
      data: 'Before compaction',
      context: { threadId },
    });

    // Compact
    const result = await manager.compact(threadId, 'trim-tool-results');

    // Add event after compaction
    const postEvent = manager.addEvent(threadId, {
      type: 'USER_MESSAGE',
      data: 'After compaction',
      context: { threadId },
    });

    // Post-compaction event should be visible
    expect(postEvent!.visibleToModel).toBeUndefined();
    expect(result.hiddenEventIds).not.toContain(postEvent!.id);
  });

  it('should handle second compaction correctly', async () => {
    const threadId = manager.generateThreadId();
    manager.createThread(threadId);

    // First batch of events
    const event1 = manager.addEvent(threadId, {
      type: 'USER_MESSAGE',
      data: 'First batch',
      context: { threadId },
    });

    // First compaction
    const result1 = await manager.compact(threadId, 'trim-tool-results');
    expect(result1.hiddenEventIds).toContain(event1!.id);

    // Second batch of events (including compacted replacement from first compaction)
    const event2 = manager.addEvent(threadId, {
      type: 'USER_MESSAGE',
      data: 'Second batch',
      context: { threadId },
    });

    // Second compaction
    const result2 = await manager.compact(threadId, 'trim-tool-results');

    // First batch should still be hidden
    const thread = manager.getThread(threadId);
    const event1Updated = thread!.events.find(e => e.id === event1!.id);
    expect(event1Updated!.visibleToModel).toBe(false);

    // First compaction event should still be hidden
    const firstCompaction = thread!.events.find(e => e.id === result1.compactionEvent.id);
    expect(firstCompaction!.visibleToModel).toBe(false);

    // Second batch should now be hidden
    expect(result2.hiddenEventIds).toContain(event2!.id);

    // Second compaction event should be hidden
    expect(result2.hiddenEventIds).toContain(result2.compactionEvent.id);
  });

  it('should mark compacted replacement events as visible', async () => {
    const threadId = manager.generateThreadId();
    manager.createThread(threadId);

    manager.addEvent(threadId, {
      type: 'USER_MESSAGE',
      data: 'Original message',
      context: { threadId },
    });

    // Use trim strategy which creates replacement events
    const result = await manager.compact(threadId, 'trim-tool-results');
    const compactionData = result.compactionEvent.data as any;

    // Compacted events should be visible (not in hiddenEventIds)
    for (const compactedEvent of compactionData.compactedEvents) {
      expect(result.hiddenEventIds).not.toContain(compactedEvent.id);

      // Read from database to verify
      const thread = manager.getThread(threadId);
      const found = thread!.events.find(e => e.id === compactedEvent.id);
      expect(found!.visibleToModel).toBeUndefined(); // NULL/undefined = visible
    }
  });
});
```

**How to test:**
```bash
npm test compaction-visibility.test.ts
```

**Commit message:**
```
feat(threads): mark events as not visible during compaction

Update compact() to mark all pre-compaction events and the COMPACTION
event itself as visibleToModel: false. Return list of hidden event IDs
for downstream processing.
```

---

### Task 5: Emit EVENT_UPDATED from Agent During Compaction

**Objective:** When Agent calls `ThreadManager.compact()`, emit `EVENT_UPDATED` events for each hidden event so web clients can update in real-time.

**Why this next:** Connects the compaction logic to the event emission system.

**Files to modify:**
- `packages/core/src/agents/agent.ts`

**Steps:**

1. Find the `compact()` method in Agent (search for `async compact(`). There are two implementations - one for manual compaction and one for auto-compaction.

2. Update manual compaction (around line 2200):

Find:
```typescript
// Emit completion event
this._addEventAndEmit({
  type: 'COMPACTION_COMPLETE',
  data: {
    success: true,
    summary: compactionData.metadata?.summary as string | undefined,
    originalEventCount: compactionData.originalEventCount,
    compactedEventCount: compactionData.compactedEvents.length,
  },
  transient: true,
  context: { threadId },
});
```

Add AFTER the COMPACTION_COMPLETE:
```typescript
// Emit EVENT_UPDATED for each hidden event
for (const eventId of result.hiddenEventIds) {
  this._addEventAndEmit({
    type: 'EVENT_UPDATED',
    data: {
      eventId,
      visibleToModel: false,
    },
    transient: true,
    context: { threadId },
  });
}
```

3. Update auto-compaction (around line 2485):

Find the similar COMPACTION_COMPLETE emission and add the same EVENT_UPDATED loop after it.

**Important:** The `compact()` call now returns an object, so update the destructuring:

Change:
```typescript
const compactionEvent = await this._threadManager.compact(
  threadId,
  strategyId,
  compactionContext
);
```

To:
```typescript
const result = await this._threadManager.compact(
  threadId,
  strategyId,
  compactionContext
);
const compactionEvent = result.compactionEvent;
```

**Testing:**

Add to existing `packages/core/src/agents/agent-auto-compact.test.ts`:

```typescript
it('should emit EVENT_UPDATED events after compaction', async () => {
  const agent = new Agent({
    threadId: testThreadId,
    providerInstanceId: 'anthropic-default',
    modelId: 'claude-sonnet-4',
  });

  await agent.initialize();

  const emittedEvents: LaceEvent[] = [];
  agent.on('thread_event_added', ({ event }) => {
    if (event.type === 'EVENT_UPDATED') {
      emittedEvents.push(event);
    }
  });

  // Add events that will be compacted
  agent.sendMessage('Create a simple hello world function');
  await waitForAgentIdle(agent);

  // Manually trigger compaction
  await agent.compact();

  // Should have emitted EVENT_UPDATED for hidden events
  expect(emittedEvents.length).toBeGreaterThan(0);

  for (const event of emittedEvents) {
    expect(event.type).toBe('EVENT_UPDATED');
    expect(event.data).toHaveProperty('eventId');
    expect(event.data).toHaveProperty('visibleToModel');
    expect(event.data.visibleToModel).toBe(false);
  }
});
```

Create `packages/core/src/agents/agent-compaction-events.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent } from '@lace/core/agents/agent';
import type { LaceEvent } from '@lace/core/threads/types';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Agent Compaction Event Emission', () => {
  let tempDir: string;
  let testThreadId: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-test-'));
    process.env.LACE_DIR = tempDir;
    testThreadId = `lace_${Date.now()}_test`;
  });

  afterEach(() => {
    delete process.env.LACE_DIR;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should emit EVENT_UPDATED events during manual compaction', async () => {
    const agent = new Agent({
      threadId: testThreadId,
      providerInstanceId: 'anthropic-default',
      modelId: 'claude-sonnet-4',
    });

    await agent.initialize();

    // Capture emitted events
    const updatedEvents: LaceEvent[] = [];
    agent.on('thread_event_added', ({ event }) => {
      if (event.type === 'EVENT_UPDATED') {
        updatedEvents.push(event);
      }
    });

    // Add some events
    agent.getLaceEvents(); // Force event creation
    const events = agent.getLaceEvents();
    const preCompactionEventIds = events.map(e => e.id);

    // Compact
    await agent.compact();

    // Should have emitted EVENT_UPDATED for each pre-compaction event
    expect(updatedEvents.length).toBeGreaterThan(0);

    // Verify structure
    for (const event of updatedEvents) {
      expect(event.type).toBe('EVENT_UPDATED');
      expect(typeof event.data.eventId).toBe('string');
      expect(event.data.visibleToModel).toBe(false);
      expect(event.transient).toBe(true);
    }

    // All updated event IDs should be from pre-compaction events
    const updatedIds = updatedEvents.map(e => e.data.eventId);
    for (const id of updatedIds) {
      expect(preCompactionEventIds).toContain(id);
    }
  });

  it('should emit EVENT_UPDATED during auto-compaction', async () => {
    const agent = new Agent({
      threadId: testThreadId,
      providerInstanceId: 'anthropic-default',
      modelId: 'claude-sonnet-4',
      autoCompact: true,
      autoCompactThreshold: 100, // Low threshold for testing
    });

    await agent.initialize();

    const updatedEvents: LaceEvent[] = [];
    agent.on('thread_event_added', ({ event }) => {
      if (event.type === 'EVENT_UPDATED') {
        updatedEvents.push(event);
      }
    });

    // Trigger auto-compaction by checking token usage
    // (This is a simplified test - real auto-compaction logic is more complex)
    await agent.compact(); // Manually trigger for test

    expect(updatedEvents.length).toBeGreaterThan(0);
  });

  it('should emit EVENT_UPDATED after COMPACTION_COMPLETE', async () => {
    const agent = new Agent({
      threadId: testThreadId,
      providerInstanceId: 'anthropic-default',
      modelId: 'claude-sonnet-4',
    });

    await agent.initialize();

    const eventSequence: string[] = [];
    agent.on('thread_event_added', ({ event }) => {
      if (event.type === 'COMPACTION_COMPLETE' || event.type === 'EVENT_UPDATED') {
        eventSequence.push(event.type);
      }
    });

    await agent.compact();

    // COMPACTION_COMPLETE should come before EVENT_UPDATED
    const compactionCompleteIndex = eventSequence.indexOf('COMPACTION_COMPLETE');
    const firstUpdateIndex = eventSequence.indexOf('EVENT_UPDATED');

    expect(compactionCompleteIndex).toBeGreaterThanOrEqual(0);
    expect(firstUpdateIndex).toBeGreaterThan(compactionCompleteIndex);
  });
});
```

**How to test:**
```bash
npm test agent-compaction-events.test.ts
```

**Commit message:**
```
feat(agent): emit EVENT_UPDATED events after compaction

Emit EVENT_UPDATED transient events for each event marked as not
visible during compaction. Enables real-time UI updates via SSE.
```

---

### Task 6: Handle EVENT_UPDATED in Web Event Stream

**Objective:** Forward `EVENT_UPDATED` events from core to web clients via SSE.

**Why this next:** Wire up the backend event flow before implementing frontend handling.

**Files to modify:**
- `packages/web/lib/event-stream-manager.ts`
- `packages/web/types/core.ts`

**Steps:**

1. Update `packages/web/types/core.ts` to include EVENT_UPDATED in exported types:

Find the type re-exports (around line 10):
```typescript
export type {
  LaceEvent,
  LaceEventType,
  // ... other exports
} from '@lace/core/threads/types';
```

Verify `EVENT_UPDATED` and `EventUpdatedData` are exported from core. If not, add:
```typescript
export type { EventUpdatedData } from '@lace/core/threads/types';
```

2. Update `packages/web/lib/event-stream-manager.ts`:

Find the `handleAgentEvent` method (or wherever events are forwarded to SSE clients).

The EventStreamManager should already forward all LaceEvents. Verify that `EVENT_UPDATED` will flow through automatically. If there's filtering, ensure `EVENT_UPDATED` is included.

Look for code like:
```typescript
private handleAgentEvent(event: LaceEvent) {
  // Forward to all connected clients
  this.broadcast(event);
}
```

If there's a whitelist of event types, add `'EVENT_UPDATED'` to it.

**Testing:**

Add to `packages/web/lib/event-stream-manager.test.ts` (or create if doesn't exist):

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventStreamManager } from '@lace/core/lib/event-stream-manager';
import type { LaceEvent } from '@lace/web/types/core';

describe('EventStreamManager EVENT_UPDATED handling', () => {
  let manager: EventStreamManager;

  beforeEach(() => {
    manager = EventStreamManager.getInstance();
  });

  afterEach(() => {
    // Clean up any subscriptions
    manager['clients'].clear();
  });

  it('should forward EVENT_UPDATED events to clients', async () => {
    const receivedEvents: LaceEvent[] = [];

    // Mock SSE client
    const mockClient = {
      write: (data: string) => {
        const event = JSON.parse(data.replace('data: ', ''));
        receivedEvents.push(event);
      },
    };

    // Register mock client
    manager['clients'].set('test-client', mockClient as any);

    // Emit EVENT_UPDATED
    const updateEvent: LaceEvent = {
      type: 'EVENT_UPDATED',
      data: {
        eventId: 'evt_123',
        visibleToModel: false,
      },
      transient: true,
      context: {
        threadId: 'lace_20251001_test01',
      },
    };

    manager['broadcast'](updateEvent);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].type).toBe('EVENT_UPDATED');
    expect(receivedEvents[0].data.eventId).toBe('evt_123');
  });

  it('should handle multiple EVENT_UPDATED events in sequence', async () => {
    const receivedEvents: LaceEvent[] = [];

    const mockClient = {
      write: (data: string) => {
        const event = JSON.parse(data.replace('data: ', ''));
        receivedEvents.push(event);
      },
    };

    manager['clients'].set('test-client', mockClient as any);

    // Emit multiple updates (simulating compaction of many events)
    for (let i = 0; i < 10; i++) {
      const updateEvent: LaceEvent = {
        type: 'EVENT_UPDATED',
        data: {
          eventId: `evt_${i}`,
          visibleToModel: false,
        },
        transient: true,
        context: {
          threadId: 'lace_20251001_test01',
        },
      };
      manager['broadcast'](updateEvent);
    }

    expect(receivedEvents).toHaveLength(10);
    expect(receivedEvents.every(e => e.type === 'EVENT_UPDATED')).toBe(true);
  });
});
```

**How to test:**
```bash
npm test event-stream-manager.test.ts
```

**Commit message:**
```
feat(web): forward EVENT_UPDATED events via SSE

Ensure EVENT_UPDATED transient events are forwarded to web clients
through the event stream manager for real-time UI updates.
```

---

### Task 7: Update Client-side Event State on EVENT_UPDATED

**Objective:** When the web client receives `EVENT_UPDATED` via SSE, update the local event state to reflect the new visibility.

**Why this next:** Client needs to track visibility changes before we can render them.

**Files to modify:**
- `packages/web/hooks/useEventStream.ts` or `packages/web/hooks/useAgentEvents.ts`
- `packages/web/components/providers/EventStreamProvider.tsx`

**Steps:**

1. Find where events are stored in client state. Look at `EventStreamProvider.tsx` (around line 30):

```typescript
const [events, setEvents] = useState<LaceEvent[]>([]);
```

2. Add handler for `EVENT_UPDATED` in the event processing logic:

Find where incoming SSE events are processed:
```typescript
useEffect(() => {
  const handleEvent = (event: LaceEvent) => {
    if (event.type === 'USER_MESSAGE' || event.type === 'AGENT_MESSAGE') {
      setEvents(prev => [...prev, event]);
    }
    // ... other event type handlers
  };

  // Subscribe to event stream
  // ...
}, []);
```

Add `EVENT_UPDATED` handler:
```typescript
if (event.type === 'EVENT_UPDATED') {
  // Update existing event's visibility
  setEvents(prev =>
    prev.map(e =>
      e.id === event.data.eventId
        ? { ...e, visibleToModel: event.data.visibleToModel }
        : e
    )
  );
}
```

3. If using a more complex state management (like a reducer), add a case:

```typescript
case 'EVENT_UPDATED': {
  return {
    ...state,
    events: state.events.map(e =>
      e.id === action.payload.eventId
        ? { ...e, visibleToModel: action.payload.visibleToModel }
        : e
    ),
  };
}
```

**Testing:**

Create `packages/web/hooks/useEventStream.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { EventStreamProvider } from '@lace/web/components/providers/EventStreamProvider';
import type { LaceEvent } from '@lace/web/types/core';

describe('useEventStream EVENT_UPDATED handling', () => {
  it('should update event visibility when EVENT_UPDATED is received', async () => {
    const { result } = renderHook(
      () => {
        // Use the provider's context
        const context = React.useContext(EventStreamContext);
        return context;
      },
      {
        wrapper: ({ children }) => (
          <EventStreamProvider>{children}</EventStreamProvider>
        ),
      }
    );

    // Add an initial event
    const initialEvent: LaceEvent = {
      id: 'evt_123',
      type: 'USER_MESSAGE',
      data: 'Test message',
      context: { threadId: 'lace_20251001_test01' },
    };

    act(() => {
      result.current.addEvent(initialEvent);
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].visibleToModel).toBeUndefined();

    // Receive EVENT_UPDATED
    const updateEvent: LaceEvent = {
      type: 'EVENT_UPDATED',
      data: {
        eventId: 'evt_123',
        visibleToModel: false,
      },
      transient: true,
      context: { threadId: 'lace_20251001_test01' },
    };

    act(() => {
      result.current.handleIncomingEvent(updateEvent);
    });

    // Event should be updated
    expect(result.current.events[0].visibleToModel).toBe(false);
  });

  it('should handle multiple EVENT_UPDATED events', async () => {
    const { result } = renderHook(
      () => {
        const context = React.useContext(EventStreamContext);
        return context;
      },
      {
        wrapper: ({ children }) => (
          <EventStreamProvider>{children}</EventStreamProvider>
        ),
      }
    );

    // Add multiple events
    const events: LaceEvent[] = [
      {
        id: 'evt_1',
        type: 'USER_MESSAGE',
        data: 'Message 1',
        context: { threadId: 'lace_20251001_test01' },
      },
      {
        id: 'evt_2',
        type: 'AGENT_MESSAGE',
        data: { content: 'Response 1' },
        context: { threadId: 'lace_20251001_test01' },
      },
      {
        id: 'evt_3',
        type: 'USER_MESSAGE',
        data: 'Message 2',
        context: { threadId: 'lace_20251001_test01' },
      },
    ];

    act(() => {
      events.forEach(e => result.current.addEvent(e));
    });

    // Mark first two as not visible
    act(() => {
      result.current.handleIncomingEvent({
        type: 'EVENT_UPDATED',
        data: { eventId: 'evt_1', visibleToModel: false },
        transient: true,
        context: { threadId: 'lace_20251001_test01' },
      });
      result.current.handleIncomingEvent({
        type: 'EVENT_UPDATED',
        data: { eventId: 'evt_2', visibleToModel: false },
        transient: true,
        context: { threadId: 'lace_20251001_test01' },
      });
    });

    expect(result.current.events[0].visibleToModel).toBe(false);
    expect(result.current.events[1].visibleToModel).toBe(false);
    expect(result.current.events[2].visibleToModel).toBeUndefined();
  });

  it('should ignore EVENT_UPDATED for non-existent events', async () => {
    const { result } = renderHook(
      () => {
        const context = React.useContext(EventStreamContext);
        return context;
      },
      {
        wrapper: ({ children }) => (
          <EventStreamProvider>{children}</EventStreamProvider>
        ),
      }
    );

    act(() => {
      result.current.handleIncomingEvent({
        type: 'EVENT_UPDATED',
        data: { eventId: 'nonexistent', visibleToModel: false },
        transient: true,
        context: { threadId: 'lace_20251001_test01' },
      });
    });

    // Should not crash or add phantom events
    expect(result.current.events).toHaveLength(0);
  });
});
```

**How to test:**
```bash
npm test useEventStream.test.tsx
```

**Commit message:**
```
feat(web): update event visibility on EVENT_UPDATED reception

Handle EVENT_UPDATED events from SSE stream by updating the
visibleToModel flag on existing events in client state.
```

---

### Task 8: Render Greyed-Out Events in Timeline

**Objective:** Apply visual styling to events where `visibleToModel === false` to indicate they're not sent to the model.

**Why this next:** Final user-facing feature - make visibility changes visible in the UI.

**Files to modify:**
- `packages/web/components/timeline/TimelineMessageWithDetails.tsx`
- `packages/web/components/timeline/TimelineView.tsx`

**Steps:**

1. Update `TimelineMessageWithDetails.tsx` to accept and use visibility flag:

Add to props interface:
```typescript
interface TimelineMessageWithDetailsProps {
  event: LaceEvent | ProcessedEvent;
  agents?: AgentInfo[];
  isGrouped?: boolean;
  isLastInGroup?: boolean;
  isFirstInGroup?: boolean;
}
```

2. Add styling logic:
```typescript
export function TimelineMessageWithDetails({
  event,
  agents,
  isGrouped,
  isLastInGroup,
  isFirstInGroup,
}: TimelineMessageWithDetailsProps) {
  // Check if event is visible to model (undefined/true = visible, false = not visible)
  const isVisibleToModel = event.visibleToModel !== false;

  // Base classes
  const baseClasses = "transition-opacity duration-200";
  const visibilityClasses = isVisibleToModel
    ? ""
    : "opacity-40";

  return (
    <div className={`${baseClasses} ${visibilityClasses}`}>
      {/* Existing rendering logic */}
      {!isVisibleToModel && (
        <div className="ml-11 -mt-2">
          <span className="badge badge-ghost badge-xs opacity-60">
            Compacted
          </span>
        </div>
      )}
      {/* Rest of component */}
    </div>
  );
}
```

**Note on UI choice:** Use the badge approach (shown above) rather than plain text. The badge is:
- More compact and less intrusive
- Consistent with DaisyUI component patterns
- Shorter label ("Compacted" vs "Not sent to model")
- Easier to style or hide later if needed

3. Update `TimelineView.tsx` to pass visibility through if needed (it should already pass the full event object).

**Testing:**

Create `packages/web/components/timeline/TimelineMessageWithDetails.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimelineMessageWithDetails } from './TimelineMessageWithDetails';
import type { LaceEvent } from '@lace/web/types/core';

describe('TimelineMessageWithDetails visibility styling', () => {
  it('should render visible events with normal opacity', () => {
    const event: LaceEvent = {
      id: 'evt_1',
      type: 'USER_MESSAGE',
      data: 'Test message',
      visibleToModel: true,
      context: { threadId: 'lace_20251001_test01' },
    };

    const { container } = render(<TimelineMessageWithDetails event={event} />);

    const messageElement = container.firstChild;
    expect(messageElement).not.toHaveClass('opacity-40');
  });

  it('should render non-visible events with reduced opacity', () => {
    const event: LaceEvent = {
      id: 'evt_1',
      type: 'USER_MESSAGE',
      data: 'Test message',
      visibleToModel: false,
      context: { threadId: 'lace_20251001_test01' },
    };

    const { container } = render(<TimelineMessageWithDetails event={event} />);

    const messageElement = container.firstChild;
    expect(messageElement).toHaveClass('opacity-40');
  });

  it('should treat undefined visibleToModel as visible', () => {
    const event: LaceEvent = {
      id: 'evt_1',
      type: 'USER_MESSAGE',
      data: 'Test message',
      context: { threadId: 'lace_20251001_test01' },
    };

    const { container } = render(<TimelineMessageWithDetails event={event} />);

    const messageElement = container.firstChild;
    expect(messageElement).not.toHaveClass('opacity-40');
  });

  it('should show "Compacted" badge for non-visible events', () => {
    const event: LaceEvent = {
      id: 'evt_1',
      type: 'USER_MESSAGE',
      data: 'Test message',
      visibleToModel: false,
      context: { threadId: 'lace_20251001_test01' },
    };

    render(<TimelineMessageWithDetails event={event} />);

    expect(screen.getByText(/compacted/i)).toBeInTheDocument();
  });

  it('should not show indicator for visible events', () => {
    const event: LaceEvent = {
      id: 'evt_1',
      type: 'USER_MESSAGE',
      data: 'Test message',
      visibleToModel: true,
      context: { threadId: 'lace_20251001_test01' },
    };

    render(<TimelineMessageWithDetails event={event} />);

    expect(screen.queryByText(/compacted/i)).not.toBeInTheDocument();
  });

  it('should handle COMPACTION events as non-visible', () => {
    const event: LaceEvent = {
      id: 'evt_comp',
      type: 'COMPACTION',
      data: {
        strategyId: 'summarize',
        originalEventCount: 50,
        compactedEvents: [],
      },
      visibleToModel: false,
      context: { threadId: 'lace_20251001_test01' },
    };

    const { container } = render(<TimelineMessageWithDetails event={event} />);

    const messageElement = container.firstChild;
    expect(messageElement).toHaveClass('opacity-40');
  });
});
```

**How to test manually:**
1. Start the dev server: `npm run dev`
2. Create a conversation with several messages
3. Trigger compaction (via UI or API)
4. Verify that pre-compaction messages appear greyed out
5. Verify that post-compaction messages appear normal
6. Check that the "Compacted" badge appears on greyed-out messages

**How to test automated:**
```bash
npm test TimelineMessageWithDetails.test.tsx
```

**Commit message:**
```
feat(web): render non-visible events with greyed-out styling

Apply opacity-40 styling to events where visibleToModel is false.
Add "Compacted" badge for compacted events.
```

---

### Task 9: End-to-End Integration Test

**Objective:** Test the complete flow from compaction trigger through UI rendering.

**Why this next:** Verify all pieces work together correctly.

**Files to create:**
- `packages/web/e2e/event-visibility.e2e.ts`

**Steps:**

Create comprehensive E2E test:

```typescript
import { test, expect } from '@playwright/test';
import { mockAnthropicAPI } from './helpers/anthropic-mock';

test.describe('Event Visibility After Compaction', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Anthropic API
    await mockAnthropicAPI(page);

    // Navigate to app
    await page.goto('http://localhost:5173');
  });

  test('should grey out events after compaction', async ({ page }) => {
    // Create a new project and session
    await page.click('button:has-text("New Project")');
    await page.fill('input[name="project-name"]', 'Test Project');
    await page.click('button:has-text("Create")');

    // Send a message
    await page.fill('textarea[placeholder="Type a message..."]', 'Hello, create a test function');
    await page.press('textarea', 'Enter');

    // Wait for response
    await page.waitForSelector('text=/function test/i', { timeout: 10000 });

    // Verify message is visible (normal opacity)
    const userMessage = page.locator('text="Hello, create a test function"').first();
    await expect(userMessage).not.toHaveClass(/opacity-40/);

    // Trigger compaction
    await page.click('button[aria-label="More options"]');
    await page.click('button:has-text("Compact History")');

    // Wait for compaction to complete
    await page.waitForSelector('text=/compaction complete/i', { timeout: 5000 });

    // Verify original message is now greyed out
    await expect(userMessage).toHaveClass(/opacity-40/);

    // Verify "Compacted" badge appears
    const badge = page.locator('text=/compacted/i').first();
    await expect(badge).toBeVisible();

    // Send another message after compaction
    await page.fill('textarea[placeholder="Type a message..."]', 'Create another function');
    await page.press('textarea', 'Enter');

    // Wait for response
    await page.waitForSelector('text=/function/i', { timeout: 10000 });

    // Verify new message is NOT greyed out
    const newMessage = page.locator('text="Create another function"').first();
    await expect(newMessage).not.toHaveClass(/opacity-40/);
  });

  test('should handle multiple compactions', async ({ page }) => {
    await page.click('button:has-text("New Project")');
    await page.fill('input[name="project-name"]', 'Multi Compact Test');
    await page.click('button:has-text("Create")');

    // First batch of messages
    await page.fill('textarea', 'First message');
    await page.press('textarea', 'Enter');
    await page.waitForSelector('text=/First message/i');

    // First compaction
    await page.click('button[aria-label="More options"]');
    await page.click('button:has-text("Compact History")');
    await page.waitForSelector('text=/compaction complete/i');

    // Verify first message is greyed
    const firstMessage = page.locator('text="First message"').first();
    await expect(firstMessage).toHaveClass(/opacity-40/);

    // Second batch of messages
    await page.fill('textarea', 'Second message');
    await page.press('textarea', 'Enter');
    await page.waitForSelector('text=/Second message/i');

    // Second compaction
    await page.click('button[aria-label="More options"]');
    await page.click('button:has-text("Compact History")');
    await page.waitForSelector('text=/compaction complete/i');

    // Both should be greyed now
    await expect(firstMessage).toHaveClass(/opacity-40/);
    const secondMessage = page.locator('text="Second message"').first();
    await expect(secondMessage).toHaveClass(/opacity-40/);
  });

  test('should show compaction event as greyed out', async ({ page }) => {
    await page.click('button:has-text("New Project")');
    await page.fill('input[name="project-name"]', 'Compaction Event Test');
    await page.click('button:has-text("Create")');

    await page.fill('textarea', 'Test message for compaction');
    await page.press('textarea', 'Enter');
    await page.waitForSelector('text=/Test message/i');

    // Trigger compaction
    await page.click('button[aria-label="More options"]');
    await page.click('button:has-text("Compact History")');
    await page.waitForSelector('text=/compaction complete/i');

    // Find the COMPACTION event in timeline
    const compactionEvent = page.locator('[data-event-type="COMPACTION"]').first();
    await expect(compactionEvent).toBeVisible();
    await expect(compactionEvent).toHaveClass(/opacity-40/);
  });

  test('should update visibility in real-time via SSE', async ({ page }) => {
    await page.click('button:has-text("New Project")');
    await page.fill('input[name="project-name"]', 'Real-time Test');
    await page.click('button:has-text("Create")');

    await page.fill('textarea', 'Message for real-time test');
    await page.press('textarea', 'Enter');
    await page.waitForSelector('text=/Message for real-time test/i');

    const message = page.locator('text="Message for real-time test"').first();

    // Verify starts as visible
    await expect(message).not.toHaveClass(/opacity-40/);

    // Trigger compaction
    await page.click('button[aria-label="More options"]');
    await page.click('button:has-text("Compact History")');

    // Should update to greyed out without page refresh (via SSE)
    await expect(message).toHaveClass(/opacity-40/, { timeout: 3000 });
  });
});
```

**How to test:**
```bash
npm run test:e2e event-visibility.e2e.ts
```

**Commit message:**
```
test(e2e): add comprehensive event visibility tests

Add E2E tests verifying compacted events are greyed out in UI,
including multiple compactions and real-time SSE updates.
```

---

### Task 10: Documentation and Polish

**Objective:** Document the feature and add any final polish.

**Files to create/modify:**
- `docs/architecture/event-visibility.md`
- Update `CLAUDE.md` if needed

**Steps:**

1. Create architecture documentation:

```markdown
# Event Visibility System

## Overview

The event visibility system allows Lace to distinguish between events that are sent to the AI model (visible) versus events that have been compacted away to save tokens (not visible). This enables the UI to show the complete conversation history while visually indicating which parts the AI "remembers."

## Core Concepts

### visibleToModel Flag

Every `LaceEvent` has an optional `visibleToModel` boolean field:
- `undefined` or `true`: Event is sent to the model
- `false`: Event is not sent to the model (compacted or pruned)

### When Visibility Changes

Visibility is set to `false` in two scenarios:

1. **During compaction**: All events before the compaction point are marked not visible
2. **Manual pruning** (future): User can manually hide events

### Event Flow

```
1. Events created → visibleToModel: undefined (visible by default)
2. Compaction triggered → Pre-compaction events marked visibleToModel: false
3. EVENT_UPDATED emitted → Web clients notified via SSE
4. UI updates → Greyed out styling applied
```

## Implementation Details

### Database Schema

```sql
ALTER TABLE events ADD COLUMN visible_to_model BOOLEAN;
```

- NULL/undefined = visible (default)
- 0/false = not visible
- Uses SQLite's flexible typing (BOOLEAN stored as INTEGER)

### Compaction Flow

1. `ThreadManager.compact()` calls compaction strategy
2. Strategy returns COMPACTION event with compactedEvents
3. ThreadManager:
   - Persists compacted replacement events (visible by default)
   - Marks all pre-compaction events as not visible
   - Marks COMPACTION event itself as not visible
   - Returns list of hiddenEventIds
4. Agent emits EVENT_UPDATED for each hidden event
5. SSE forwards to web clients
6. UI updates local state and applies styling

### Multiple Compactions

The system handles multiple compactions correctly. **Key principle: ALL events before the compaction point are marked not visible, including previous summaries.** This is correct because each new summary supersedes all previous summaries.

```
Initial: [e1, e2, e3] all visible

First compaction (compacts events 1-3):
- [e1, e2, e3] → not visible
- [summary1] → visible (newly created)
- [COMPACTION1] → not visible (metadata)

Add more events: [e4, e5, e6] → visible

Second compaction (compacts ALL events before this point, including summary1):
- [e1, e2, e3] → still not visible
- [summary1] → now not visible (it's before the new compaction point!)
- [COMPACTION1] → still not visible
- [e4, e5, e6] → now not visible
- [summary2] → visible (newly created, replaces ALL previous content)
- [COMPACTION2] → not visible (metadata)
```

**Why summary1 becomes not visible:** The compaction logic marks ALL events before the compaction index as not visible. The index is determined by timestamp/position, not by whether an event was previously a summary. This ensures the model only sees the most recent summary.

### UI Rendering

Components check `event.visibleToModel !== false` to determine styling:

```typescript
const isVisibleToModel = event.visibleToModel !== false;
const visibilityClasses = isVisibleToModel ? "" : "opacity-40";
```

## Testing Strategy

1. **Unit tests**: Database persistence, visibility updates
2. **Integration tests**: Compaction flow, event emission
3. **E2E tests**: UI rendering, real-time updates

## Future Enhancements

1. **Manual pruning**: UI for manually hiding/showing events
2. **Visibility presets**: Quick filters (show all, show visible only)
3. **Visibility history**: Track when events were hidden
4. **Bulk operations**: Mark multiple events at once
```

2. Add inline code comments where complex logic exists

3. Update any relevant sections in main `CLAUDE.md` if the architecture changed significantly

**Commit message:**
```
docs: add event visibility architecture documentation

Document the event visibility system including database schema,
compaction flow, and UI rendering strategy.
```

---

## Testing Strategy Summary

### Unit Tests
- Database migration and persistence
- Type definitions and guards
- ThreadManager compaction visibility logic
- Agent event emission

### Integration Tests
- ThreadManager + Database interaction
- Agent + ThreadManager compaction flow
- Event stream forwarding

### E2E Tests
- Full user flow: message → compaction → greyed out UI
- Multiple compactions
- Real-time SSE updates

### Manual Testing Checklist
- [ ] Create conversation with 10+ messages
- [ ] Trigger compaction
- [ ] Verify pre-compaction messages greyed out
- [ ] Send new message after compaction
- [ ] Verify new message NOT greyed out
- [ ] Trigger second compaction
- [ ] Verify first summary now greyed out
- [ ] Check browser console for errors
- [ ] Check SSE stream for EVENT_UPDATED events
- [ ] Verify database has correct visible_to_model values

## Common Pitfalls

1. **Cache invalidation timing**: Invalidate cache BEFORE reading thread data to prevent race conditions
2. **Event ID null checks**: Always check `event.id` exists before updating visibility
3. **Treating undefined as false**: Remember `undefined` means visible, only explicit `false` means not visible
4. **SSE timing**: EVENT_UPDATED must come AFTER COMPACTION_COMPLETE
5. **Multiple compactions**: Don't assume events are only compacted once - previous summaries become not visible
6. **Immutability**: Don't mutate events during deserialization - return new objects with spread operator

## Development Workflow

1. Write failing test
2. Implement minimal code to pass test
3. Refactor if needed
4. Commit with descriptive message
5. Move to next task

Each task should be a separate commit. Push frequently.

## Getting Help

- **Types confused?** Check `packages/core/src/threads/types.ts`
- **Database issues?** Check `packages/core/src/persistence/database.ts`
- **Event flow unclear?** Check `packages/core/src/agents/agent.ts`
- **UI not updating?** Check `packages/web/components/providers/EventStreamProvider.tsx`
- **Tests failing?** Check test file for similar passing tests as examples

## Verification

After completing all tasks:

```bash
# Run all tests
npm test

# Run E2E tests
npm run test:e2e

# Build project
npm run build

# Start dev server and manually verify
npm run dev
```

Expected behavior:
1. Old conversations show all events
2. Pre-compaction events are greyed out with "Compacted" badge
3. Post-compaction events are normal
4. Multiple compactions work correctly
5. Real-time updates work via SSE
6. No console errors
7. All tests pass

---

## FAQ / Design Decisions

### Q: Why mutate events during deserialization in Task 3?

**A:** Don't! The original plan had a bug. Use the spread operator to maintain immutability:

```typescript
const finalEvent = row.visible_to_model === 0
  ? { ...event, visibleToModel: false }
  : event;
```

This creates a new object only when needed, respecting the immutable events principle.

### Q: Why invalidate cache before reading thread data in Task 4?

**A:** To prevent race conditions. If we update the database, then read from cache, then invalidate cache, another component could read stale data between steps 1 and 3. By invalidating first, we ensure all subsequent reads (including ours) get fresh data.

### Q: Do previous summaries become "not visible" after a second compaction?

**A:** Yes! ALL events before the compaction point are marked not visible, including previous summaries. This is correct because:
- Compaction point is determined by timestamp/index, not event type
- The new summary supersedes all previous content (including old summaries)
- The model only needs the most recent summary, not a "summary of summaries"

### Q: Badge or text label for the UI indicator?

**A:** Use the badge approach:
```typescript
<span className="badge badge-ghost badge-xs opacity-60">
  Compacted
</span>
```

Reasons:
- More compact and less intrusive
- Consistent with DaisyUI patterns
- Shorter, clearer label
- Easier to style/hide later if needed
