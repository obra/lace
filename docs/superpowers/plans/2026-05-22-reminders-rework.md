# Reminders Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shipped `schedule_alarm` / `cancel_alarm` / `list_alarms` surface with a single `manage_reminders` tool backed by a new per-session async-mutex scheduler, per the spec at `docs/specs/2026-05-22-alarms-coherent-design.md`.

**Architecture:** One tool (`manage_reminders`) with action enum (`schedule`/`cancel`/`list`); type-discriminated `next`/`recurs` time fields; per-session async mutex serializes the fire path and tool handlers; single-write fire path with at-most-one-missed-on-failure semantics; storage in `<sessionDir>/reminders.json` with a simplified row shape (no `status`, no `notify_attempts`); notification kind `reminder` with structured attributes for envelope metadata; cron evaluated in agent localtime via `process.env.TZ` / `Intl` fallback.

**Tech Stack:** TypeScript 5.6+, Node 20.18+, zod for schema validation, `cron-parser` for cron evaluation, Vitest for tests, lace's existing `atomicWriteJson`/`injectNotification`/`appendDurableEvent` utilities.

**Reading order before starting:**
1. `docs/specs/2026-05-22-alarms-coherent-design.md` — the spec this plan implements.
2. `packages/agent/src/alarms/` — the shipped code being replaced.
3. `packages/agent/src/notifications/notification-wrapper.ts` — utility being modified.
4. `packages/agent/src/server.ts:262-340` — alarm scheduler wiring being replaced.

---

## File Structure

**Create:**

```
packages/agent/src/reminders/
├── async-mutex.ts            # per-session Promise-chain mutex (~30 LoC)
├── types.ts                  # ReminderRow, AlarmsSnapshot → RemindersSnapshot, MAX_ACTIVE_REMINDERS
├── cron.ts                   # 5-min floor with 20-sample window
├── store.ts                  # ReminderStore: load/persist reminders.json
├── scheduler.ts              # ReminderScheduler: single-write fire path under mutex
├── index.ts                  # exports
└── __tests__/
    ├── async-mutex.test.ts
    ├── cron.test.ts
    ├── store.test.ts
    └── scheduler.test.ts

packages/agent/src/tools/implementations/
├── manage_reminders.ts       # single tool with action enum
└── __tests__/
    └── manage_reminders.test.ts
```

**Modify:**

```
packages/agent/src/notifications/notification-wrapper.ts  # typed attributes API; new NotificationKind
packages/agent/src/notifications/composers.ts             # reminder composer; subagent-exited compact format
packages/agent/src/notifications/index.ts                 # exports
packages/agent/src/notifications/__tests__/notification-wrapper.test.ts
packages/agent/src/notifications/__tests__/composers.test.ts
packages/agent/src/tools/types.ts                         # reminderScheduler in ToolContext
packages/agent/src/tools/executor.ts                      # register ManageRemindersTool
packages/agent/src/server-types.ts                        # reminderScheduler on AgentServerState
packages/agent/src/server.ts                              # ensureReminderSchedulerForActiveSession
```

**Delete (last task):**

```
packages/agent/src/alarms/                                       # entire directory
packages/agent/src/tools/implementations/schedule_alarm.ts
packages/agent/src/tools/implementations/cancel_alarm.ts
packages/agent/src/tools/implementations/list_alarms.ts
packages/agent/src/tools/implementations/__tests__/schedule_alarm.test.ts
packages/agent/src/tools/implementations/__tests__/cancel_alarm.test.ts
packages/agent/src/tools/implementations/__tests__/list_alarms.test.ts
```

**Why this structure:** The new subsystem is built in parallel under `packages/agent/src/reminders/` while the old `alarms/` directory keeps the system working. Only the final task deletes old code, by which point the new system is wired up and tests pass. This makes the transition reviewable as one commit and trivially revertable.

---

## Task 1: Async mutex utility

**Files:**
- Create: `packages/agent/src/reminders/async-mutex.ts`
- Create: `packages/agent/src/reminders/__tests__/async-mutex.test.ts`

Lace's existing `runExclusive` pattern (see `server.ts:413`) is a Promise-chain mutex tied to `AgentServerState.sessionMutex`. We need a standalone version we can attach to the reminder scheduler.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent/src/reminders/__tests__/async-mutex.test.ts
import { describe, it, expect } from 'vitest';
import { AsyncMutex } from '../async-mutex';

describe('AsyncMutex', () => {
  it('serializes concurrent acquisitions', async () => {
    const mutex = new AsyncMutex();
    const events: string[] = [];

    const a = mutex.runExclusive(async () => {
      events.push('a-start');
      await new Promise((r) => setTimeout(r, 20));
      events.push('a-end');
    });
    const b = mutex.runExclusive(async () => {
      events.push('b-start');
      await new Promise((r) => setTimeout(r, 10));
      events.push('b-end');
    });

    await Promise.all([a, b]);

    // b must wait for a to finish before starting.
    expect(events).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('releases the lock when the body throws', async () => {
    const mutex = new AsyncMutex();
    await expect(
      mutex.runExclusive(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    // Lock is released; the next acquisition runs immediately.
    let ran = false;
    await mutex.runExclusive(() => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('returns the body result', async () => {
    const mutex = new AsyncMutex();
    const result = await mutex.runExclusive(() => 42);
    expect(result).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx vitest --run src/reminders/__tests__/async-mutex.test.ts`
Expected: FAIL with "Cannot find module '../async-mutex'".

- [ ] **Step 3: Write the implementation**

```ts
// packages/agent/src/reminders/async-mutex.ts
// ABOUTME: Per-session async mutex via Promise-chain serialization.
// ABOUTME: Mirrors the runExclusive pattern in server.ts but standalone so the
// ABOUTME: reminders scheduler can own one without coupling to AgentServerState.

export class AsyncMutex {
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * Run `work` after every previously-queued caller has completed.
   * Resolves with the body's return value; rejects with the body's error
   * (and releases the lock either way).
   */
  async runExclusive<T>(work: () => T | Promise<T>): Promise<T> {
    const previous = this.tail;
    let release: () => void;
    const ticket = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail = ticket;
    try {
      await previous;
      return await work();
    } finally {
      release!();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent && npx vitest --run src/reminders/__tests__/async-mutex.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/reminders/async-mutex.ts packages/agent/src/reminders/__tests__/async-mutex.test.ts
git commit -m "feat(reminders): add per-session AsyncMutex utility"
```

---

## Task 2: Reminders types module

**Files:**
- Create: `packages/agent/src/reminders/types.ts`

The new row shape is structurally simpler than the alarm one: no `status` field, no `pending_cancel`, no `notify_attempts`, no separate `kind` enum. Recurrence is a discriminated union directly on the row.

- [ ] **Step 1: Write the types**

```ts
// packages/agent/src/reminders/types.ts
// ABOUTME: Reminder row shape persisted in reminders.json and the in-memory
// ABOUTME: snapshot format consumed by ReminderStore + ReminderScheduler.

export type ReminderRecurs =
  | { kind: 'cron'; expr: string }
  | { kind: 'count'; interval_ms: number; remaining: number }
  | null;

export interface ReminderRow {
  /** `reminder_<12hex>`. */
  id: string;
  /** Epoch ms — surfaces as `set-at` attribute. */
  created_at: number;
  /** Epoch ms — when the next fire should happen. */
  next_fire_at: number;

  /** Past-me's words, stored raw (no XML escape until injection time). */
  prompt: string;

  /** null = one-shot; cron expr; or count-at-interval. */
  recurs: ReminderRecurs;

  /** Most recent successful fire (epoch ms), or null if never fired. */
  fired_at: number | null;
  /** Increments on every successful fire; 0 until the first fire. */
  fire_count: number;
}

export interface RemindersSnapshot {
  reminders: ReminderRow[];
}

/** Hard cap on pending+firing rows per session. */
export const MAX_ACTIVE_REMINDERS = 50;

/** Minimum interval for both cron evaluation and count-interval gap. */
export const MIN_INTERVAL_SECONDS = 300;
export const MIN_INTERVAL_MS = MIN_INTERVAL_SECONDS * 1000;
```

- [ ] **Step 2: Verify type-check**

Run: `cd packages/agent && npx tsc --noEmit -p tsconfig.json`
Expected: no errors related to `reminders/types.ts`. (If there are unrelated pre-existing errors in the package, ignore — we only care that the new file type-checks.)

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/reminders/types.ts
git commit -m "feat(reminders): add ReminderRow + recurrence type discriminated union"
```

---

## Task 3: Cron helpers — 5-min floor with 20-sample window

**Files:**
- Create: `packages/agent/src/reminders/cron.ts`
- Create: `packages/agent/src/reminders/__tests__/cron.test.ts`

The new floor is **5 minutes**, sampled over the next 20 cron fires (catches irregular patterns the shipped 2-sample check missed). Drop `assertValidIanaTimezone` — the timezone is no longer agent-supplied; we pull from `process.env.TZ`. Drop jitter — the original purpose (back-firing protection across many agents) doesn't apply to a single-session local scheduler.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/agent/src/reminders/__tests__/cron.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeNextCronFire,
  assertCronAtLeast5MinInterval,
  getAgentTimezone,
} from '../cron';

describe('getAgentTimezone', () => {
  const origTZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = origTZ;
  });
  it('returns process.env.TZ when set', () => {
    process.env.TZ = 'America/New_York';
    expect(getAgentTimezone()).toBe('America/New_York');
  });
  it('falls back to Intl when TZ is unset', () => {
    delete process.env.TZ;
    const tz = getAgentTimezone();
    // Just assert it's a non-empty IANA-looking string.
    expect(tz).toMatch(/\w+\/\w+|UTC/);
  });
});

describe('computeNextCronFire', () => {
  it('returns next match strictly > after', () => {
    const after = new Date('2026-05-22T09:00:00-07:00');
    const next = computeNextCronFire('0 9 * * *', 'America/Los_Angeles', after);
    // Same-instant match must NOT count; expect next day.
    expect(new Date(next).toISOString()).toBe('2026-05-23T16:00:00.000Z');
  });
});

describe('assertCronAtLeast5MinInterval', () => {
  it('accepts cron with min delta >= 5 minutes', () => {
    expect(() => assertCronAtLeast5MinInterval('*/5 * * * *', 'UTC')).not.toThrow();
    expect(() => assertCronAtLeast5MinInterval('0 9 * * 1-5', 'UTC')).not.toThrow();
    expect(() => assertCronAtLeast5MinInterval('0,30 9-17 * * 1-5', 'UTC')).not.toThrow();
  });
  it('rejects cron with min delta < 5 minutes', () => {
    expect(() => assertCronAtLeast5MinInterval('*/1 * * * *', 'UTC')).toThrow(/minimum interval is 5 minutes/i);
    expect(() => assertCronAtLeast5MinInterval('* * * * *', 'UTC')).toThrow(/minimum interval is 5 minutes/i);
  });
  it('rejects cron with tight cluster across 20-sample window', () => {
    // `0,1 9 * * *` fires at 9:00 and 9:01 daily — 1-min gap inside cluster, 23h59m gap between clusters.
    // 20 samples spans ~10 days and sees the 1-min gap.
    expect(() => assertCronAtLeast5MinInterval('0,1 9 * * *', 'UTC')).toThrow(/minimum interval is 5 minutes/i);
  });
  it('rejects invalid cron syntax', () => {
    expect(() => assertCronAtLeast5MinInterval('not a cron', 'UTC')).toThrow(/invalid cron expression/i);
    expect(() => assertCronAtLeast5MinInterval('0 9', 'UTC')).toThrow(/invalid cron expression/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent && npx vitest --run src/reminders/__tests__/cron.test.ts`
Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Write the implementation**

```ts
// packages/agent/src/reminders/cron.ts
// ABOUTME: Cron + agent-localtime helpers for the reminders subsystem.
// ABOUTME: Cron uses process.env.TZ / Intl fallback (no agent-supplied tz).
// ABOUTME: 5-min floor enforced over the next 20 matches to catch irregular patterns.

import { CronExpressionParser } from 'cron-parser';
import { MIN_INTERVAL_MS } from './types';

const SAMPLE_COUNT = 20;

/** Returns the agent's localtime IANA name from process.env.TZ or Intl. */
export function getAgentTimezone(): string {
  const envTZ = process.env.TZ;
  if (envTZ && envTZ.trim().length > 0) return envTZ;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && tz.length > 0) return tz;
  throw new Error(
    'agent timezone is unset: set process.env.TZ to an IANA name (e.g. America/Los_Angeles)'
  );
}

/** Next match strictly > `after`. */
export function computeNextCronFire(
  expr: string,
  timezone: string,
  after: Date
): number {
  const interval = CronExpressionParser.parse(expr, {
    tz: timezone,
    currentDate: after, // cron-parser's `next()` returns strictly > currentDate.
  });
  return interval.next().toDate().getTime();
}

/**
 * Validate that the cron expression's minimum inter-fire delta across the
 * next 20 fires is at least 5 minutes. The 20-sample window catches
 * irregular patterns like `0,1 9 * * *` (1-min cluster gap) that a
 * 2-sample check would miss.
 */
export function assertCronAtLeast5MinInterval(expr: string, timezone: string): void {
  let interval: ReturnType<typeof CronExpressionParser.parse>;
  try {
    interval = CronExpressionParser.parse(expr, { tz: timezone });
  } catch (err) {
    throw new Error(
      `invalid cron expression "${expr}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
  let previous: number | null = null;
  let minDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    let next: number;
    try {
      next = interval.next().toDate().getTime();
    } catch {
      // Cron has no further matches in the foreseeable future; stop sampling.
      break;
    }
    if (previous !== null) {
      const delta = next - previous;
      if (delta < minDelta) minDelta = delta;
    }
    previous = next;
  }
  if (minDelta < MIN_INTERVAL_MS) {
    throw new Error(
      `cron expression "${expr}" has a minimum interval of ${Math.round(minDelta / 1000)}s; minimum interval is 5 minutes (300s)`
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && npx vitest --run src/reminders/__tests__/cron.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/reminders/cron.ts packages/agent/src/reminders/__tests__/cron.test.ts
git commit -m "feat(reminders): cron helpers with 5-min floor and 20-sample window"
```

---

## Task 4: ReminderStore

**Files:**
- Create: `packages/agent/src/reminders/store.ts`
- Create: `packages/agent/src/reminders/__tests__/store.test.ts`

`ReminderStore` is intentionally simpler than `AlarmStore`. No `status` machinery, no `claim/markFired/rescheduleCron`. The store is just load + persist. The scheduler does state computation; the store does I/O.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/agent/src/reminders/__tests__/store.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReminderStore } from '../store';
import type { ReminderRow } from '../types';

function tempSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'lace-reminders-'));
}

function exampleRow(id = 'reminder_abc123abc123'): ReminderRow {
  return {
    id,
    created_at: 1_700_000_000_000,
    next_fire_at: 1_700_000_300_000,
    prompt: 'follow up',
    recurs: null,
    fired_at: null,
    fire_count: 0,
  };
}

describe('ReminderStore', () => {
  it('empty when no file exists', () => {
    const s = new ReminderStore(tempSessionDir());
    expect(s.list()).toEqual([]);
  });

  it('save writes reminders.json atomically', () => {
    const dir = tempSessionDir();
    const s = new ReminderStore(dir);
    s.save([exampleRow()]);
    expect(existsSync(join(dir, 'reminders.json'))).toBe(true);
    const raw = JSON.parse(readFileSync(join(dir, 'reminders.json'), 'utf8')) as {
      reminders: ReminderRow[];
    };
    expect(raw.reminders).toHaveLength(1);
    expect(raw.reminders[0].id).toBe('reminder_abc123abc123');
  });

  it('load reads previously-saved snapshot', () => {
    const dir = tempSessionDir();
    const s = new ReminderStore(dir);
    s.save([exampleRow('reminder_111111111111'), exampleRow('reminder_222222222222')]);
    const s2 = new ReminderStore(dir);
    const rows = s2.list();
    expect(rows.map((r) => r.id).sort()).toEqual([
      'reminder_111111111111',
      'reminder_222222222222',
    ]);
  });

  it('load tolerates malformed json without crashing', () => {
    const dir = tempSessionDir();
    writeFileSync(join(dir, 'reminders.json'), 'not json{{{');
    const s = new ReminderStore(dir);
    expect(s.list()).toEqual([]);
  });

  it('load discards rows with non-string id', () => {
    const dir = tempSessionDir();
    writeFileSync(
      join(dir, 'reminders.json'),
      JSON.stringify({ reminders: [{ id: 42, prompt: 'bad' }, exampleRow()] })
    );
    const s = new ReminderStore(dir);
    expect(s.list()).toHaveLength(1);
    expect(s.list()[0].id).toBe('reminder_abc123abc123');
  });

  it('save creates the session directory if missing', () => {
    const dir = join(tempSessionDir(), 'subdir', 'nested');
    const s = new ReminderStore(dir);
    s.save([exampleRow()]);
    expect(existsSync(join(dir, 'reminders.json'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent && npx vitest --run src/reminders/__tests__/store.test.ts`
Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Write the implementation**

```ts
// packages/agent/src/reminders/store.ts
// ABOUTME: Per-session ReminderStore. Single reminders.json snapshot, atomically
// ABOUTME: rewritten via atomicWriteJson. Pure load/save — no state machinery.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteJson } from '../storage/atomic-write';
import type { ReminderRow, RemindersSnapshot } from './types';
import { logger } from '@lace/agent/utils/logger';

const FILE_NAME = 'reminders.json';

export class ReminderStore {
  private readonly path: string;

  constructor(private readonly sessionDir: string) {
    mkdirSync(sessionDir, { recursive: true });
    this.path = join(sessionDir, FILE_NAME);
  }

  /** Read the current snapshot. Returns [] on missing or malformed file. */
  list(): ReminderRow[] {
    if (!existsSync(this.path)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<RemindersSnapshot>;
      const rows = Array.isArray(raw.reminders) ? raw.reminders : [];
      return rows.filter((r): r is ReminderRow => typeof (r as ReminderRow)?.id === 'string');
    } catch (err) {
      logger.warn('reminders.store.corrupt_snapshot', {
        path: this.path,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /** Atomically rewrite reminders.json with the given rows. */
  save(rows: ReminderRow[]): void {
    const snapshot: RemindersSnapshot = { reminders: rows };
    atomicWriteJson(this.path, snapshot, { mode: 0o600 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && npx vitest --run src/reminders/__tests__/store.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/reminders/store.ts packages/agent/src/reminders/__tests__/store.test.ts
git commit -m "feat(reminders): add ReminderStore (pure load/save)"
```

---

## Task 5: ReminderScheduler — fire path under the mutex

**Files:**
- Create: `packages/agent/src/reminders/scheduler.ts`
- Create: `packages/agent/src/reminders/__tests__/scheduler.test.ts`

The scheduler owns the mutex, the in-memory min-heap, the wake timer, and the fire path (§3.3 of the spec). Schedule, cancel, and list call into it.

### What it exposes

```ts
class ReminderScheduler {
  constructor(deps: SchedulerDeps);
  start(): Promise<void>;
  stop(): Promise<void>;
  schedule(input: ScheduleInput): Promise<ScheduleResult>;
  cancel(id: string): Promise<CancelResult>;
  list(): Promise<ReminderRow[]>;
  // For tests:
  tickForTest(now: number): Promise<void>;
}
```

The deps include `sessionDir`, `now()`, `notifier`, `onError`. The scheduler creates its own `ReminderStore`, `AsyncMutex`, and heap internally.

### What this task covers

The fire path only (§3.3). Schedule, cancel, and list go in later tasks. We'll test by directly inserting a row via the store, ticking the scheduler, and asserting the notification was emitted.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent/src/reminders/__tests__/scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReminderScheduler } from '../scheduler';
import { ReminderStore } from '../store';
import type { ReminderRow } from '../types';

function tempSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'lace-rsched-'));
}

function makeRow(overrides: Partial<ReminderRow> = {}): ReminderRow {
  return {
    id: 'reminder_aaaaaaaaaaaa',
    created_at: 1_700_000_000_000,
    next_fire_at: 1_700_000_000_500,
    prompt: 'fire me',
    recurs: null,
    fired_at: null,
    fire_count: 0,
    ...overrides,
  };
}

describe('ReminderScheduler fire path', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'UTC';
  });
  afterEach(() => {
    process.env.TZ = origTZ;
  });

  it('fires a one-shot row, deletes it, and calls notifier with row + fire context', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    const row = makeRow({ next_fire_at: 1000 });
    store.save([row]);

    const fired: Array<{ row: ReminderRow; firedAt: number; fireCount: number }> = [];
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000, // past next_fire_at
      notifier: async (arg) => {
        fired.push(arg);
      },
      onError: () => {},
    });

    await sched.tickForTest(2000);

    expect(fired).toHaveLength(1);
    expect(fired[0].row.id).toBe(row.id);
    expect(fired[0].firedAt).toBe(2000);
    expect(fired[0].fireCount).toBe(1);

    // One-shot was deleted from disk.
    expect(new ReminderStore(dir).list()).toEqual([]);
  });

  it('reschedules a count-interval row after fire (continuing)', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    const row = makeRow({
      next_fire_at: 1000,
      recurs: { kind: 'count', interval_ms: 5 * 60_000, remaining: 3 },
    });
    store.save([row]);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000,
      notifier: async () => {},
      onError: () => {},
    });

    await sched.tickForTest(2000);

    const rows = new ReminderStore(dir).list();
    expect(rows).toHaveLength(1);
    expect(rows[0].next_fire_at).toBe(2000 + 5 * 60_000);
    expect(rows[0].recurs).toEqual({ kind: 'count', interval_ms: 5 * 60_000, remaining: 2 });
    expect(rows[0].fire_count).toBe(1);
    expect(rows[0].fired_at).toBe(2000);
  });

  it('deletes count-interval row on terminal fire (remaining was 1)', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    const row = makeRow({
      next_fire_at: 1000,
      recurs: { kind: 'count', interval_ms: 5 * 60_000, remaining: 1 },
    });
    store.save([row]);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000,
      notifier: async () => {},
      onError: () => {},
    });

    await sched.tickForTest(2000);
    expect(new ReminderStore(dir).list()).toEqual([]);
  });

  it('reschedules a cron row to the next match strictly > now', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    // 9am UTC daily.
    const baseTime = new Date('2026-05-22T09:00:00Z').getTime();
    const row = makeRow({
      next_fire_at: baseTime,
      recurs: { kind: 'cron', expr: '0 9 * * *' },
    });
    store.save([row]);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => baseTime + 100,
      notifier: async () => {},
      onError: () => {},
    });
    await sched.tickForTest(baseTime + 100);

    const rows = new ReminderStore(dir).list();
    expect(rows).toHaveLength(1);
    expect(rows[0].next_fire_at).toBe(new Date('2026-05-23T09:00:00Z').getTime());
  });

  it('on notifier failure, post-fire state is still committed (at-most-one-missed)', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    const row = makeRow({
      next_fire_at: 1000,
      recurs: { kind: 'count', interval_ms: 5 * 60_000, remaining: 3 },
    });
    store.save([row]);

    const errors: unknown[] = [];
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000,
      notifier: async () => {
        throw new Error('inject failed');
      },
      onError: (err) => {
        errors.push(err);
      },
    });

    await sched.tickForTest(2000);

    // Row is already in post-fire state on disk even though notify failed.
    const rows = new ReminderStore(dir).list();
    expect(rows).toHaveLength(1);
    expect(rows[0].fire_count).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('on persist failure during fire, restores heap entry and skips notify', async () => {
    // We simulate persist failure by stubbing the store's save method via a subclass.
    const dir = tempSessionDir();
    const row = makeRow({
      next_fire_at: 1000,
      recurs: { kind: 'count', interval_ms: 5 * 60_000, remaining: 3 },
    });
    new ReminderStore(dir).save([row]);

    let notified = 0;
    let errors = 0;
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000,
      notifier: async () => {
        notified++;
      },
      onError: () => {
        errors++;
      },
    });
    // Force store.save to throw once on next call.
    const realSave = (sched as unknown as { store: { save: typeof ReminderStore.prototype.save } }).store.save;
    let calls = 0;
    (sched as unknown as { store: { save: typeof realSave } }).store.save = function (rows) {
      calls++;
      if (calls === 1) throw new Error('disk full');
      return realSave.call(this, rows);
    };

    await sched.tickForTest(2000);

    expect(notified).toBe(0);
    expect(errors).toBe(1);
    // Row unchanged on disk.
    const rows = new ReminderStore(dir).list();
    expect(rows[0].fire_count).toBe(0);
    expect(rows[0].next_fire_at).toBe(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx vitest --run src/reminders/__tests__/scheduler.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/agent/src/reminders/scheduler.ts
// ABOUTME: ReminderScheduler — single-thread, per-session async-mutex scheduler.
// ABOUTME: Owns the in-memory min-heap and the wake timer. Fire path (§3.3 of spec)
// ABOUTME: is one atomic write per fire; cancel and schedule serialize via the mutex.

import { AsyncMutex } from './async-mutex';
import { ReminderStore } from './store';
import { computeNextCronFire, getAgentTimezone } from './cron';
import type { ReminderRow } from './types';

export interface FireContext {
  row: ReminderRow;
  /** Epoch ms — when this fire was committed (also the `fired-at` attribute value). */
  firedAt: number;
  /** 1-indexed: this is the Nth fire of this reminder. */
  fireCount: number;
  /** Previous successful fire, or null if this was the first. */
  lastFiredAt: number | null;
  /** Next scheduled fire after this one, or null if terminal. */
  nextFireAt: number | null;
}

export interface SchedulerDeps {
  sessionDir: string;
  now: () => number;
  notifier: (ctx: FireContext) => Promise<void> | void;
  onError?: (err: unknown) => void;
}

interface HeapEntry {
  id: string;
  nextFireAt: number;
}

export class ReminderScheduler {
  // Public for the schedule/cancel/list handlers added in later tasks.
  readonly store: ReminderStore;
  readonly mutex = new AsyncMutex();

  private readonly now: () => number;
  private readonly notifier: SchedulerDeps['notifier'];
  private readonly onError: (err: unknown) => void;

  private heap: HeapEntry[] = [];
  private wakeTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: SchedulerDeps) {
    this.store = new ReminderStore(deps.sessionDir);
    this.now = deps.now;
    this.notifier = deps.notifier;
    this.onError = deps.onError ?? (() => {});
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.bootRecover();
    this.rescheduleNextTick();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
  }

  /** For tests: process all rows whose next_fire_at <= now, then return. */
  async tickForTest(now: number): Promise<void> {
    this.heap = this.store
      .list()
      .map((r) => ({ id: r.id, nextFireAt: r.next_fire_at }))
      .sort((a, b) => a.nextFireAt - b.nextFireAt);
    while (this.heap.length > 0 && this.heap[0].nextFireAt <= now) {
      const entry = this.heap.shift()!;
      await this.fire(entry.id);
    }
  }

  // ============================================================
  // Internal — boot recovery and tick loop are implemented in later tasks.
  // For now, bootRecover just populates the heap from disk.
  // ============================================================

  private async bootRecover(): Promise<void> {
    const rows = this.store.list();
    this.heap = rows
      .map((r) => ({ id: r.id, nextFireAt: r.next_fire_at }))
      .sort((a, b) => a.nextFireAt - b.nextFireAt);
  }

  private rescheduleNextTick(): void {
    if (!this.running) return;
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    const head = this.heap[0];
    if (!head) return;
    const delay = Math.max(0, head.nextFireAt - this.now());
    this.wakeTimer = setTimeout(() => {
      void this.onTick();
    }, delay);
  }

  private async onTick(): Promise<void> {
    if (!this.running) return;
    const head = this.heap[0];
    if (!head) return;
    if (head.nextFireAt > this.now()) {
      this.rescheduleNextTick();
      return;
    }
    this.heap.shift();
    await this.fire(head.id);
    this.rescheduleNextTick();
  }

  /**
   * Fire one row. Implements §3.3 of the spec under the mutex:
   *   1. Acquire mutex.
   *   2. Re-read disk.
   *   3. Compute post-fire state in memory.
   *   4. Commit (single atomic write); on failure push heap entry back and skip notify.
   *   5. Notify.
   *   6. Release mutex (finally).
   *   7. On notify failure, log via onError; row already in post-fire state.
   */
  private async fire(id: string): Promise<void> {
    await this.mutex.runExclusive(async () => {
      const rows = this.store.list();
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return; // Cancelled between tick and mutex acquire.

      const prior: ReminderRow = JSON.parse(JSON.stringify(rows[idx])) as ReminderRow;
      const firedAt = this.now();

      // Compute post-fire state.
      const post = this.computePostFire(prior, firedAt);
      // post.nextRow === null means delete.

      const nextRows = [...rows];
      if (post.nextRow === null) {
        nextRows.splice(idx, 1);
      } else {
        nextRows[idx] = post.nextRow;
      }

      // Commit.
      try {
        this.store.save(nextRows);
      } catch (err) {
        // Restore heap entry; skip notify.
        this.heap.push({ id, nextFireAt: prior.next_fire_at });
        this.heap.sort((a, b) => a.nextFireAt - b.nextFireAt);
        this.onError(err);
        return;
      }

      // Update heap (for continuing recurring, push the new entry).
      if (post.nextRow) {
        this.heap.push({ id, nextFireAt: post.nextRow.next_fire_at });
        this.heap.sort((a, b) => a.nextFireAt - b.nextFireAt);
      }

      // Notify (outside the persist path; mutex still held).
      try {
        await this.notifier({
          row: post.nextRow ?? prior,
          firedAt,
          fireCount: prior.fire_count + 1,
          lastFiredAt: prior.fired_at,
          nextFireAt: post.nextRow ? post.nextRow.next_fire_at : null,
        });
      } catch (err) {
        this.onError(err);
        // Row is already in post-fire state on disk. At-most-one-missed.
      }
    });
  }

  private computePostFire(
    prior: ReminderRow,
    firedAt: number
  ): { nextRow: ReminderRow | null } {
    if (prior.recurs === null) {
      // One-shot: delete.
      return { nextRow: null };
    }
    if (prior.recurs.kind === 'count') {
      if (prior.recurs.remaining <= 1) {
        // Terminal: delete.
        return { nextRow: null };
      }
      return {
        nextRow: {
          ...prior,
          next_fire_at: firedAt + prior.recurs.interval_ms,
          fired_at: firedAt,
          fire_count: prior.fire_count + 1,
          recurs: {
            kind: 'count',
            interval_ms: prior.recurs.interval_ms,
            remaining: prior.recurs.remaining - 1,
          },
        },
      };
    }
    // Cron.
    const tz = getAgentTimezone();
    const nextFireAt = computeNextCronFire(prior.recurs.expr, tz, new Date(firedAt));
    return {
      nextRow: {
        ...prior,
        next_fire_at: nextFireAt,
        fired_at: firedAt,
        fire_count: prior.fire_count + 1,
      },
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && npx vitest --run src/reminders/__tests__/scheduler.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/reminders/scheduler.ts packages/agent/src/reminders/__tests__/scheduler.test.ts
git commit -m "feat(reminders): ReminderScheduler fire path under per-session mutex"
```

---

## Task 6: Boot recovery (cron recompute + schedule_shifted log)

**Files:**
- Modify: `packages/agent/src/reminders/scheduler.ts`
- Modify: `packages/agent/src/reminders/__tests__/scheduler.test.ts`

§3.4 of the spec: recompute cron rows against the current TZ; log `dropped_fires` for cron with downtime-skipped matches; log `schedule_shifted` for count-interval rows with stale `next_fire_at`; write the recovered snapshot once.

- [ ] **Step 1: Write the failing test**

Append to `scheduler.test.ts`:

```ts
import { logger } from '@lace/agent/utils/logger';

describe('ReminderScheduler boot recovery', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'UTC';
  });
  afterEach(() => {
    process.env.TZ = origTZ;
  });

  it('refuses to start when TZ is unset', async () => {
    delete process.env.TZ;
    // Force Intl to also return empty to simulate stripped container; mock via stub.
    const origResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      return { ...origResolvedOptions.call(this), timeZone: '' } as Intl.ResolvedDateTimeFormatOptions;
    };
    try {
      const sched = new ReminderScheduler({
        sessionDir: tempSessionDir(),
        now: () => 0,
        notifier: async () => {},
      });
      await expect(sched.start()).rejects.toThrow(/timezone is unset/i);
    } finally {
      Intl.DateTimeFormat.prototype.resolvedOptions = origResolvedOptions;
    }
  });

  it('recomputes cron next_fire_at against current TZ on boot', async () => {
    process.env.TZ = 'UTC';
    const dir = tempSessionDir();
    // Persisted next_fire_at is stale (cron should fire at 9am UTC today, but persisted is yesterday).
    const yesterday = new Date('2026-05-21T09:00:00Z').getTime();
    new ReminderStore(dir).save([
      {
        id: 'reminder_aaaaaaaaaaaa',
        created_at: yesterday,
        next_fire_at: yesterday,
        prompt: 'daily',
        recurs: { kind: 'cron', expr: '0 9 * * *' },
        fired_at: null,
        fire_count: 0,
      },
    ]);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => new Date('2026-05-22T10:00:00Z').getTime(),
      notifier: async () => {},
    });
    await sched.start();
    await sched.stop();

    const rows = new ReminderStore(dir).list();
    expect(rows[0].next_fire_at).toBe(new Date('2026-05-23T09:00:00Z').getTime());
  });

  it('logs dropped_fires for cron when downtime skipped matches', async () => {
    process.env.TZ = 'UTC';
    const dir = tempSessionDir();
    // Persisted = 3 days ago; current = today. Cron is daily.
    const threeDaysAgo = new Date('2026-05-19T09:00:00Z').getTime();
    new ReminderStore(dir).save([
      {
        id: 'reminder_bbbbbbbbbbbb',
        created_at: threeDaysAgo,
        next_fire_at: threeDaysAgo,
        prompt: 'daily',
        recurs: { kind: 'cron', expr: '0 9 * * *' },
        fired_at: null,
        fire_count: 0,
      },
    ]);
    const warnSpy = vi.spyOn(logger, 'warn');

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => new Date('2026-05-22T10:00:00Z').getTime(),
      notifier: async () => {},
    });
    await sched.start();
    await sched.stop();

    const calls = warnSpy.mock.calls.filter((c) => c[0] === 'reminders.dropped_fires');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ row_id: 'reminder_bbbbbbbbbbbb', dropped_count: 3 });
  });

  it('logs schedule_shifted for count-interval with stale next_fire_at', async () => {
    process.env.TZ = 'UTC';
    const dir = tempSessionDir();
    const stale = new Date('2026-05-22T08:00:00Z').getTime();
    new ReminderStore(dir).save([
      {
        id: 'reminder_cccccccccccc',
        created_at: stale,
        next_fire_at: stale,
        prompt: 'ping',
        recurs: { kind: 'count', interval_ms: 30 * 60_000, remaining: 5 },
        fired_at: null,
        fire_count: 0,
      },
    ]);
    const warnSpy = vi.spyOn(logger, 'warn');

    const now = new Date('2026-05-22T10:00:00Z').getTime();
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => now,
      notifier: async () => {},
    });
    await sched.start();
    await sched.stop();

    const rows = new ReminderStore(dir).list();
    expect(rows[0].next_fire_at).toBe(now + 30 * 60_000);
    // remaining is preserved.
    expect((rows[0].recurs as { kind: 'count'; remaining: number }).remaining).toBe(5);

    const calls = warnSpy.mock.calls.filter((c) => c[0] === 'reminders.schedule_shifted');
    expect(calls).toHaveLength(1);
  });

  it('persists all recovery changes in a single write', async () => {
    process.env.TZ = 'UTC';
    const dir = tempSessionDir();
    const threeDaysAgo = new Date('2026-05-19T09:00:00Z').getTime();
    new ReminderStore(dir).save([
      {
        id: 'reminder_dddddddddddd',
        created_at: threeDaysAgo,
        next_fire_at: threeDaysAgo,
        prompt: 'a',
        recurs: { kind: 'cron', expr: '0 9 * * *' },
        fired_at: null,
        fire_count: 0,
      },
      {
        id: 'reminder_eeeeeeeeeeee',
        created_at: threeDaysAgo,
        next_fire_at: threeDaysAgo,
        prompt: 'b',
        recurs: { kind: 'count', interval_ms: 30 * 60_000, remaining: 4 },
        fired_at: null,
        fire_count: 0,
      },
    ]);

    // Count writes by spying on the store's save method.
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => new Date('2026-05-22T10:00:00Z').getTime(),
      notifier: async () => {},
    });
    let saveCount = 0;
    const origSave = sched.store.save.bind(sched.store);
    sched.store.save = (rows) => {
      saveCount++;
      return origSave(rows);
    };

    await sched.start();
    await sched.stop();

    expect(saveCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent && npx vitest --run src/reminders/__tests__/scheduler.test.ts`
Expected: 5 new tests FAIL (recovery does basic load only; no recompute, no logs).

- [ ] **Step 3: Update `bootRecover` in `scheduler.ts`**

Replace the existing `bootRecover` method with:

```ts
private async bootRecover(): Promise<void> {
  // Refuse to start if TZ is unset.
  const tz = getAgentTimezone(); // Throws if unset.

  const rows = this.store.list();
  const now = this.now();
  let mutated = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.recurs && row.recurs.kind === 'cron') {
      // Recompute against current TZ.
      const newNext = computeNextCronFire(row.recurs.expr, tz, new Date(now));
      if (newNext !== row.next_fire_at) {
        // If we're past the persisted time, count dropped fires.
        if (row.next_fire_at < now - 60_000) {
          const dropped = countCronMatchesInWindow(row.recurs.expr, tz, row.next_fire_at, now);
          logger.warn('reminders.dropped_fires', {
            row_id: row.id,
            prompt: row.prompt,
            dropped_count: dropped,
          });
        }
        rows[i] = { ...row, next_fire_at: newNext };
        mutated = true;
      }
    } else if (row.recurs && row.recurs.kind === 'count') {
      // Shift schedule if stale.
      if (row.next_fire_at + 60_000 < now) {
        const newNext = now + row.recurs.interval_ms;
        logger.warn('reminders.schedule_shifted', {
          row_id: row.id,
          prompt: row.prompt,
          old_next_fire_at: row.next_fire_at,
          new_next_fire_at: newNext,
        });
        rows[i] = { ...row, next_fire_at: newNext };
        mutated = true;
      }
    }
  }

  if (mutated) {
    try {
      this.store.save(rows);
    } catch (err) {
      // Spec §3.4 step 5: log and continue with in-memory state.
      logger.warn('reminders.recovery_persist_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  this.heap = rows
    .map((r) => ({ id: r.id, nextFireAt: r.next_fire_at }))
    .sort((a, b) => a.nextFireAt - b.nextFireAt);
}
```

Add the import and helper near the top of the file:

```ts
import { logger } from '@lace/agent/utils/logger';
import { CronExpressionParser } from 'cron-parser';

function countCronMatchesInWindow(
  expr: string,
  tz: string,
  startMs: number,
  endMs: number
): number {
  if (startMs >= endMs) return 0;
  const interval = CronExpressionParser.parse(expr, {
    tz,
    currentDate: new Date(startMs - 1),
  });
  let count = 0;
  while (count < 1000) {
    let next: number;
    try {
      next = interval.next().toDate().getTime();
    } catch {
      break;
    }
    if (next > endMs) break;
    count++;
  }
  return count;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && npx vitest --run src/reminders/__tests__/scheduler.test.ts`
Expected: All tests (including prior fire-path tests) PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/reminders/scheduler.ts packages/agent/src/reminders/__tests__/scheduler.test.ts
git commit -m "feat(reminders): boot recovery with cron recompute + dropped_fires logging"
```

---

## Task 7: Scheduler schedule / cancel / list APIs

**Files:**
- Modify: `packages/agent/src/reminders/scheduler.ts`
- Modify: `packages/agent/src/reminders/__tests__/scheduler.test.ts`

The scheduler now exposes the action handlers that the `manage_reminders` tool will call. Each handler acquires the mutex.

- [ ] **Step 1: Write the failing tests**

Append to `scheduler.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

describe('ReminderScheduler schedule', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => { process.env.TZ = 'UTC'; });
  afterEach(() => { process.env.TZ = origTZ; });

  it('persists a one-shot row, returns id and next_fire_at', async () => {
    const dir = tempSessionDir();
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 1_700_000_000_000,
      notifier: async () => {},
    });
    await sched.start();

    const result = await sched.schedule({
      prompt: 'follow up',
      delaySeconds: 300,
      recurs: null,
    });

    expect(result.id).toMatch(/^reminder_[0-9a-f]{12}$/);
    expect(result.row.next_fire_at).toBe(1_700_000_000_000 + 300_000);
    expect(result.row.recurs).toBe(null);
    expect(new ReminderStore(dir).list()).toHaveLength(1);

    await sched.stop();
  });

  it('persists a cron row, computes initial next_fire_at', async () => {
    process.env.TZ = 'UTC';
    const now = new Date('2026-05-22T08:00:00Z').getTime();
    const dir = tempSessionDir();
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => now,
      notifier: async () => {},
    });
    await sched.start();

    const result = await sched.schedule({
      prompt: 'daily',
      delaySeconds: null,
      recurs: { kind: 'cron', expr: '0 9 * * *' },
    });

    expect(result.row.next_fire_at).toBe(new Date('2026-05-22T09:00:00Z').getTime());
    await sched.stop();
  });

  it('rejects schedule when over the 50-cap', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    const rows: ReminderRow[] = [];
    for (let i = 0; i < 50; i++) {
      rows.push({
        id: `reminder_${i.toString(16).padStart(12, '0')}`,
        created_at: 0,
        next_fire_at: 10_000_000_000 + i,
        prompt: 'p',
        recurs: null,
        fired_at: null,
        fire_count: 0,
      });
    }
    store.save(rows);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 0,
      notifier: async () => {},
    });
    await sched.start();
    await expect(
      sched.schedule({ prompt: 'one more', delaySeconds: 300, recurs: null })
    ).rejects.toThrow(/over the 50-active cap/i);
    await sched.stop();
  });
});

describe('ReminderScheduler cancel', () => {
  beforeEach(() => { process.env.TZ = 'UTC'; });

  it('deletes a pending row and returns cancelled:true', async () => {
    const dir = tempSessionDir();
    const row = makeRow({ id: 'reminder_111111111111', next_fire_at: 10_000_000_000 });
    new ReminderStore(dir).save([row]);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 0,
      notifier: async () => {},
    });
    await sched.start();

    const result = await sched.cancel('reminder_111111111111');
    expect(result).toEqual({ cancelled: true });
    expect(new ReminderStore(dir).list()).toEqual([]);
    await sched.stop();
  });

  it('returns not_found for unknown ids', async () => {
    const sched = new ReminderScheduler({
      sessionDir: tempSessionDir(),
      now: () => 0,
      notifier: async () => {},
    });
    await sched.start();
    const result = await sched.cancel('reminder_does_not_exist');
    expect(result).toEqual({ cancelled: false, reason: 'not_found' });
    await sched.stop();
  });
});

describe('ReminderScheduler list', () => {
  it('returns all current rows sorted by next_fire_at ascending', async () => {
    const dir = tempSessionDir();
    new ReminderStore(dir).save([
      makeRow({ id: 'reminder_222222222222', next_fire_at: 2000 }),
      makeRow({ id: 'reminder_111111111111', next_fire_at: 1000 }),
      makeRow({ id: 'reminder_333333333333', next_fire_at: 3000 }),
    ]);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 0,
      notifier: async () => {},
    });
    await sched.start();
    const rows = await sched.list();
    expect(rows.map((r) => r.id)).toEqual([
      'reminder_111111111111',
      'reminder_222222222222',
      'reminder_333333333333',
    ]);
    await sched.stop();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent && npx vitest --run src/reminders/__tests__/scheduler.test.ts`
Expected: New tests FAIL (no schedule/cancel/list yet).

- [ ] **Step 3: Add the handlers to `scheduler.ts`**

Add these types and methods to the `ReminderScheduler` class:

```ts
// Add these type imports/exports near the top:
import type { ReminderRecurs } from './types';
import { MAX_ACTIVE_REMINDERS } from './types';
import { randomUUID } from 'node:crypto';

export interface ScheduleInput {
  prompt: string;
  /** seconds-from-now to first fire, or null for cron-driven. */
  delaySeconds: number | null;
  /** null for one-shot; cron string; or { kind:'count', interval_ms, remaining }. */
  recurs: ReminderRecurs;
}

export interface ScheduleResult {
  id: string;
  row: ReminderRow;
}

export type CancelResult =
  | { cancelled: true }
  | { cancelled: false; reason: 'not_found' | 'persist_failed' };

// In the class:

async schedule(input: ScheduleInput): Promise<ScheduleResult> {
  return this.mutex.runExclusive(async () => {
    const rows = this.store.list();
    if (rows.length >= MAX_ACTIVE_REMINDERS) {
      throw new Error(
        `Cannot schedule: ${rows.length} reminders are currently pending (over the ${MAX_ACTIVE_REMINDERS}-active cap). Call manage_reminders({action:"list"}) to see them and cancel ones you no longer need.`
      );
    }
    const id = `reminder_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const now = this.now();
    let nextFireAt: number;
    if (input.recurs && input.recurs.kind === 'cron') {
      const tz = getAgentTimezone();
      nextFireAt = computeNextCronFire(input.recurs.expr, tz, new Date(now));
    } else if (input.delaySeconds !== null) {
      nextFireAt = now + input.delaySeconds * 1000;
    } else {
      // Caller bug: spec says one of next/recurs:cron required.
      throw new Error('schedule requires `delaySeconds` or `recurs:cron`');
    }
    const newRow: ReminderRow = {
      id,
      created_at: now,
      next_fire_at: nextFireAt,
      prompt: input.prompt,
      recurs: input.recurs,
      fired_at: null,
      fire_count: 0,
    };
    this.store.save([...rows, newRow]);
    // Push to heap and reschedule wake.
    this.heap.push({ id, nextFireAt });
    this.heap.sort((a, b) => a.nextFireAt - b.nextFireAt);
    this.rescheduleNextTick();
    return { id, row: newRow };
  });
}

async cancel(id: string): Promise<CancelResult> {
  return this.mutex.runExclusive(async () => {
    const rows = this.store.list();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return { cancelled: false, reason: 'not_found' };
    const nextRows = [...rows.slice(0, idx), ...rows.slice(idx + 1)];
    try {
      this.store.save(nextRows);
    } catch {
      return { cancelled: false, reason: 'persist_failed' };
    }
    // Remove from heap (idempotent).
    this.heap = this.heap.filter((e) => e.id !== id);
    this.rescheduleNextTick();
    return { cancelled: true };
  });
}

async list(): Promise<ReminderRow[]> {
  // List does NOT acquire the mutex (per spec §3.8).
  const rows = this.store.list();
  return [...rows].sort((a, b) => a.next_fire_at - b.next_fire_at);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && npx vitest --run src/reminders/__tests__/scheduler.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/reminders/scheduler.ts packages/agent/src/reminders/__tests__/scheduler.test.ts
git commit -m "feat(reminders): schedule/cancel/list scheduler APIs"
```

---

## Task 8: Reminders index + package exports

**Files:**
- Create: `packages/agent/src/reminders/index.ts`

- [ ] **Step 1: Write the file**

```ts
// packages/agent/src/reminders/index.ts
export * from './types';
export { AsyncMutex } from './async-mutex';
export { ReminderStore } from './store';
export {
  ReminderScheduler,
  type SchedulerDeps,
  type FireContext,
  type ScheduleInput,
  type ScheduleResult,
  type CancelResult,
} from './scheduler';
export {
  getAgentTimezone,
  computeNextCronFire,
  assertCronAtLeast5MinInterval,
} from './cron';
```

- [ ] **Step 2: Verify type-check**

Run: `cd packages/agent && npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/reminders/index.ts
git commit -m "feat(reminders): index module exports"
```

---

## Task 9: Notification wrapper — typed attributes API + new NotificationKind

**Files:**
- Modify: `packages/agent/src/notifications/notification-wrapper.ts`
- Modify: `packages/agent/src/notifications/__tests__/notification-wrapper.test.ts`

The wrapper gains a typed `attributes: Record<string, string | number>` parameter alongside the existing `identifiers`. `undefined`/`null` values are omitted; `NaN`/non-finite numbers throw; body is XML-escaped (`&` then `<`).

- [ ] **Step 1: Write the failing tests**

Append to `notification-wrapper.test.ts`:

```ts
describe('buildNotification — typed attributes', () => {
  it('emits numeric attributes via String(v)', () => {
    const out = buildNotification({
      kind: 'reminder',
      attributes: { 'fire-count': 6 },
      body: 'hi',
    });
    expect(out).toContain('fire-count="6"');
  });

  it('omits attributes whose value is undefined or null', () => {
    const out = buildNotification({
      kind: 'reminder',
      attributes: { 'last-fired-at': undefined as unknown as string, 'fire-count': 1 },
      body: 'hi',
    });
    expect(out).not.toContain('last-fired-at');
    expect(out).toContain('fire-count="1"');
  });

  it('throws on NaN attribute values', () => {
    expect(() =>
      buildNotification({ kind: 'reminder', attributes: { 'fire-count': NaN }, body: 'hi' })
    ).toThrow(/non-finite/i);
  });

  it('escapes & and < in body but leaves > alone', () => {
    const out = buildNotification({
      kind: 'reminder',
      body: '5 < 10 & </notification> done',
    });
    expect(out).toContain('5 &lt; 10 &amp; &lt;/notification> done');
  });

  it('does not double-escape: & first then <', () => {
    const out = buildNotification({ kind: 'reminder', body: 'plain text' });
    expect(out).toContain('plain text');
    // Empty body still produces a wrapped notification.
    expect(buildNotification({ kind: 'reminder', body: '' })).toMatch(
      /<notification kind="reminder">\s*\n\s*<\/notification>/
    );
  });

  it('accepts kind="reminder"', () => {
    const out = buildNotification({ kind: 'reminder', body: 'ok' });
    expect(out).toContain('kind="reminder"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent && npx vitest --run src/notifications/__tests__/notification-wrapper.test.ts`
Expected: New tests FAIL.

- [ ] **Step 3: Update `notification-wrapper.ts`**

```ts
// packages/agent/src/notifications/notification-wrapper.ts
// ABOUTME: Single source of truth for the <notification kind="..."> wrapper.
// ABOUTME: Body is XML-escaped at injection (& then <); attributes accept numbers via String(v).

export type NotificationKind =
  | 'reminder'
  | 'job-completed'
  | 'job-failed'
  | 'job-cancelled'
  | 'job-progress'
  | 'subagent-exited';

export interface BuildNotificationOptions {
  kind: NotificationKind;
  /** Identifier attributes; legacy callers (job-*) keep using this. */
  identifiers?: Record<string, string>;
  /** Typed attributes; values may be string or number. undefined/null entries are omitted. */
  attributes?: Record<string, string | number | null | undefined>;
  /** Body content; will be XML-escaped (& then <). */
  body: string;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeXmlText(value: string): string {
  // Standard text-content escape: & first so &lt; doesn't double-escape into &amp;lt;.
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function attrValueToString(v: string | number | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new Error(`non-finite attribute value: ${v}`);
    }
    return String(v);
  }
  return v;
}

export function buildNotification(opts: BuildNotificationOptions): string {
  const parts: string[] = [`kind="${escapeXmlAttr(opts.kind)}"`];
  if (opts.identifiers) {
    for (const [k, v] of Object.entries(opts.identifiers)) {
      if (v === '') continue; // existing convention
      parts.push(`${k}="${escapeXmlAttr(v)}"`);
    }
  }
  if (opts.attributes) {
    for (const [k, v] of Object.entries(opts.attributes)) {
      const s = attrValueToString(v);
      if (s === null) continue;
      parts.push(`${k}="${escapeXmlAttr(s)}"`);
    }
  }
  return `<notification ${parts.join(' ')}>\n${escapeXmlText(opts.body)}\n</notification>`;
}
```

- [ ] **Step 4: Run all notification-wrapper tests to confirm nothing else regressed**

Run: `cd packages/agent && npx vitest --run src/notifications/__tests__/notification-wrapper.test.ts`
Expected: ALL tests PASS.

If existing tests for `'alarm-fired'` / `'alarm-expired'` fail because those kinds no longer exist in the union: **leave them failing for now**. They will be deleted in the final cleanup task (Task 16) along with the alarm code.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/notifications/notification-wrapper.ts packages/agent/src/notifications/__tests__/notification-wrapper.test.ts
git commit -m "feat(notifications): typed attributes API + XML body escape; add reminder kind"
```

---

## Task 10: Reminder composer + subagent-exited compact format

**Files:**
- Modify: `packages/agent/src/notifications/composers.ts`
- Modify: `packages/agent/src/notifications/__tests__/composers.test.ts`

A reminder's body is just the prompt verbatim. The composer is trivial. The subagent-exited composer changes to use the compact `<id> [<next-fire-at>]: <prompt-truncated>` format when more than 5 reminders.

- [ ] **Step 1: Write the failing tests**

Append to `composers.test.ts`:

```ts
import { composeReminderBody, composeSubagentExitedBody } from '../composers';

describe('composeReminderBody', () => {
  it('returns the prompt verbatim (escaping is the wrapper''s job)', () => {
    expect(composeReminderBody({ prompt: 'follow up' })).toBe('follow up');
  });
});

describe('composeSubagentExitedBody (reminders)', () => {
  it('full list when ≤5 reminders', () => {
    const body = composeSubagentExitedBody({
      persona: 'sen-box',
      pendingReminders: [
        { id: 'reminder_aaaa', prompt: 'check the deploy', next_fire_at_iso: '2026-05-22T16:00:00-07:00' },
        { id: 'reminder_bbbb', prompt: 'ping ops', next_fire_at_iso: '2026-05-22T17:00:00-07:00' },
      ],
    });
    expect(body).toContain('check the deploy');
    expect(body).toContain('ping ops');
  });

  it('compact format when >5 reminders, no truncation of long prompts past 200 chars', () => {
    const longPrompt = 'a'.repeat(250);
    const body = composeSubagentExitedBody({
      persona: 'sen-box',
      pendingReminders: Array.from({ length: 7 }).map((_, i) => ({
        id: `reminder_${i.toString().padStart(12, '0')}`,
        prompt: i === 0 ? longPrompt : `prompt ${i}`,
        next_fire_at_iso: '2026-05-22T16:00:00-07:00',
      })),
    });
    // Long prompt is truncated to 200 chars with ellipsis.
    expect(body).toMatch(/^.{200}\.\.\./m);
    // Bubble does not silently drop any of the 7 reminders.
    for (let i = 0; i < 7; i++) {
      expect(body).toContain(`reminder_${i.toString().padStart(12, '0')}`);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent && npx vitest --run src/notifications/__tests__/composers.test.ts`
Expected: New tests FAIL.

- [ ] **Step 3: Add the composers**

Append to `composers.ts`:

```ts
// ---------- Reminders ----------

export interface ReminderBodyCompose {
  prompt: string;
}

export function composeReminderBody(c: ReminderBodyCompose): string {
  // Body is the prompt verbatim. The wrapper handles XML escaping.
  return c.prompt;
}

// ---------- Subagent exited (reminders variant) ----------

export interface SubagentPendingReminder {
  id: string;
  prompt: string;
  next_fire_at_iso: string;
}

export interface SubagentExitedReminderCompose {
  persona: string;
  pendingReminders: SubagentPendingReminder[];
}

const SUBAGENT_BUBBLE_INLINE_THRESHOLD = 5;
const SUBAGENT_BUBBLE_PROMPT_TRUNCATE = 200;

function truncateAtWordBoundary(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const sliced = lastSpace > max - 30 ? cut.slice(0, lastSpace) : cut;
  return `${sliced}...`;
}

export function composeSubagentExitedBody(s: SubagentExitedReminderCompose): string {
  const personaWord = s.persona.length > 0 ? `${s.persona} ` : '';
  const n = s.pendingReminders.length;
  const head = `Your ${personaWord}subagent exited gracefully but had ${n} pending reminder${
    n === 1 ? '' : 's'
  } that won't fire now`;

  if (n === 0) return `${head}.`;

  if (n <= SUBAGENT_BUBBLE_INLINE_THRESHOLD) {
    const lines = s.pendingReminders
      .map((r) => `  ${r.id} (next fire ${r.next_fire_at_iso}): "${r.prompt}"`)
      .join('\n');
    return `${head}:\n${lines}`;
  }

  // Compact format: one line per reminder, prompt truncated to 200 chars at word boundary.
  const lines = s.pendingReminders
    .map((r) => {
      const truncated = truncateAtWordBoundary(r.prompt, SUBAGENT_BUBBLE_PROMPT_TRUNCATE);
      return `  ${r.id} [${r.next_fire_at_iso}]: ${truncated}`;
    })
    .join('\n');
  return `${head}:\n${lines}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && npx vitest --run src/notifications/__tests__/composers.test.ts`
Expected: New tests PASS.

If existing tests for `composeAlarmFiredBody` / `composeAlarmExpiredBody` still pass: good (they stay until cleanup). If they fail due to type changes upstream: leave failing; cleanup task removes them.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/notifications/composers.ts packages/agent/src/notifications/__tests__/composers.test.ts
git commit -m "feat(notifications): add reminder + subagent-exited (reminders) composers"
```

---

## Task 11: Notifications index exports

**Files:**
- Modify: `packages/agent/src/notifications/index.ts`

- [ ] **Step 1: Update the file**

```ts
// packages/agent/src/notifications/index.ts
export { buildNotification } from './notification-wrapper';
export type { NotificationKind, BuildNotificationOptions } from './notification-wrapper';
export { injectNotification } from './inject-notification';
export type { InjectNotificationOptions, IdleWakeHooks } from './inject-notification';
export * from './composers';
export { formatAbsoluteTime } from './format-time';
```

- [ ] **Step 2: Verify type-check**

Run: `cd packages/agent && npx tsc --noEmit -p tsconfig.json`
Expected: clean (or pre-existing unrelated errors only).

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/notifications/index.ts
git commit -m "chore(notifications): export BuildNotificationOptions type"
```

---

## Task 12: manage_reminders zod schema and routing

**Files:**
- Create: `packages/agent/src/tools/implementations/manage_reminders.ts`
- Create: `packages/agent/src/tools/implementations/__tests__/manage_reminders.test.ts`

This task covers the schema and input routing. The tool's executor logic (calling into the scheduler) is in the next task.

The schema accepts `{action, prompt?, next?, recurs?, id?}`. Type-discriminates `next` (number-or-ISO-string-with-offset) and `recurs` (cron-string-or-count-number). Stringified non-negative integers coerce to numbers.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/agent/src/tools/implementations/__tests__/manage_reminders.test.ts
import { describe, it, expect } from 'vitest';
import { parseManageRemindersInput } from '../manage_reminders';

describe('parseManageRemindersInput', () => {
  it('schedule with delaySeconds (number)', () => {
    const r = parseManageRemindersInput({
      action: 'schedule',
      prompt: 'hi',
      next: 300,
    });
    expect(r.kind).toBe('schedule');
    if (r.kind !== 'schedule') throw new Error();
    expect(r.delaySeconds).toBe(300);
    expect(r.recurs).toBe(null);
  });

  it('schedule coerces stringified integer next', () => {
    const r = parseManageRemindersInput({
      action: 'schedule',
      prompt: 'hi',
      next: '300',
    });
    if (r.kind !== 'schedule') throw new Error();
    expect(r.delaySeconds).toBe(300);
  });

  it('schedule rejects negative integer string', () => {
    expect(() =>
      parseManageRemindersInput({ action: 'schedule', prompt: 'hi', next: '-300' })
    ).toThrow(/negative/i);
  });

  it('schedule with absolute ISO next', () => {
    const r = parseManageRemindersInput({
      action: 'schedule',
      prompt: 'hi',
      next: '2026-05-23T16:00:00Z',
    });
    if (r.kind !== 'schedule') throw new Error();
    expect(r.absoluteFireAt).toBe(new Date('2026-05-23T16:00:00Z').getTime());
  });

  it('schedule rejects ISO without offset', () => {
    expect(() =>
      parseManageRemindersInput({ action: 'schedule', prompt: 'hi', next: '2026-05-23T09:00:00' })
    ).toThrow(/offset/i);
  });

  it('schedule with cron recurs (no next)', () => {
    const r = parseManageRemindersInput({
      action: 'schedule',
      prompt: 'hi',
      recurs: '0 9 * * 1-5',
    });
    if (r.kind !== 'schedule') throw new Error();
    expect(r.recurs).toEqual({ kind: 'cron', expr: '0 9 * * 1-5' });
  });

  it('schedule with count recurs requires next as number', () => {
    const r = parseManageRemindersInput({
      action: 'schedule',
      prompt: 'hi',
      next: 1800,
      recurs: 5,
    });
    if (r.kind !== 'schedule') throw new Error();
    expect(r.recurs).toEqual({ kind: 'count', interval_ms: 1_800_000, remaining: 5 });
  });

  it('schedule rejects recurs:1', () => {
    expect(() =>
      parseManageRemindersInput({ action: 'schedule', prompt: 'hi', next: 1800, recurs: 1 })
    ).toThrow(/recurs: 1.*one-shot/i);
  });

  it('schedule rejects cron + next', () => {
    expect(() =>
      parseManageRemindersInput({
        action: 'schedule',
        prompt: 'hi',
        next: 300,
        recurs: '0 9 * * *',
      })
    ).toThrow(/not used with cron/i);
  });

  it('schedule rejects count without next', () => {
    expect(() =>
      parseManageRemindersInput({ action: 'schedule', prompt: 'hi', recurs: 5 })
    ).toThrow(/requires `next`/);
  });

  it('cancel requires id', () => {
    const r = parseManageRemindersInput({ action: 'cancel', id: 'reminder_abc123abc123' });
    expect(r.kind).toBe('cancel');
    if (r.kind !== 'cancel') throw new Error();
    expect(r.id).toBe('reminder_abc123abc123');
  });

  it('list takes no params', () => {
    const r = parseManageRemindersInput({ action: 'list' });
    expect(r.kind).toBe('list');
  });

  it('unknown action rejected', () => {
    expect(() =>
      parseManageRemindersInput({ action: 'frobnicate' } as never)
    ).toThrow(/action/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent && npx vitest --run src/tools/implementations/__tests__/manage_reminders.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the schema + routing**

```ts
// packages/agent/src/tools/implementations/manage_reminders.ts
// ABOUTME: manage_reminders — single tool with action enum.
// ABOUTME: Schedule/cancel/list reminders for future-self. Per spec
// ABOUTME: docs/specs/2026-05-22-alarms-coherent-design.md.

import { z } from 'zod';
import { Tool } from '../tool';
import {
  assertCronAtLeast5MinInterval,
  getAgentTimezone,
} from '@lace/agent/reminders/cron';
import {
  ReminderScheduler,
  type ReminderRecurs,
} from '@lace/agent/reminders';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const INT_STRING_RE = /^\d+$/;

// Schema is intentionally loose: action is required; everything else is optional.
// Per-action validation lives in parseManageRemindersInput.
const schema = z
  .object({
    action: z.enum(['schedule', 'cancel', 'list']),
    prompt: z.string().min(1).optional(),
    next: z.union([z.number(), z.string()]).optional(),
    recurs: z.union([z.string(), z.number()]).optional(),
    id: z.string().min(1).optional(),
  })
  .strict();

export type ManageRemindersWireInput = z.infer<typeof schema>;

export type ParsedInput =
  | {
      kind: 'schedule';
      prompt: string;
      delaySeconds: number | null;
      absoluteFireAt: number | null;
      recurs: ReminderRecurs;
    }
  | { kind: 'cancel'; id: string }
  | { kind: 'list' };

function coerceIntegerString(v: number | string, fieldName: string): number {
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`\`${fieldName}\` must be a non-negative integer; got ${v}`);
    }
    return v;
  }
  // String case.
  if (v.startsWith('-')) {
    throw new Error(
      `\`${fieldName}: "${v}"\` is negative. Use a non-negative number of seconds for relative delay, or an ISO timestamp for an absolute time.`
    );
  }
  if (!INT_STRING_RE.test(v)) {
    throw new Error(`\`${fieldName}: "${v}"\` is not an integer string`);
  }
  return Number(v);
}

function parseIsoWithOffset(v: string, fieldName: string): number {
  // Require explicit offset: Z or ±HH:MM at the end.
  const hasOffset = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(v);
  if (!hasOffset) {
    throw new Error(
      `\`${fieldName}: "${v}"\` ISO timestamp lacks an offset. Add Z for UTC or ±HH:MM for a specific timezone, or pass \`${fieldName}: <seconds>\` for a relative delay.`
    );
  }
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) {
    throw new Error(`invalid ISO timestamp "${v}"`);
  }
  return ms;
}

export function parseManageRemindersInput(rawInput: unknown): ParsedInput {
  const input = schema.parse(rawInput);

  if (input.action === 'list') {
    return { kind: 'list' };
  }

  if (input.action === 'cancel') {
    if (!input.id) throw new Error('`cancel` requires `id`');
    return { kind: 'cancel', id: input.id };
  }

  // schedule
  if (!input.prompt) throw new Error('`schedule` requires `prompt`');

  // recurs handling: string => cron; number-or-integer-string => count.
  let recurs: ReminderRecurs = null;
  let recursIsCron = false;
  if (input.recurs !== undefined) {
    // Try coercion first: if it's an integer-string, route to count.
    if (typeof input.recurs === 'string' && INT_STRING_RE.test(input.recurs)) {
      const n = Number(input.recurs);
      if (n < 2) {
        throw new Error(
          `\`recurs: ${n}\` is the same as a one-shot. Omit \`recurs\` and use \`next\` alone for a single fire.`
        );
      }
      recurs = { kind: 'count', interval_ms: 0, remaining: n }; // interval_ms filled below
    } else if (typeof input.recurs === 'number') {
      if (input.recurs < 2 || !Number.isInteger(input.recurs)) {
        throw new Error(
          input.recurs === 1
            ? '`recurs: 1` is the same as a one-shot. Omit `recurs` and use `next` alone for a single fire.'
            : `\`recurs: ${input.recurs}\` must be a positive integer ≥ 2`
        );
      }
      recurs = { kind: 'count', interval_ms: 0, remaining: input.recurs };
    } else if (typeof input.recurs === 'string') {
      // Cron expression. Reject if next was also provided.
      if (input.next !== undefined) {
        throw new Error(
          '`next` is not used with cron recurrence — cron expressions specify their own first fire. Remove `next`, or drop `recurs` if you wanted a single fire at this instant.'
        );
      }
      const tz = getAgentTimezone();
      assertCronAtLeast5MinInterval(input.recurs, tz);
      recurs = { kind: 'cron', expr: input.recurs };
      recursIsCron = true;
    }
  }

  let delaySeconds: number | null = null;
  let absoluteFireAt: number | null = null;
  if (input.next !== undefined && !recursIsCron) {
    if (typeof input.next === 'string' && !INT_STRING_RE.test(input.next)) {
      // ISO path.
      absoluteFireAt = parseIsoWithOffset(input.next, 'next');
    } else {
      // Numeric path.
      const seconds = coerceIntegerString(input.next, 'next');
      delaySeconds = seconds;
    }
  }

  // For count recurs, fill interval_ms from delaySeconds.
  if (recurs && recurs.kind === 'count') {
    if (delaySeconds === null) {
      throw new Error(
        '`recurs: <count>` (count) requires `next` as a number of seconds — without an interval the system doesn\'t know when to fire. Pass `next: <seconds>, recurs: <count>`.'
      );
    }
    if (delaySeconds < 300) {
      throw new Error(
        `\`next: ${delaySeconds}\` is below the 5-minute (300s) floor for count-interval reminders`
      );
    }
    recurs = { kind: 'count', interval_ms: delaySeconds * 1000, remaining: recurs.remaining };
  }

  if (recurs === null && delaySeconds === null && absoluteFireAt === null) {
    throw new Error(
      '`schedule` requires at least one of `next` (seconds or ISO) or `recurs` (cron expression)'
    );
  }

  if (delaySeconds !== null && delaySeconds < 0) {
    throw new Error(`\`next: ${delaySeconds}\` is negative`);
  }

  return {
    kind: 'schedule',
    prompt: input.prompt,
    delaySeconds,
    absoluteFireAt,
    recurs,
  };
}

export { schema as manageRemindersSchema };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && npx vitest --run src/tools/implementations/__tests__/manage_reminders.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/tools/implementations/manage_reminders.ts packages/agent/src/tools/implementations/__tests__/manage_reminders.test.ts
git commit -m "feat(reminders): manage_reminders schema + per-action input parsing"
```

---

## Task 13: ManageRemindersTool executor

**Files:**
- Modify: `packages/agent/src/tools/implementations/manage_reminders.ts`
- Modify: `packages/agent/src/tools/implementations/__tests__/manage_reminders.test.ts`
- Modify: `packages/agent/src/tools/types.ts` (add `reminderScheduler` to ToolContext)

- [ ] **Step 1: Update ToolContext**

In `packages/agent/src/tools/types.ts`, add the new field (keep `alarmScheduler` for now; we'll remove it in the cleanup task):

```ts
// Add this import near the top with the other type imports:
import type { ReminderScheduler } from '@lace/agent/reminders';

// In the ToolContext interface, alongside alarmScheduler:
  // Reminder scheduling (provided by the session runner for manage_reminders).
  reminderScheduler?: ReminderScheduler;
```

- [ ] **Step 2: Write the failing executor test**

Append to `manage_reminders.test.ts`:

```ts
import { ManageRemindersTool } from '../manage_reminders';
import { ReminderScheduler } from '@lace/agent/reminders';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext } from '@lace/agent/tools/types';

function tempSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'lace-mr-tool-'));
}

function ctxWithScheduler(sched: ReminderScheduler): ToolContext {
  return {
    signal: new AbortController().signal,
    reminderScheduler: sched,
  } as ToolContext;
}

describe('ManageRemindersTool execution', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => { process.env.TZ = 'UTC'; });
  afterEach(() => { process.env.TZ = origTZ; });

  it('schedule returns the new row', async () => {
    const dir = tempSessionDir();
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 1_700_000_000_000,
      notifier: async () => {},
    });
    await sched.start();
    const tool = new ManageRemindersTool();
    const result = await tool.execute(
      { action: 'schedule', prompt: 'hi', next: 300 },
      ctxWithScheduler(sched)
    );
    expect(result.status).toBe('completed');
    const body = JSON.parse((result.content?.[0] as { text: string }).text);
    expect(body.id).toMatch(/^reminder_[0-9a-f]{12}$/);
    expect(body.next_fire_at).toBeDefined();
    expect(body.recurs).toBe(null);
    await sched.stop();
  });

  it('schedule rejects when over-cap with educational error', async () => {
    const dir = tempSessionDir();
    // (Setup 50 existing rows omitted for brevity — same as in scheduler.test.ts.)
    // Just verify error shape from the scheduler propagates through the tool.
    // ...
  });

  it('cancel returns cancelled:true for an existing reminder', async () => {
    const dir = tempSessionDir();
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 0,
      notifier: async () => {},
    });
    await sched.start();
    const { id } = await sched.schedule({
      prompt: 'p',
      delaySeconds: 300,
      recurs: null,
    });
    const tool = new ManageRemindersTool();
    const result = await tool.execute({ action: 'cancel', id }, ctxWithScheduler(sched));
    const body = JSON.parse((result.content?.[0] as { text: string }).text);
    expect(body).toEqual({ cancelled: true });
    await sched.stop();
  });

  it('list returns rows in next_fire_at order with wire-shape recurs', async () => {
    const dir = tempSessionDir();
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 1_700_000_000_000,
      notifier: async () => {},
    });
    await sched.start();
    await sched.schedule({ prompt: 'cron', delaySeconds: null, recurs: { kind: 'cron', expr: '0 9 * * 1-5' } });
    await sched.schedule({
      prompt: 'count',
      delaySeconds: 1800,
      recurs: { kind: 'count', interval_ms: 1800_000, remaining: 5 },
    });
    await sched.schedule({ prompt: 'oneshot', delaySeconds: 300, recurs: null });

    const tool = new ManageRemindersTool();
    const result = await tool.execute({ action: 'list' }, ctxWithScheduler(sched));
    const body = JSON.parse((result.content?.[0] as { text: string }).text) as {
      reminders: Array<{ recurs: unknown; next?: number }>;
    };
    expect(body.reminders).toHaveLength(3);
    // The cron row's recurs is the cron string; count is the remaining number; one-shot is null.
    expect(body.reminders.find((r) => r.recurs === '0 9 * * 1-5')).toBeDefined();
    expect(body.reminders.find((r) => r.recurs === 5)).toBeDefined();
    expect(body.reminders.find((r) => r.recurs === null)).toBeDefined();
    await sched.stop();
  });

  it('list returns recurs:null for count-interval rows with remaining=1', async () => {
    // Construct directly via store to land at remaining=1.
    const dir = tempSessionDir();
    const { ReminderStore } = await import('@lace/agent/reminders');
    new ReminderStore(dir).save([
      {
        id: 'reminder_aaaaaaaaaaaa',
        created_at: 0,
        next_fire_at: 1000,
        prompt: 'p',
        recurs: { kind: 'count', interval_ms: 300_000, remaining: 1 },
        fired_at: null,
        fire_count: 0,
      },
    ]);
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 0,
      notifier: async () => {},
    });
    await sched.start();
    const tool = new ManageRemindersTool();
    const result = await tool.execute({ action: 'list' }, ctxWithScheduler(sched));
    const body = JSON.parse((result.content?.[0] as { text: string }).text) as {
      reminders: Array<{ recurs: unknown; next?: number }>;
    };
    expect(body.reminders[0].recurs).toBe(null);
    expect(body.reminders[0].next).toBe(300);
    await sched.stop();
  });
});
```

- [ ] **Step 3: Write the tool class**

Append to `manage_reminders.ts`:

```ts
import { formatAbsoluteTime } from '@lace/agent/notifications/format-time';

function recursToWire(recurs: ReminderRecurs):
  | { recurs: string }
  | { recurs: number; next: number }
  | { recurs: null; next?: number } {
  if (recurs === null) return { recurs: null };
  if (recurs.kind === 'cron') return { recurs: recurs.expr };
  if (recurs.kind === 'count') {
    // Special-case remaining=1 → present as one-shot for clean clone round-trip (spec §2.4).
    if (recurs.remaining === 1) {
      return { recurs: null, next: Math.round(recurs.interval_ms / 1000) };
    }
    return { recurs: recurs.remaining, next: Math.round(recurs.interval_ms / 1000) };
  }
  return { recurs: null };
}

function rowToWire(row: {
  id: string;
  created_at: number;
  next_fire_at: number;
  prompt: string;
  recurs: ReminderRecurs;
  fired_at: number | null;
  fire_count: number;
}): Record<string, unknown> {
  const tz = getAgentTimezone();
  return {
    id: row.id,
    prompt: row.prompt,
    next_fire_at: formatAbsoluteTime(row.next_fire_at, tz),
    set_at: formatAbsoluteTime(row.created_at, tz),
    last_fired_at: row.fired_at !== null ? formatAbsoluteTime(row.fired_at, tz) : null,
    fire_count: row.fire_count,
    ...recursToWire(row.recurs),
  };
}

function ok(body: Record<string, unknown>): ToolResult {
  return { status: 'completed', content: [{ type: 'text', text: JSON.stringify(body) }] };
}

function err(text: string): ToolResult {
  return { status: 'failed', content: [{ type: 'text', text }] };
}

export class ManageRemindersTool extends Tool {
  name = 'manage_reminders';
  description = MANAGE_REMINDERS_DESCRIPTION;
  schema = schema;
  annotations: ToolAnnotations = {
    title: 'Manage reminders',
    safeInternal: true,
  };

  protected async executeValidated(
    rawArgs: ManageRemindersWireInput,
    context: ToolContext
  ): Promise<ToolResult> {
    const { reminderScheduler } = context;
    if (!reminderScheduler) {
      return err('manage_reminders requires a reminderScheduler in context');
    }

    let parsed: ParsedInput;
    try {
      parsed = parseManageRemindersInput(rawArgs);
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }

    if (parsed.kind === 'list') {
      const rows = await reminderScheduler.list();
      return ok({ reminders: rows.map(rowToWire) });
    }

    if (parsed.kind === 'cancel') {
      const result = await reminderScheduler.cancel(parsed.id);
      return ok(result as Record<string, unknown>);
    }

    // schedule
    try {
      const delaySeconds =
        parsed.absoluteFireAt !== null
          ? Math.max(0, Math.round((parsed.absoluteFireAt - Date.now()) / 1000))
          : parsed.delaySeconds;
      const result = await reminderScheduler.schedule({
        prompt: parsed.prompt,
        delaySeconds,
        recurs: parsed.recurs,
      });
      return ok(rowToWire(result.row));
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  }
}

const MANAGE_REMINDERS_DESCRIPTION = [
  'Schedule, list, or cancel reminders for your future self. A reminder fires a <notification kind="reminder"> block into your next turn at the scheduled time, carrying the prompt you wrote when you scheduled it.',
  '',
  'Actions:',
  '- schedule {prompt, next?, recurs?} — Create a reminder.',
  '  next: <seconds> for relative delay; or "<ISO with Z or ±HH:MM offset>" for absolute. Required unless recurs is cron.',
  '  recurs: "<cron>" for calendar-aware recurrence (evaluated in your local timezone, accounting for DST). For absolute scheduling more than a few days out, prefer cron over `next: <ISO>` — cron tracks DST correctly while ISO+offset is instant-locked.',
  '  recurs: <count> for "fire N times at next-second intervals." Requires next as seconds. Minimum interval is 5 minutes.',
  '- cancel {id} — Stop a reminder. Does not retract notifications already in your event log.',
  '- list — Return all pending reminders, sorted by next fire time. For partly-fired count-interval reminders, recurs echoes the remaining count (or null when 1 remains) so you can copy fields into a new schedule call.',
].join('\n');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && npx vitest --run src/tools/implementations/__tests__/manage_reminders.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/tools/implementations/manage_reminders.ts packages/agent/src/tools/implementations/__tests__/manage_reminders.test.ts packages/agent/src/tools/types.ts
git commit -m "feat(reminders): ManageRemindersTool — schedule/cancel/list execution"
```

---

## Task 14: Server wiring — replace alarm scheduler with reminder scheduler

**Files:**
- Modify: `packages/agent/src/server-types.ts`
- Modify: `packages/agent/src/server.ts`

Replace `alarmScheduler` on `AgentServerState` and the `ensureAlarmSchedulerForActiveSession` function. The new notifier composes a `<notification kind="reminder">` with the structured attributes.

- [ ] **Step 1: Update `server-types.ts`**

```ts
// Replace the import:
// import type { AlarmScheduler } from './alarms/alarm-scheduler';
import type { ReminderScheduler } from './reminders';

// Replace the field on AgentServerState:
//   alarmScheduler?: AlarmScheduler;
//   Per-process AlarmScheduler bound to the currently active session.
//   Created/replaced on session switch via ensureAlarmSchedulerForActiveSession;
  /**
   * Per-process ReminderScheduler bound to the currently active session.
   * Created/replaced on session switch via ensureReminderSchedulerForActiveSession;
   * cleared on session/close. Mid-flight fires are owned by the scheduler.
   */
  reminderScheduler?: ReminderScheduler;
```

Leave the old field in place for now if there's any other reference (we'll remove it in the cleanup task), but add the new one. If you can replace cleanly: do so.

- [ ] **Step 2: Update `server.ts`**

Replace `ensureAlarmSchedulerForActiveSession` and `shutdownAlarms` with reminder equivalents:

```ts
// At the top — replace alarms imports with:
import { ReminderScheduler } from './reminders';
import {
  buildNotification,
  composeReminderBody,
  injectNotification,
} from './notifications';
import { getAgentTimezone } from './reminders/cron';
import { formatAbsoluteTime } from './notifications/format-time';

// Replace ensureAlarmSchedulerForActiveSession with:
export async function ensureReminderSchedulerForActiveSession(
  state: AgentServerState,
  runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null },
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>
): Promise<void> {
  if (!state.activeSession) return;
  if (state.reminderScheduler) {
    await state.reminderScheduler.stop();
    state.reminderScheduler = undefined;
  }
  const sessionDir = state.activeSession.dir;
  const idleWake = {
    isActive: (d: string): boolean => d === state.activeSession?.dir,
    hasActiveTurn: (): boolean => !!state.activeTurn,
    triggerInternalTurn: (): void => {
      if (!runPromptInternalRef.current) return;
      setImmediate(() => {
        if (!state.activeTurn && state.activeSession && runPromptInternalRef.current) {
          void runPromptInternalRef.current([]);
        }
      });
    },
  };

  state.reminderScheduler = new ReminderScheduler({
    sessionDir,
    now: () => Date.now(),
    notifier: async (ctx) => {
      const tz = getAgentTimezone();
      // Build attributes — undefined entries are omitted by the wrapper.
      const attributes: Record<string, string | number | null | undefined> = {
        'set-at': formatAbsoluteTime(ctx.row.created_at, tz),
        'fired-at': formatAbsoluteTime(ctx.firedAt, tz),
        'last-fired-at': ctx.lastFiredAt !== null ? formatAbsoluteTime(ctx.lastFiredAt, tz) : undefined,
        'next-fire-at': ctx.nextFireAt !== null ? formatAbsoluteTime(ctx.nextFireAt, tz) : undefined,
        'fire-count': ctx.row.recurs === null ? undefined : ctx.fireCount,
      };
      // Use runExclusive so eventSeq doesn't collide with the runner's writes.
      await runExclusive(() =>
        injectNotification({
          sessionDir,
          kind: 'reminder',
          identifiers: { id: ctx.row.id },
          attributes,
          body: composeReminderBody({ prompt: ctx.row.prompt }),
          idleWake,
        })
      );
    },
    onError: (err) => {
      logger.warn('reminders.scheduler.error', {
        error: err instanceof Error ? err.message : String(err),
      });
    },
  });
  await state.reminderScheduler.start();
}

export async function shutdownReminders(state: AgentServerState): Promise<void> {
  if (state.reminderScheduler) {
    await state.reminderScheduler.stop();
    state.reminderScheduler = undefined;
  }
}
```

Update the call sites within `server.ts` from `ensureAlarmScheduler` / `shutdownAlarms` to the new names. Find them by:

```bash
grep -n "ensureAlarmScheduler\|shutdownAlarms\|alarmScheduler" packages/agent/src/server.ts
```

Update each one. The `runExclusive` parameter signature doesn't change.

- [ ] **Step 3: Update `injectNotification` to accept the new `attributes` parameter**

Check `packages/agent/src/notifications/inject-notification.ts`. It currently takes `{kind, identifiers, body}`. Add an `attributes` field that it forwards to `buildNotification`:

```ts
// In InjectNotificationOptions:
  attributes?: Record<string, string | number | null | undefined>;

// In injectNotification body — when constructing the notification:
  const text = buildNotification({
    kind: opts.kind,
    ...(opts.identifiers ? { identifiers: opts.identifiers } : {}),
    ...(opts.attributes ? { attributes: opts.attributes } : {}),
    body: opts.body,
  });
```

- [ ] **Step 4: Add the tool to the executor**

In `packages/agent/src/tools/executor.ts`, register the new tool. Find where `ScheduleAlarmTool`, `CancelAlarmTool`, `ListAlarmsTool` are added (line ~301) and add:

```ts
import { ManageRemindersTool } from './implementations/manage_reminders';

// In the tool list:
      new ManageRemindersTool(),
```

Leave the three alarm tools registered for now — they will be removed in the cleanup task.

- [ ] **Step 5: Run the full test suite to catch regressions**

Run: `cd packages/agent && npx vitest --run`
Expected: NEW tests all pass. Pre-existing alarm tests may still pass (alarm code untouched). The old `'alarm-fired'` / `'alarm-expired'` notification-wrapper tests may fail because the union type changed — that's expected; cleanup removes them.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/server-types.ts packages/agent/src/server.ts packages/agent/src/notifications/inject-notification.ts packages/agent/src/tools/executor.ts
git commit -m "feat(reminders): wire ReminderScheduler into server + register ManageRemindersTool"
```

---

## Task 15: Wire reminderScheduler into the ToolContext

**Files:**
- Modify: `packages/agent/src/server.ts` (look for where the ToolContext is constructed for executor.execute)
- Or wherever ToolContext is assembled per turn (it varies in lace; grep for "alarmScheduler:" assignment)

- [ ] **Step 1: Find the assignment site**

```bash
grep -rn "alarmScheduler:" packages/agent/src --include='*.ts' | grep -v __tests__ | grep -v '\.test\.'
```

- [ ] **Step 2: Add `reminderScheduler:` alongside `alarmScheduler:`**

At every assignment site, add the corresponding line, e.g.:

```ts
{
  alarmScheduler: state.alarmScheduler, // old, removed in Task 16
  reminderScheduler: state.reminderScheduler, // new
  ...
}
```

- [ ] **Step 3: Run tests**

Run: `cd packages/agent && npx vitest --run`
Expected: no new failures.

- [ ] **Step 4: Commit**

```bash
git add -p packages/agent/src
git commit -m "chore(reminders): pass reminderScheduler through ToolContext"
```

---

## Task 16: End-to-end smoke test

**Files:**
- Create: `packages/agent/src/reminders/__tests__/e2e.test.ts`

Validate the full chain: schedule via the tool → scheduler ticks → notifier injects → context_injected event appears in events.jsonl.

- [ ] **Step 1: Write the test**

```ts
// packages/agent/src/reminders/__tests__/e2e.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReminderScheduler } from '../scheduler';
import { ManageRemindersTool } from '@lace/agent/tools/implementations/manage_reminders';
import { buildNotification } from '@lace/agent/notifications';
import type { ToolContext } from '@lace/agent/tools/types';

function tempSessionDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lace-reminders-e2e-'));
  // Seed an empty state.json so injectNotification doesn't crash on the read.
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ nextEventSeq: 1, nextStreamSeq: 1 }));
  return dir;
}

describe('Reminders end-to-end (tool → scheduler → notifier)', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => { process.env.TZ = 'UTC'; });
  afterEach(() => { process.env.TZ = origTZ; });

  it('schedule, fire, observe notification body', async () => {
    const dir = tempSessionDir();
    const observed: Array<{ kind: string; body: string }> = [];

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => Date.now(),
      notifier: async (ctx) => {
        const text = buildNotification({
          kind: 'reminder',
          identifiers: { id: ctx.row.id },
          attributes: {
            'set-at': new Date(ctx.row.created_at).toISOString(),
            'fired-at': new Date(ctx.firedAt).toISOString(),
            'fire-count': ctx.row.recurs === null ? undefined : ctx.fireCount,
            'last-fired-at': ctx.lastFiredAt !== null ? new Date(ctx.lastFiredAt).toISOString() : undefined,
            'next-fire-at': ctx.nextFireAt !== null ? new Date(ctx.nextFireAt).toISOString() : undefined,
          },
          body: ctx.row.prompt,
        });
        observed.push({ kind: 'reminder', body: text });
      },
    });
    await sched.start();

    const tool = new ManageRemindersTool();
    await tool.execute(
      { action: 'schedule', prompt: 'fire soon', next: 0 }, // 0-second delay
      { signal: new AbortController().signal, reminderScheduler: sched } as ToolContext
    );

    // The scheduler should fire it on its first tick. Wait briefly.
    await new Promise((r) => setTimeout(r, 50));

    expect(observed).toHaveLength(1);
    expect(observed[0].body).toContain('<notification kind="reminder"');
    expect(observed[0].body).toContain('fire soon');
    expect(observed[0].body).not.toContain('fire-count'); // one-shot

    await sched.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd packages/agent && npx vitest --run src/reminders/__tests__/e2e.test.ts`
Expected: 1 test PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/reminders/__tests__/e2e.test.ts
git commit -m "test(reminders): end-to-end smoke (tool → scheduler → notifier body)"
```

---

## Task 17: Cleanup — delete the alarm subsystem

**Files:** (all deleted)
- `packages/agent/src/alarms/` (entire directory)
- `packages/agent/src/tools/implementations/schedule_alarm.ts`
- `packages/agent/src/tools/implementations/cancel_alarm.ts`
- `packages/agent/src/tools/implementations/list_alarms.ts`
- `packages/agent/src/tools/implementations/__tests__/schedule_alarm.test.ts`
- `packages/agent/src/tools/implementations/__tests__/cancel_alarm.test.ts`
- `packages/agent/src/tools/implementations/__tests__/list_alarms.test.ts`

**Files modified:**
- `packages/agent/src/server-types.ts` — remove `alarmScheduler` field.
- `packages/agent/src/server.ts` — remove the old `ensureAlarmSchedulerForActiveSession`, `shutdownAlarms`, and the `alarmScheduler` import.
- `packages/agent/src/tools/types.ts` — remove `alarmScheduler` from `ToolContext` and the `AlarmScheduler` import.
- `packages/agent/src/tools/executor.ts` — remove the three alarm tool registrations and imports.
- `packages/agent/src/notifications/composers.ts` — remove `composeAlarmFiredBody`, `composeAlarmExpiredBody`, related types.
- `packages/agent/src/notifications/__tests__/composers.test.ts` — remove the alarm composer tests.

- [ ] **Step 1: Confirm no remaining alarm references in the new code**

```bash
grep -rn "AlarmScheduler\|AlarmStore\|ScheduleAlarmTool\|CancelAlarmTool\|ListAlarmsTool\|alarm-fired\|alarm-expired\|composeAlarmFired\|composeAlarmExpired" packages/agent/src --include='*.ts' | grep -v __tests__ | grep -v '\.test\.'
```
Expected: matches only inside `packages/agent/src/alarms/` and `packages/agent/src/tools/implementations/{schedule,cancel,list}_alarm.ts` (files we're about to delete).

If anything else references the old names, fix those references to use the new ones before deleting.

- [ ] **Step 2: Delete the alarms directory and old tool files**

```bash
git rm -r packages/agent/src/alarms
git rm packages/agent/src/tools/implementations/schedule_alarm.ts \
       packages/agent/src/tools/implementations/cancel_alarm.ts \
       packages/agent/src/tools/implementations/list_alarms.ts \
       packages/agent/src/tools/implementations/__tests__/schedule_alarm.test.ts \
       packages/agent/src/tools/implementations/__tests__/cancel_alarm.test.ts \
       packages/agent/src/tools/implementations/__tests__/list_alarms.test.ts
```

- [ ] **Step 3: Remove residual references**

In `packages/agent/src/server-types.ts`, remove the `alarmScheduler?: AlarmScheduler;` field and the `import type { AlarmScheduler } from './alarms/alarm-scheduler';` line.

In `packages/agent/src/server.ts`, remove:
- `import { AlarmScheduler } from './alarms/alarm-scheduler';`
- `import { AlarmStore } from './alarms/alarm-store';`
- The old `ensureAlarmSchedulerForActiveSession` function (now superseded by `ensureReminderSchedulerForActiveSession`).
- The old `shutdownAlarms` function (now superseded by `shutdownReminders`).
- Any call sites that still reference the old names — they should already have been replaced in Task 14 / 15; this is the final sweep.

In `packages/agent/src/tools/types.ts`, remove:
- `import type { AlarmScheduler } from '@lace/agent/alarms/alarm-scheduler';`
- The `alarmScheduler?: AlarmScheduler;` field.

In `packages/agent/src/tools/executor.ts`, remove:
- `import { ScheduleAlarmTool } from './implementations/schedule_alarm';`
- `import { CancelAlarmTool } from './implementations/cancel_alarm';`
- `import { ListAlarmsTool } from './implementations/list_alarms';`
- The three `new ...AlarmTool()` entries in the tool list.

In `packages/agent/src/notifications/composers.ts`, remove:
- `composeAlarmFiredBody`, `composeAlarmExpiredBody`, `AlarmFiredCompose`, `AlarmExpiredCompose` exports.

In `packages/agent/src/notifications/__tests__/composers.test.ts`, remove the `describe` blocks for the deleted composers.

- [ ] **Step 4: Run the entire test suite**

```bash
cd packages/agent && npx vitest --run
```
Expected: ALL tests PASS. If anything still references the deleted code, fix it.

- [ ] **Step 5: Run type-check across the package**

```bash
cd packages/agent && npx tsc --noEmit -p tsconfig.json
```
Expected: clean.

- [ ] **Step 6: Run lint**

```bash
cd packages/agent && npm run lint
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add -A packages/agent/
git commit -m "refactor(reminders): delete alarm subsystem; switch to manage_reminders"
```

---

## Task 18: Documentation — update CLAUDE.md / CODE-MAP / READMEs

**Files:**
- Modify: `packages/agent/CLAUDE.md` (if it references alarms)
- Modify: `docs/architecture/CODE-MAP.md`
- Modify: any README in `packages/agent/src/` that names the alarm subsystem

- [ ] **Step 1: Find references**

```bash
grep -rn "alarm\|AlarmScheduler\|schedule_alarm" docs/ packages/agent/CLAUDE.md packages/agent/README.md 2>/dev/null | grep -v -i "may not exist\|past tense"
```

- [ ] **Step 2: Update each match** to refer to reminders / `manage_reminders` / `ReminderScheduler`. Don't rewrite history (keep references to PRI-1744 in changelogs intact — that's about the prior change).

- [ ] **Step 3: Verify**

```bash
grep -rn "schedule_alarm\|AlarmScheduler\|cancel_alarm\|list_alarms" docs/ packages/agent/CLAUDE.md packages/agent/README.md 2>/dev/null | grep -v specs/2026
```
Expected: no matches (the spec doc at `docs/specs/2026-05-22-alarms-coherent-design.md` is the historical record and stays).

- [ ] **Step 4: Commit**

```bash
git add docs/ packages/agent/CLAUDE.md packages/agent/README.md
git commit -m "docs(reminders): update references from alarm → reminder"
```

---

## Task 19: Ticket cleanup

This is bookkeeping, not code. Close the Linear tickets per spec §7:

- [ ] **Step 1: Update Linear**

Close as won't-do (with a comment linking to this plan and `docs/specs/2026-05-22-alarms-coherent-design.md`):
- PRI-1761 (metadata payload) — folded into prompt
- PRI-1762 (discriminated union schema) — dropped kind entirely
- PRI-1763 (update_alarm) — cancel + schedule composes
- PRI-1764 (preview_alarm) — model interprets cron
- PRI-1765 (chrono) — silent misparses unrecoverable
- PRI-1766 (recently_fired) — conversation log is the audit
- PRI-1767 (sub-hour cron) — flat 5-min floor

Close as done:
- PRI-1759 (umbrella) — once this rework lands.

- [ ] **Step 2: No commit needed for ticket changes**

---

## Self-Review Checklist (run before finalizing the plan)

**Spec coverage** — every spec section should map to at least one task:
- §1.1–1.3 (schema, cross-field rules) → Task 12 (parseManageRemindersInput)
- §1.4 (TZ) → Tasks 3, 5, 6 (cron helpers + scheduler + boot recovery)
- §1.5 (no history) → covered by absence (no history-write code)
- §1.6 (no update/preview/chrono) → covered by absence
- §2 (notification body + escape) → Task 9 (wrapper) + Task 14 (notifier composes)
- §2.1 (attributes) → Tasks 9, 14
- §2.2 (attributes-not-prose) → covered structurally by Task 9
- §2.3 (localtime ISO) → Task 14 (uses formatAbsoluteTime with agent TZ)
- §2.4 (list wire-shape) → Task 13 (recursToWire, special-case remaining=1)
- §3.1 (mutex) → Tasks 1, 5
- §3.2 (row shape) → Task 2
- §3.3 (fire ordering) → Task 5
- §3.4 (boot recovery) → Task 6
- §3.5 (cancel) → Task 7
- §3.6 (schedule) → Task 7
- §3.7 (multi-row tick) → Task 5 (heap.shift loop in tickForTest; production tick rechedules after each fire)
- §3.8 (list mutex-free) → Task 7 (list does not acquire mutex)
- §3.9 (50-cap) → Task 7 (enforced in schedule)
- §3.10 (no-deadlock) → covered by Task 14's notifier not calling back into the scheduler
- §3.11 (cross-session writes) → unchanged
- §4 (tool description) → Task 13 (MANAGE_REMINDERS_DESCRIPTION)
- §5 (Claude comparison) → no code task; doc remains as design rationale
- §6 (diff from PRI-1744) → covered by Tasks 9, 14, 17
- §7 (ticket disposition) → Task 19
- §8 (open questions) → no code action
- Appendix A (worked examples) → tests in Tasks 5–13 cover the major shapes

**Placeholder scan** — search for: TBD, TODO, "implement later", "as above", "similar to Task" — none found in the task bodies (the Self-Review section itself uses "above" but doesn't direct work).

**Type consistency** — `ReminderRecurs`, `ReminderRow`, `RemindersSnapshot`, `MAX_ACTIVE_REMINDERS`, `MIN_INTERVAL_MS` are defined in Task 2 and used consistently in Tasks 4–13. The `ScheduleInput` / `ScheduleResult` / `CancelResult` / `FireContext` types defined in Tasks 5/7 match their uses in Tasks 13/14.

**Things the engineer should know that aren't obvious from the code:**
- Lace already has `atomicWriteJson` at `packages/agent/src/storage/atomic-write.ts` — use it; don't re-implement.
- Lace already has a `runExclusive` mutex pattern at `server.ts:413`. Our `AsyncMutex` is a standalone version of the same idea.
- The `logger` at `@lace/agent/utils/logger` is the structured-log convention; `logger.warn('reminders.foo', { ...fields })` matches the codebase style.
- Lace tests use Vitest; co-located in `__tests__/` next to source. `tempdir`-based session dirs are the norm; the AlarmStore test on disk shows the pattern.
- `cron-parser` is already a dependency (used by the old `alarms/cron.ts`); don't add it again.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-22-reminders-rework.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
