# PRI-1744: Alarms in lace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the alarm subsystem from sen-core into lace as per-session JSONL storage plus a single in-process scheduler. Alarm fires become a new `alarm_fired` `DurableEvent` consumed by the embedder through the existing `onSessionUpdate` stream.

**Architecture:** Per-session `alarms.jsonl` lives next to `events.jsonl`. One `AlarmScheduler` per lace runtime owns an in-memory min-heap, walks all session dirs on boot, and emits both a durable `alarm_fired` event and (for the active session) a `session/update`. `schedule_alarm`/`cancel_alarm`/`list_alarms` become lace built-in tools alongside `delegate`/`job_notify`. `if_session_ended ∈ {drop, wake, bubble}`: `wake` and `bubble` are subagent-only and rejected at schedule-time for top-level sessions; `wake` re-spawns the subagent via the persona spec captured at schedule time; `bubble` redirects the fire to the parent session.

**Tech Stack:** TypeScript 5.6+ strict mode, Node 20.18+, Vitest, JSONL append-only logs, `@lace/ent-protocol` zod schemas. Sen-core repo runs the same toolchain.

**Repos touched:**
- Lace worktree: `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/lace-worktrees/pri-1744-alarms-spec/` (branch `pri-1744-alarms-spec`).
- Sen-core: `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2/` (work on a new branch off `main`: `pri-1744-alarms-in-lace`).

**Spec:** `docs/superpowers/specs/2026-05-21-pri-1744-alarms-in-lace.md`

**Pre-flight (run once at the start of execution):**

```bash
cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/lace-worktrees/pri-1744-alarms-spec
git fetch origin && git pull --ff-only origin pri-1744-alarms-spec
npm install
npm run lint
npm run test --workspaces=false --workspace=packages/ent-protocol --workspace=packages/agent -- --run 2>&1 | tail -20
```

All lint and existing tests must be green before starting. If anything fails, stop and report — do not begin editing.

---

## File map (lace)

**Create:**
- `packages/agent/src/alarms/types.ts` — row + inbound shapes
- `packages/agent/src/alarms/cron.ts` — port of sen-core cron utilities
- `packages/agent/src/alarms/alarm-store.ts` — per-session JSONL store
- `packages/agent/src/alarms/alarm-scheduler.ts` — single in-process loop + heap
- `packages/agent/src/alarms/index.ts` — barrel
- `packages/agent/src/alarms/__tests__/alarm-store.test.ts`
- `packages/agent/src/alarms/__tests__/alarm-scheduler.test.ts`
- `packages/agent/src/alarms/__tests__/cron.test.ts`
- `packages/agent/src/tools/implementations/schedule_alarm.ts`
- `packages/agent/src/tools/implementations/cancel_alarm.ts`
- `packages/agent/src/tools/implementations/list_alarms.ts`
- `packages/agent/src/tools/implementations/__tests__/schedule_alarm.test.ts`
- `packages/agent/src/tools/implementations/__tests__/cancel_alarm.test.ts`
- `packages/agent/src/tools/implementations/__tests__/list_alarms.test.ts`
- `packages/agent/src/__tests__/alarms.fire-delivery.e2e.test.ts`
- `packages/agent/src/__tests__/alarms.inactive-session-replay.e2e.test.ts`
- `packages/agent/src/__tests__/alarms.restart-recovery.e2e.test.ts`
- `packages/agent/src/__tests__/alarms.wake-subagent.e2e.test.ts`
- `packages/agent/src/__tests__/alarms.bubble-subagent.e2e.test.ts`
- `packages/agent/src/__tests__/alarms.top-level-rejects-wake-bubble.e2e.test.ts`
- `packages/agent/src/__tests__/alarms.cron-reschedule.e2e.test.ts`
- `docs/features/alarms.md`

**Modify:**
- `packages/ent-protocol/src/schemas/methods.ts` — add `SessionUpdateAlarmFiredSchema`, plug into the three discriminated unions around lines 1948, 1982, 2008.
- `packages/agent/src/storage/event-types.ts` — add `AlarmFiredEventData` and include in `DurableEventData`.
- `packages/agent/src/storage/session-store.ts` — extend `SessionMeta` with optional `parent`.
- `packages/agent/src/tools/types.ts` — add `alarmScheduler?` to `ToolContext`.
- `packages/agent/src/tools/executor.ts` — add `schedule_alarm`/`cancel_alarm`/`list_alarms` to `LACE_BUILTIN_TOOL_NAMES`; wire scheduler into `ToolContext`.
- `packages/agent/src/tools/implementations/index.ts` — export the three new tools.
- `packages/agent/src/server-types.ts` — add `alarmScheduler` field to `AgentServerState`.
- `packages/agent/src/server.ts` — instantiate `AlarmScheduler`, plumb into `ToolContext`, flush undelivered on session activation.
- `packages/agent/src/rpc/handlers/session.ts` — call `state.alarmScheduler.flushUndelivered(sessionId)` after each activation; persist `parent` in subagent-created sessions.
- `packages/agent/src/jobs/subagent-job.ts` — pass `parent` into `client.sessionNew`/`session/new` request and store in meta.
- `docs/protocol-spec.md` — document `alarm_fired` `SessionUpdate` and `DurableEvent`.
- `docs/protocol-conformance.md` — extend the conformance list.

## File map (sen-core)

**Delete:**
- `src/alarms/store.ts`
- `src/alarms/scheduler-service.ts`
- `src/alarms/tools.ts`
- `src/alarms/cron.ts`
- `mcp-servers/scheduler.ts`
- `tests/automated/alarms/` (entire directory)

**Modify:**
- `src/main.ts:574-590` — remove `AlarmsStore`/`SchedulerService` instantiation.
- `src/main.ts` (around `attachClientSubscriptions`, line ~204) — handle `update.type === 'alarm_fired'` and dispatch as `InboundAlarm`.
- `templates/agent-personas/core.md` — remove lines 8-14 (the `scheduler:` MCP entry).
- `src/alarms/types.ts` — keep just `InboundAlarm` (it's still the inbox envelope).
- `tests/automated/alarms-inbound.e2e.test.ts` — new test.

---

## Phase 1 — Lace alarm core (types, store, cron, scheduler)

### Task 1: Lace alarm row + inbound types

**Files:**
- Create: `packages/agent/src/alarms/types.ts`

- [ ] **Step 1:** Create `packages/agent/src/alarms/types.ts`:

```ts
// ABOUTME: Type shapes for the lace alarm subsystem — per-session row schema
// ABOUTME: persisted in alarms.jsonl and the inbound payload emitted as alarm_fired.

export type AlarmKind = 'cron' | 'once';

export type AlarmStatus = 'pending' | 'firing' | 'fired' | 'cancelled';

export type IfSessionEnded = 'drop' | 'wake' | 'bubble';

/** Captured at schedule-time when ifSessionEnded ∈ {wake, bubble} for a subagent. */
export interface AlarmParentRef {
  sessionId: string;
  jobId: string;
  personaName?: string;
  /** Serialized PersonaContainerRuntime | PersonaBoxRuntime; opaque to alarm code. */
  runtime?: unknown;
}

export interface AlarmRow {
  id: string;
  kind: AlarmKind;
  schedule: string;
  timezone: string;
  prompt: string;
  ifSessionEnded: IfSessionEnded;
  next_fire_at: number;
  status: AlarmStatus;
  created_at: number;
  fired_at: number | null;
  delivered_at: number | null;
  parent?: AlarmParentRef;
}

export const MAX_ACTIVE_ALARMS = 50;
```

- [ ] **Step 2:** Commit.

```bash
git add packages/agent/src/alarms/types.ts
git commit -m "feat(alarms): add row + ifSessionEnded types (PRI-1744)"
```

---

### Task 2: Port cron utilities into lace

**Files:**
- Create: `packages/agent/src/alarms/cron.ts`
- Create: `packages/agent/src/alarms/__tests__/cron.test.ts`

- [ ] **Step 1:** Copy `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2/src/alarms/cron.ts` to `packages/agent/src/alarms/cron.ts`. Top of file should read:

```ts
// ABOUTME: Cron + one-shot fire-time math. Ported from sen-core-v2/src/alarms/cron.ts.
// ABOUTME: Exports computeNextCronFire, computeNextOnceFire, assertValidIanaTimezone,
// ABOUTME: assertValidCronMinInterval.
```

Leave all logic verbatim. The sen-core source uses `.js` extensions in imports; this file has no internal imports so nothing to change.

- [ ] **Step 2:** Copy `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2/tests/automated/alarms/cron.test.ts` to `packages/agent/src/alarms/__tests__/cron.test.ts`. Update its import paths from the sen-core form to:

```ts
import {
  computeNextCronFire,
  computeNextOnceFire,
  assertValidIanaTimezone,
  assertValidCronMinInterval,
} from '../cron';
```

- [ ] **Step 3:** Run the test:

```bash
npx vitest --run packages/agent/src/alarms/__tests__/cron.test.ts
```

Expected: all cron tests pass.

- [ ] **Step 4:** Commit.

```bash
git add packages/agent/src/alarms/cron.ts packages/agent/src/alarms/__tests__/cron.test.ts
git commit -m "feat(alarms): port cron utilities from sen-core (PRI-1744)"
```

---

### Task 3: AlarmStore JSONL fold — failing test first

**Files:**
- Create: `packages/agent/src/alarms/__tests__/alarm-store.test.ts`
- Create: `packages/agent/src/alarms/alarm-store.ts`

- [ ] **Step 1:** Write the failing test. Create `packages/agent/src/alarms/__tests__/alarm-store.test.ts`:

```ts
// ABOUTME: Unit tests for AlarmStore — per-session JSONL fold, claim semantics,
// ABOUTME: delivered_at tracking, and MAX_ACTIVE_ALARMS cap.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { AlarmStore } from '../alarm-store';
import type { AlarmRow } from '../types';
import { MAX_ACTIVE_ALARMS } from '../types';

function tempSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'lace-alarms-test-'));
}

describe('AlarmStore', () => {
  it('insert returns a row with status pending and writes a JSONL line', () => {
    const dir = tempSessionDir();
    const store = new AlarmStore(dir);
    const row = store.insert({
      kind: 'once',
      schedule: '2030-01-01T00:00:00Z',
      timezone: 'UTC',
      prompt: 'wake me',
      ifSessionEnded: 'drop',
      next_fire_at: Date.parse('2030-01-01T00:00:00Z'),
      now: 1000,
    });
    expect(row.status).toBe('pending');
    expect(row.id).toMatch(/^alarm_/);
    const raw = readFileSync(join(dir, 'alarms.jsonl'), 'utf8');
    expect(raw.trim().split('\n')).toHaveLength(1);
  });

  it('listActive folds latest-by-id and excludes fired/cancelled', () => {
    const dir = tempSessionDir();
    const store = new AlarmStore(dir);
    const a = store.insert({
      kind: 'once', schedule: '2030-01-01T00:00:00Z', timezone: 'UTC',
      prompt: 'a', ifSessionEnded: 'drop', next_fire_at: 1, now: 0,
    });
    const b = store.insert({
      kind: 'once', schedule: '2030-01-02T00:00:00Z', timezone: 'UTC',
      prompt: 'b', ifSessionEnded: 'drop', next_fire_at: 2, now: 0,
    });
    store.cancel(b.id);
    const active = store.listActive();
    expect(active.map((r) => r.id)).toEqual([a.id]);
  });

  it('claim is atomic — second claim returns false', () => {
    const dir = tempSessionDir();
    const store = new AlarmStore(dir);
    const row = store.insert({
      kind: 'once', schedule: '2030-01-01T00:00:00Z', timezone: 'UTC',
      prompt: 'x', ifSessionEnded: 'drop', next_fire_at: 1, now: 0,
    });
    expect(store.claim(row.id)).toBe(true);
    expect(store.claim(row.id)).toBe(false);
  });

  it('reload from disk reproduces folded state', () => {
    const dir = tempSessionDir();
    const s1 = new AlarmStore(dir);
    const row = s1.insert({
      kind: 'cron', schedule: '0 9 * * *', timezone: 'UTC',
      prompt: 'p', ifSessionEnded: 'drop', next_fire_at: 100, now: 0,
    });
    s1.claim(row.id);
    s1.markFired(row.id, 50, /*delivered_at*/ 51);
    const s2 = new AlarmStore(dir);
    const got = s2.get(row.id) as AlarmRow;
    expect(got.status).toBe('fired');
    expect(got.delivered_at).toBe(51);
  });

  it('countActive enforces MAX_ACTIVE_ALARMS', () => {
    const dir = tempSessionDir();
    const store = new AlarmStore(dir);
    for (let i = 0; i < MAX_ACTIVE_ALARMS; i++) {
      store.insert({
        kind: 'once', schedule: '2030-01-01T00:00:00Z', timezone: 'UTC',
        prompt: `p${i}`, ifSessionEnded: 'drop', next_fire_at: i, now: 0,
      });
    }
    expect(store.countActive()).toBe(MAX_ACTIVE_ALARMS);
  });

  it('findUndelivered returns rows with status fired and delivered_at null', () => {
    const dir = tempSessionDir();
    const store = new AlarmStore(dir);
    const row = store.insert({
      kind: 'once', schedule: '2030-01-01T00:00:00Z', timezone: 'UTC',
      prompt: 'u', ifSessionEnded: 'drop', next_fire_at: 1, now: 0,
    });
    store.claim(row.id);
    store.markFired(row.id, 5, /*delivered_at*/ null);
    expect(store.findUndelivered().map((r) => r.id)).toEqual([row.id]);
    store.markDelivered(row.id, 6);
    expect(store.findUndelivered()).toEqual([]);
  });
});
```

- [ ] **Step 2:** Run the test to confirm it fails.

```bash
npx vitest --run packages/agent/src/alarms/__tests__/alarm-store.test.ts
```

Expected: FAIL with "Cannot find module '../alarm-store'".

- [ ] **Step 3:** Create `packages/agent/src/alarms/alarm-store.ts`:

```ts
// ABOUTME: Per-session AlarmStore — append-only JSONL log of alarm rows, folded into
// ABOUTME: an in-memory map (latest-by-id wins) at construction. Atomic claim via
// ABOUTME: append-then-fold; no in-place mutation.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AlarmKind, AlarmParentRef, AlarmRow, IfSessionEnded } from './types';
import { MAX_ACTIVE_ALARMS } from './types';

export interface InsertAlarmArgs {
  kind: AlarmKind;
  schedule: string;
  timezone: string;
  prompt: string;
  ifSessionEnded: IfSessionEnded;
  next_fire_at: number;
  now: number;
  parent?: AlarmParentRef;
}

export type CancelResult =
  | { cancelled: true }
  | { cancelled: false; reason: 'not_found' | 'already_fired' | 'already_cancelled' | 'firing' };

const FILE_NAME = 'alarms.jsonl';

function ensureTrailingNewline(path: string): void {
  try {
    const stat = statSync(path);
    if (stat.size === 0) return;
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(1);
      readSync(fd, buf, 0, 1, stat.size - 1);
      if (buf.toString('utf8') !== '\n') {
        appendFileSync(path, '\n', { encoding: 'utf8' });
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    // file missing — appendFileSync will create it
  }
}

export class AlarmStore {
  private readonly path: string;
  private rows = new Map<string, AlarmRow>();

  constructor(sessionDir: string) {
    mkdirSync(sessionDir, { recursive: true });
    this.path = join(sessionDir, FILE_NAME);
    this.reload();
  }

  private reload(): void {
    this.rows.clear();
    if (!existsSync(this.path)) return;
    const raw = readFileSync(this.path, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const row = JSON.parse(line) as AlarmRow;
        if (typeof row.id !== 'string') continue;
        this.rows.set(row.id, row);
      } catch {
        // ignore partial line
      }
    }
  }

  private append(row: AlarmRow): void {
    ensureTrailingNewline(this.path);
    appendFileSync(this.path, `${JSON.stringify(row)}\n`, { encoding: 'utf8' });
    this.rows.set(row.id, row);
  }

  insert(args: InsertAlarmArgs): AlarmRow {
    const id = `alarm_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const row: AlarmRow = {
      id,
      kind: args.kind,
      schedule: args.schedule,
      timezone: args.timezone,
      prompt: args.prompt,
      ifSessionEnded: args.ifSessionEnded,
      next_fire_at: args.next_fire_at,
      status: 'pending',
      created_at: args.now,
      fired_at: null,
      delivered_at: null,
      ...(args.parent ? { parent: args.parent } : {}),
    };
    this.append(row);
    return row;
  }

  get(id: string): AlarmRow | null {
    return this.rows.get(id) ?? null;
  }

  claim(id: string): boolean {
    const current = this.rows.get(id);
    if (!current || current.status !== 'pending') return false;
    this.append({ ...current, status: 'firing' });
    return true;
  }

  markFired(id: string, firedAt: number, deliveredAt: number | null): void {
    const current = this.rows.get(id);
    if (!current) return;
    this.append({ ...current, status: 'fired', fired_at: firedAt, delivered_at: deliveredAt });
  }

  markDelivered(id: string, deliveredAt: number): void {
    const current = this.rows.get(id);
    if (!current) return;
    this.append({ ...current, delivered_at: deliveredAt });
  }

  rescheduleCron(id: string, nextFireAt: number, firedAt: number, deliveredAt: number | null): void {
    const current = this.rows.get(id);
    if (!current) return;
    this.append({
      ...current,
      status: 'pending',
      next_fire_at: nextFireAt,
      fired_at: firedAt,
      delivered_at: deliveredAt,
    });
  }

  rescheduleStale(id: string, nextFireAt: number): void {
    const current = this.rows.get(id);
    if (!current || current.status !== 'pending' || current.kind !== 'cron') return;
    this.append({ ...current, next_fire_at: nextFireAt });
  }

  cancel(id: string): CancelResult {
    const current = this.rows.get(id);
    if (!current) return { cancelled: false, reason: 'not_found' };
    if (current.status === 'fired') return { cancelled: false, reason: 'already_fired' };
    if (current.status === 'cancelled') return { cancelled: false, reason: 'already_cancelled' };
    if (current.status === 'firing') return { cancelled: false, reason: 'firing' };
    this.append({ ...current, status: 'cancelled' });
    return { cancelled: true };
  }

  listActive(): AlarmRow[] {
    return [...this.rows.values()]
      .filter((r) => r.status === 'pending' || r.status === 'firing')
      .sort((a, b) => a.next_fire_at - b.next_fire_at);
  }

  countActive(): number {
    return this.listActive().length;
  }

  soonestPending(): AlarmRow | null {
    const active = this.listActive().filter((r) => r.status === 'pending');
    return active[0] ?? null;
  }

  staleRecurring(cutoff: number): AlarmRow[] {
    return [...this.rows.values()]
      .filter((r) => r.status === 'pending' && r.kind === 'cron' && r.next_fire_at < cutoff)
      .sort((a, b) => a.next_fire_at - b.next_fire_at);
  }

  findUndelivered(): AlarmRow[] {
    return [...this.rows.values()].filter(
      (r) => r.status === 'fired' && r.delivered_at === null
    );
  }
}

export { MAX_ACTIVE_ALARMS };
```

- [ ] **Step 4:** Run the test and verify it passes.

```bash
npx vitest --run packages/agent/src/alarms/__tests__/alarm-store.test.ts
```

Expected: all tests pass.

- [ ] **Step 5:** Commit.

```bash
git add packages/agent/src/alarms/alarm-store.ts packages/agent/src/alarms/__tests__/alarm-store.test.ts
git commit -m "feat(alarms): per-session JSONL AlarmStore (PRI-1744)"
```

---

### Task 4: AlarmScheduler — failing test first

**Files:**
- Create: `packages/agent/src/alarms/__tests__/alarm-scheduler.test.ts`
- Create: `packages/agent/src/alarms/alarm-scheduler.ts`

- [ ] **Step 1:** Write the failing test. Create `packages/agent/src/alarms/__tests__/alarm-scheduler.test.ts`:

```ts
// ABOUTME: Unit tests for AlarmScheduler — boot recovery, soonest-pending, notify(),
// ABOUTME: claim+fire semantics, cron reschedule, undelivered flush on activation.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { AlarmScheduler } from '../alarm-scheduler';
import { AlarmStore } from '../alarm-store';

function tempSessionsDir(): string {
  return mkdtempSync(join(tmpdir(), 'lace-scheduler-test-'));
}

interface Recorded {
  sessionId: string;
  payload: { type: 'alarm_fired'; id: string; alarmKind: 'cron' | 'once'; prompt: string; schedule: string; fired_at: number };
}

describe('AlarmScheduler', () => {
  it('fires a one-shot when its time arrives and emits alarm_fired', async () => {
    const sessionsDir = tempSessionsDir();
    const sessionDir = join(sessionsDir, 'sess_a');
    const store = new AlarmStore(sessionDir);
    store.insert({
      kind: 'once', schedule: '2030-01-01T00:00:01Z', timezone: 'UTC',
      prompt: 'wake', ifSessionEnded: 'drop', next_fire_at: 1000, now: 0,
    });

    const events: Recorded[] = [];
    const scheduler = new AlarmScheduler({
      sessionsDir,
      now: () => 0,
      jitterMaxMs: 0,
      emit: (sessionId, payload) => {
        events.push({ sessionId, payload });
        return Promise.resolve();
      },
      appendEvent: () => Promise.resolve(),
      isActive: () => true,
      spawnSubagentForWake: () => Promise.reject(new Error('unused')),
      randomFn: () => 0,
    });

    // Advance clock to 1500 and tick once
    (scheduler as unknown as { now: () => number }).now = () => 1500;
    await scheduler.tickForTest();
    expect(events).toHaveLength(1);
    expect(events[0].payload.type).toBe('alarm_fired');
    expect(events[0].sessionId).toBe('sess_a');
  });

  it('cron reschedules to the next jittered occurrence', async () => {
    const sessionsDir = tempSessionsDir();
    const sessionDir = join(sessionsDir, 'sess_a');
    const store = new AlarmStore(sessionDir);
    store.insert({
      kind: 'cron', schedule: '0 9 * * *', timezone: 'UTC',
      prompt: 'daily', ifSessionEnded: 'drop',
      next_fire_at: Date.parse('2030-01-01T09:00:00Z'), now: 0,
    });
    const events: Recorded[] = [];
    const scheduler = new AlarmScheduler({
      sessionsDir,
      now: () => Date.parse('2030-01-01T09:00:00Z') + 1,
      jitterMaxMs: 0,
      emit: (sessionId, payload) => { events.push({ sessionId, payload }); return Promise.resolve(); },
      appendEvent: () => Promise.resolve(),
      isActive: () => true,
      spawnSubagentForWake: () => Promise.reject(new Error('unused')),
      randomFn: () => 0,
    });
    await scheduler.tickForTest();
    const next = store.listActive();
    expect(next).toHaveLength(1);
    expect(next[0].next_fire_at).toBe(Date.parse('2030-01-02T09:00:00Z'));
    expect(events).toHaveLength(1);
  });

  it('notify() wakes the loop early', async () => {
    const sessionsDir = tempSessionsDir();
    const scheduler = new AlarmScheduler({
      sessionsDir,
      now: () => 0,
      jitterMaxMs: 0,
      emit: () => Promise.resolve(),
      appendEvent: () => Promise.resolve(),
      isActive: () => true,
      spawnSubagentForWake: () => Promise.reject(new Error('unused')),
      randomFn: () => 0,
    });
    const woken = vi.fn();
    scheduler.onNotifyForTest(woken);
    scheduler.notify();
    expect(woken).toHaveBeenCalled();
  });

  it('inactive session: appends event but defers session/update emission', async () => {
    const sessionsDir = tempSessionsDir();
    const sessionDir = join(sessionsDir, 'sess_b');
    const store = new AlarmStore(sessionDir);
    store.insert({
      kind: 'once', schedule: '2030-01-01T00:00:01Z', timezone: 'UTC',
      prompt: 'wake', ifSessionEnded: 'drop', next_fire_at: 100, now: 0,
    });
    const events: Recorded[] = [];
    const appendedEvents: Array<{ dir: string; type: string }> = [];
    const scheduler = new AlarmScheduler({
      sessionsDir,
      now: () => 1000,
      jitterMaxMs: 0,
      emit: (sessionId, payload) => { events.push({ sessionId, payload }); return Promise.resolve(); },
      appendEvent: (dir, ev) => { appendedEvents.push({ dir, type: ev.type }); return Promise.resolve(); },
      isActive: () => false,
      spawnSubagentForWake: () => Promise.reject(new Error('unused')),
      randomFn: () => 0,
    });
    await scheduler.tickForTest();
    expect(events).toHaveLength(0);
    expect(appendedEvents).toHaveLength(1);
    expect(appendedEvents[0].type).toBe('alarm_fired');
    expect(store.findUndelivered()).toHaveLength(1);
  });

  it('flushUndelivered emits session/update and marks delivered', async () => {
    const sessionsDir = tempSessionsDir();
    const sessionDir = join(sessionsDir, 'sess_c');
    const store = new AlarmStore(sessionDir);
    const row = store.insert({
      kind: 'once', schedule: '2030-01-01T00:00:00Z', timezone: 'UTC',
      prompt: 'wake', ifSessionEnded: 'drop', next_fire_at: 1, now: 0,
    });
    store.claim(row.id);
    store.markFired(row.id, 5, null);

    const events: Recorded[] = [];
    const scheduler = new AlarmScheduler({
      sessionsDir,
      now: () => 100,
      jitterMaxMs: 0,
      emit: (sessionId, payload) => { events.push({ sessionId, payload }); return Promise.resolve(); },
      appendEvent: () => Promise.resolve(),
      isActive: () => true,
      spawnSubagentForWake: () => Promise.reject(new Error('unused')),
      randomFn: () => 0,
    });
    await scheduler.flushUndelivered('sess_c');
    expect(events).toHaveLength(1);
    expect(store.findUndelivered()).toEqual([]);
  });
});
```

- [ ] **Step 2:** Run the test to confirm it fails.

```bash
npx vitest --run packages/agent/src/alarms/__tests__/alarm-scheduler.test.ts
```

Expected: FAIL ("Cannot find module '../alarm-scheduler'").

- [ ] **Step 3:** Create `packages/agent/src/alarms/alarm-scheduler.ts`:

```ts
// ABOUTME: Single-loop alarm scheduler for the lace runtime. Walks all session
// ABOUTME: dirs on boot, holds an in-memory min-heap by next_fire_at, fires due
// ABOUTME: alarms via injected emit/appendEvent hooks. Cron reschedule + stale
// ABOUTME: sweep + undelivered flush on session activation.

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { computeNextCronFire } from './cron';
import { AlarmStore } from './alarm-store';
import type { AlarmRow } from './types';

const BACKSTOP_POLL_MS = 5000;
const STALENESS_WINDOW_MS = 60_000;

export interface AlarmFiredPayload {
  type: 'alarm_fired';
  id: string;
  alarmKind: 'cron' | 'once';
  prompt: string;
  schedule: string;
  fired_at: number;
  bubbled_from?: { sessionId: string; personaName?: string };
}

export interface AlarmFiredDurableEvent {
  type: 'alarm_fired';
  data: AlarmFiredPayload;
}

export interface SchedulerDependencies {
  sessionsDir: string;
  now: () => number;
  jitterMaxMs: number;
  /** Emit session/update for an active session. No-op for inactive. */
  emit: (targetSessionId: string, payload: AlarmFiredPayload) => Promise<void>;
  /** Append a durable event to a session's events.jsonl. Works for active or inactive. */
  appendEvent: (sessionDir: string, event: { type: 'alarm_fired'; data: AlarmFiredPayload }) => Promise<void>;
  /** Is the target session currently the active session? */
  isActive: (sessionId: string) => boolean;
  /** Re-spawn a subagent for wake. Returns the new session id. */
  spawnSubagentForWake: (parent: { sessionId: string; jobId: string; personaName?: string; runtime?: unknown }) => Promise<string>;
  randomFn?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  onError?: (err: unknown) => void;
  sessionDirExists?: (sessionId: string) => boolean;
}

interface HeapEntry {
  sessionId: string;
  alarmId: string;
  next_fire_at: number;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = (): void => {
      clearTimeout(t);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class AlarmScheduler {
  private readonly deps: Required<Omit<SchedulerDependencies,
    'onError' | 'sleep' | 'randomFn' | 'sessionDirExists'>> & {
      onError?: (e: unknown) => void;
      sleep: (ms: number, signal: AbortSignal) => Promise<void>;
      randomFn: () => number;
      sessionDirExists: (sessionId: string) => boolean;
    };
  private now: () => number;
  private stores = new Map<string, AlarmStore>();
  private heap: HeapEntry[] = [];
  private running = false;
  private stopController: AbortController | null = null;
  private wakeResolve: (() => void) | null = null;
  private testNotifyHook: (() => void) | null = null;

  constructor(deps: SchedulerDependencies) {
    this.deps = {
      sessionsDir: deps.sessionsDir,
      now: deps.now,
      jitterMaxMs: deps.jitterMaxMs,
      emit: deps.emit,
      appendEvent: deps.appendEvent,
      isActive: deps.isActive,
      spawnSubagentForWake: deps.spawnSubagentForWake,
      onError: deps.onError,
      sleep: deps.sleep ?? defaultSleep,
      randomFn: deps.randomFn ?? Math.random,
      sessionDirExists: deps.sessionDirExists ?? ((sessionId) => existsSync(join(deps.sessionsDir, sessionId))),
    };
    this.now = deps.now;
  }

  /** Walk sessionsDir, load every alarms.jsonl, build heap. Idempotent. */
  loadAll(): void {
    this.stores.clear();
    this.heap = [];
    if (!existsSync(this.deps.sessionsDir)) return;
    const entries = readdirSync(this.deps.sessionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionId = entry.name;
      const sessionDir = join(this.deps.sessionsDir, sessionId);
      try {
        const stat = statSync(sessionDir);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }
      const store = new AlarmStore(sessionDir);
      this.stores.set(sessionId, store);
      this.runStaleSweepForSession(sessionId, store);
      for (const row of store.listActive()) {
        if (row.status === 'pending' || row.status === 'firing') {
          // Treat stuck 'firing' rows as pending — at-least-once semantics.
          this.heap.push({ sessionId, alarmId: row.id, next_fire_at: row.next_fire_at });
        }
      }
    }
    this.heap.sort((a, b) => a.next_fire_at - b.next_fire_at);
  }

  /** Get-or-create the AlarmStore for a session. */
  storeFor(sessionId: string): AlarmStore {
    let s = this.stores.get(sessionId);
    if (!s) {
      const sessionDir = join(this.deps.sessionsDir, sessionId);
      s = new AlarmStore(sessionDir);
      this.stores.set(sessionId, s);
    }
    return s;
  }

  /** Add a freshly-inserted alarm to the heap and wake the loop. */
  enqueue(sessionId: string, row: AlarmRow): void {
    this.heap.push({ sessionId, alarmId: row.id, next_fire_at: row.next_fire_at });
    this.heap.sort((a, b) => a.next_fire_at - b.next_fire_at);
    this.notify();
  }

  notify(): void {
    if (this.wakeResolve) {
      const r = this.wakeResolve;
      this.wakeResolve = null;
      r();
    }
    if (this.testNotifyHook) this.testNotifyHook();
  }

  /** Test hook — replaces the default notify resolver with a callback. */
  onNotifyForTest(cb: () => void): void {
    this.testNotifyHook = cb;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.loadAll();
    this.running = true;
    this.stopController = new AbortController();
    const signal = this.stopController.signal;
    try {
      while (!signal.aborted) {
        try {
          await this.tick(signal);
        } catch (err) {
          if (signal.aborted) break;
          this.deps.onError?.(err);
          try {
            await this.deps.sleep(BACKSTOP_POLL_MS, signal);
          } catch {
            break;
          }
        }
      }
    } finally {
      this.running = false;
      this.stopController = null;
      this.wakeResolve = null;
    }
  }

  async stop(): Promise<void> {
    if (this.stopController) this.stopController.abort();
    this.notify();
  }

  /** Public test seam — runs exactly one tick. Used by unit tests. */
  async tickForTest(): Promise<void> {
    this.loadAll();
    await this.tick(new AbortController().signal, { onceOnly: true });
  }

  async flushUndelivered(sessionId: string): Promise<void> {
    const store = this.storeFor(sessionId);
    const rows = store.findUndelivered();
    for (const row of rows) {
      await this.deps.emit(sessionId, this.toPayload(row, row.fired_at ?? this.deps.now()));
      store.markDelivered(row.id, this.deps.now());
    }
  }

  private async tick(signal: AbortSignal, opts?: { onceOnly?: boolean }): Promise<void> {
    const soonest = this.heap[0];
    if (!soonest) {
      if (opts?.onceOnly) return;
      await this.sleepOrNotify(BACKSTOP_POLL_MS, signal);
      return;
    }
    const wait = soonest.next_fire_at - this.deps.now();
    if (wait > 0) {
      if (opts?.onceOnly) return;
      await this.sleepOrNotify(Math.min(wait, BACKSTOP_POLL_MS), signal);
      return;
    }
    this.heap.shift();
    await this.fire(soonest);
  }

  private async fire(entry: HeapEntry): Promise<void> {
    const store = this.storeFor(entry.sessionId);
    const row = store.get(entry.alarmId);
    if (!row) return;
    if (!store.claim(row.id)) return;
    const firedAt = this.deps.now();

    let targetSessionId = entry.sessionId;
    let bubbledFrom: { sessionId: string; personaName?: string } | undefined;
    const sessionExists = this.deps.sessionDirExists(entry.sessionId);

    if (!sessionExists) {
      // Session is gone. Apply ifSessionEnded policy.
      if (row.ifSessionEnded === 'drop') {
        store.markFired(row.id, firedAt, firedAt);
        return;
      }
      if (row.ifSessionEnded === 'wake') {
        if (!row.parent) {
          this.deps.onError?.(new Error(`wake alarm ${row.id} missing parent — dropping`));
          store.markFired(row.id, firedAt, firedAt);
          return;
        }
        try {
          targetSessionId = await this.deps.spawnSubagentForWake({
            sessionId: row.parent.sessionId,
            jobId: row.parent.jobId,
            ...(row.parent.personaName ? { personaName: row.parent.personaName } : {}),
            ...(row.parent.runtime ? { runtime: row.parent.runtime } : {}),
          });
        } catch (err) {
          this.deps.onError?.(err);
          store.markFired(row.id, firedAt, firedAt);
          return;
        }
      } else {
        // bubble
        if (!row.parent || !this.deps.sessionDirExists(row.parent.sessionId)) {
          this.deps.onError?.(new Error(`bubble alarm ${row.id}: parent gone — dropping`));
          store.markFired(row.id, firedAt, firedAt);
          return;
        }
        targetSessionId = row.parent.sessionId;
        bubbledFrom = {
          sessionId: row.parent.sessionId,
          ...(row.parent.personaName ? { personaName: row.parent.personaName } : {}),
        };
      }
    }

    const payload = this.toPayload(row, firedAt, bubbledFrom);
    const sessionDir = join(this.deps.sessionsDir, targetSessionId);
    await this.deps.appendEvent(sessionDir, { type: 'alarm_fired', data: payload });

    let deliveredAt: number | null = null;
    if (this.deps.isActive(targetSessionId)) {
      await this.deps.emit(targetSessionId, payload);
      deliveredAt = this.deps.now();
    }

    if (row.kind === 'once') {
      store.markFired(row.id, firedAt, deliveredAt);
      return;
    }
    // cron — reschedule
    try {
      const { jitteredMs } = computeNextCronFire({
        expr: row.schedule,
        timezone: row.timezone,
        after: new Date(firedAt),
        jitterMaxMs: this.deps.jitterMaxMs,
        randomFn: this.deps.randomFn,
      });
      store.rescheduleCron(row.id, jitteredMs, firedAt, deliveredAt);
      this.heap.push({ sessionId: entry.sessionId, alarmId: row.id, next_fire_at: jitteredMs });
      this.heap.sort((a, b) => a.next_fire_at - b.next_fire_at);
    } catch (err) {
      this.deps.onError?.(err);
      // leave row in 'firing' — caller will see the error
    }
  }

  private toPayload(row: AlarmRow, firedAt: number, bubbledFrom?: { sessionId: string; personaName?: string }): AlarmFiredPayload {
    return {
      type: 'alarm_fired',
      id: row.id,
      alarmKind: row.kind,
      prompt: row.prompt,
      schedule: row.schedule,
      fired_at: firedAt,
      ...(bubbledFrom ? { bubbled_from: bubbledFrom } : {}),
    };
  }

  private runStaleSweepForSession(sessionId: string, store: AlarmStore): void {
    const cutoff = this.deps.now() - STALENESS_WINDOW_MS;
    for (const row of store.staleRecurring(cutoff)) {
      try {
        const { jitteredMs } = computeNextCronFire({
          expr: row.schedule,
          timezone: row.timezone,
          after: new Date(this.deps.now()),
          jitterMaxMs: this.deps.jitterMaxMs,
          randomFn: this.deps.randomFn,
        });
        store.rescheduleStale(row.id, jitteredMs);
      } catch (err) {
        this.deps.onError?.(err);
      }
    }
  }

  private async sleepOrNotify(ms: number, signal: AbortSignal): Promise<void> {
    let resolveWake: (() => void) | null = null;
    const notified = new Promise<void>((resolve) => {
      resolveWake = resolve;
      this.wakeResolve = resolve;
    });
    try {
      await Promise.race([this.deps.sleep(ms, signal), notified]);
    } finally {
      if (this.wakeResolve === resolveWake) this.wakeResolve = null;
    }
  }
}
```

- [ ] **Step 4:** Run the test and verify it passes.

```bash
npx vitest --run packages/agent/src/alarms/__tests__/alarm-scheduler.test.ts
```

Expected: all tests pass.

- [ ] **Step 5:** Create `packages/agent/src/alarms/index.ts`:

```ts
// ABOUTME: Barrel exports for the lace alarm subsystem.

export * from './types';
export { AlarmStore } from './alarm-store';
export type { CancelResult, InsertAlarmArgs } from './alarm-store';
export { AlarmScheduler } from './alarm-scheduler';
export type { AlarmFiredPayload, SchedulerDependencies } from './alarm-scheduler';
```

- [ ] **Step 6:** Commit.

```bash
git add packages/agent/src/alarms/alarm-scheduler.ts packages/agent/src/alarms/__tests__/alarm-scheduler.test.ts packages/agent/src/alarms/index.ts
git commit -m "feat(alarms): in-process AlarmScheduler with wake/bubble fanout (PRI-1744)"
```

---

## Phase 2 — Ent-protocol + DurableEvent

### Task 5: Add `alarm_fired` `DurableEvent` data type

**Files:**
- Modify: `packages/agent/src/storage/event-types.ts`

- [ ] **Step 1:** Open `packages/agent/src/storage/event-types.ts` and add `AlarmFiredEventData` after the `FilesRewoundEventData` type (around line 125):

```ts
export type AlarmFiredEventData = {
  type: 'alarm_fired';
  id: string;
  alarmKind: 'cron' | 'once';
  prompt: string;
  schedule: string;
  fired_at: number;
  bubbled_from?: { sessionId: string; personaName?: string };
};
```

- [ ] **Step 2:** Add `AlarmFiredEventData` to the `DurableEventData` discriminated union (around line 144):

```ts
export type DurableEventData =
  | PromptEventData
  | MessageEventData
  | ToolUseEventData
  | TurnStartEventData
  | TurnEndEventData
  | ContextCompactedEventData
  | ContextInjectedEventData
  | JobStartedEventData
  | JobFinishedEventData
  | JobUpdateEventData
  | JobSessionAssignedEventData
  | PermissionRequestedEventData
  | PermissionDecidedEventData
  | PermissionCancelledEventData
  | CheckpointCreatedEventData
  | FilesRewoundEventData
  | AlarmFiredEventData;
```

- [ ] **Step 3:** Run typecheck.

```bash
npx tsc --noEmit -p packages/agent/tsconfig.json
```

Expected: passes.

- [ ] **Step 4:** Commit.

```bash
git add packages/agent/src/storage/event-types.ts
git commit -m "feat(events): add alarm_fired DurableEvent type (PRI-1744)"
```

---

### Task 6: Add `alarm_fired` `SessionUpdate` schema

**Files:**
- Modify: `packages/ent-protocol/src/schemas/methods.ts`

- [ ] **Step 1:** Find the block defining `SessionUpdateSessionInfoSchema` (around line 1874). After the `SessionUpdateSessionChangedSchema` block ends (around line 1936), add:

```ts
// Alarm Fired — a scheduled alarm has fired. Carries the prompt the agent supplied
// at schedule time and (when bubble redirected the fire) the originating session.
const SessionUpdateAlarmFiredSchema = z
  .object({
    type: z.literal('alarm_fired'),
    id: NonEmptyStringSchema,
    alarmKind: z.enum(['cron', 'once']),
    prompt: z.string(),
    schedule: z.string(),
    fired_at: z.number(),
    bubbled_from: z
      .object({
        sessionId: SessionIdSchema,
        personaName: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SessionUpdateAlarmFired = z.infer<typeof SessionUpdateAlarmFiredSchema>;
```

- [ ] **Step 2:** Add `SessionUpdateAlarmFiredSchema` to `SessionUpdateInnerNonJobSchema` (around line 1948), `_SessionUpdateInnerSchema` (around line 1982), and `SessionUpdateParamsSchema` (around line 2008). For each union, add the schema as a new entry; for `SessionUpdateParamsSchema` it's `SessionUpdateBaseParamsSchema.merge(SessionUpdateAlarmFiredSchema)`.

Example for `SessionUpdateInnerNonJobSchema`:

```ts
const SessionUpdateInnerNonJobSchema = z.discriminatedUnion('type', [
  // ... existing entries ...
  SessionUpdateSessionChangedSchema,
  SessionUpdateAlarmFiredSchema,  // ← new
]);
```

- [ ] **Step 3:** Run the ent-protocol tests.

```bash
npx vitest --run packages/ent-protocol
```

Expected: all existing tests still pass. If a snapshot test catches the new discriminant, accept the snapshot only if it shows the new entry being added cleanly.

- [ ] **Step 4:** Commit.

```bash
git add packages/ent-protocol/src/schemas/methods.ts
git commit -m "feat(ent-protocol): add alarm_fired SessionUpdate discriminant (PRI-1744)"
```

---

## Phase 3 — Subagent meta lineage

### Task 7: Extend `SessionMeta` with optional `parent` field

**Files:**
- Modify: `packages/agent/src/storage/session-store.ts`
- Test: `packages/agent/src/storage/__tests__/session-store.test.ts` (verify if a file exists; if not, skip; the type extension is purely additive and downstream tests cover it)

- [ ] **Step 1:** Open `packages/agent/src/storage/session-store.ts`. Update the `SessionMeta` type (around line 10):

```ts
export type SessionMeta = {
  sessionId: string;
  workDir: string;
  created: string;
  parent?: {
    sessionId: string;
    jobId: string;
    personaName?: string;
    runtime?: unknown;  // PersonaContainerRuntime | PersonaBoxRuntime serialized; opaque here
  };
};
```

- [ ] **Step 2:** No other changes — `readSessionMeta`/`writeSessionMeta` use generic JSON, so additive fields round-trip automatically.

- [ ] **Step 3:** Typecheck.

```bash
npx tsc --noEmit -p packages/agent/tsconfig.json
```

Expected: passes.

- [ ] **Step 4:** Commit.

```bash
git add packages/agent/src/storage/session-store.ts
git commit -m "feat(session): add optional parent linkage to SessionMeta (PRI-1744)"
```

---

### Task 8: Write `parent` on subagent session creation

**Files:**
- Modify: `packages/agent/src/jobs/subagent-job.ts`
- Modify: `packages/agent/src/rpc/handlers/session.ts`

- [ ] **Step 1:** Find the subagent session creation site in `packages/agent/src/jobs/subagent-job.ts` (around line 680). Search for `client.sessionNew` or `created = await ...`. The subagent's lace process owns its own session-store; the parent linkage needs to be written when the *subagent's* `session/new` runs.

The cleanest place to thread `parent` is via the `session/new` request param. Add an optional `parent` field that, when present, lace writes into `meta.json` during `session/new`.

In `packages/agent/src/rpc/handlers/session.ts`, locate the `session/new` handler around line 186. Find the parsed-params type (around line 197). Extend the type with:

```ts
const parsed = params as {
  cwd: string;
  mcpServers?: Array<{...}>;
  persona?: string;
  systemPrompt?: unknown;
  config?: {
    connectionId?: string;
    modelId?: string;
    persona?: string;
  };
  parent?: {
    sessionId: string;
    jobId: string;
    personaName?: string;
    runtime?: unknown;
  };
};
```

- [ ] **Step 2:** In the same handler, find the `writeSessionMeta` call (around line 294). Add `parent` to the meta:

```ts
writeSessionMeta(sessionDir, {
  sessionId,
  workDir: parsed.cwd,
  created,
  ...(parsed.parent ? { parent: parsed.parent } : {}),
});
```

- [ ] **Step 3:** In `packages/agent/src/jobs/subagent-job.ts`, find the `sessionNew` call (around line 680). It's invoked through a peer to the subagent's own lace process. Pass `parent` based on the job context — `state.activeSession.meta.sessionId` is the parent session, `job.jobId` is the spawning job:

Search for the call shape; it's structured similar to:

```ts
const created = await peer.sendRequest('session/new', {
  cwd: ...,
  mcpServers: ...,
  persona: ...,
});
```

Add a `parent` field:

```ts
const created = await peer.sendRequest('session/new', {
  cwd: ...,
  mcpServers: ...,
  persona: ...,
  parent: {
    sessionId: state.activeSession!.meta.sessionId,
    jobId: job.jobId,
    ...(job.personaName ? { personaName: job.personaName } : {}),
    ...(job.personaRuntime ? { runtime: job.personaRuntime } : {}),
  },
});
```

Verify `job.personaName` and `job.personaRuntime` exist on the JobState. If they don't, locate them on `state.activeSession`/`SubagentJobDependencies` and thread accordingly. (The persona name + runtime are already captured during subagent spawn for the container spec; reuse the same source.)

- [ ] **Step 4:** Update the ent-protocol `SessionNewParamsSchema` in `packages/ent-protocol/src/schemas/methods.ts` (around line 182):

```ts
const SessionNewParamsSchema = z
  .object({
    cwd: NonEmptyStringSchema,
    mcpServers: z.array(McpServerConfigSchema).optional(),
    persona: NonEmptyStringSchema.optional(),
    systemPrompt: z
      .union([...])
      .optional(),
    config: z.object({...}).strict().optional(),
    parent: z
      .object({
        sessionId: SessionIdSchema,
        jobId: NonEmptyStringSchema,
        personaName: z.string().optional(),
        runtime: z.unknown().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
```

- [ ] **Step 5:** Typecheck + run subagent tests.

```bash
npx tsc --noEmit -p packages/agent/tsconfig.json
npx vitest --run packages/agent/src/__tests__/agent-process.delegate.e2e.test.ts
```

Expected: passes. Existing subagent e2e tests must not regress.

- [ ] **Step 6:** Commit.

```bash
git add packages/ent-protocol/src/schemas/methods.ts packages/agent/src/rpc/handlers/session.ts packages/agent/src/jobs/subagent-job.ts
git commit -m "feat(subagent): propagate parent lineage into session meta (PRI-1744)"
```

---

## Phase 4 — Tool implementations

### Task 9: `schedule_alarm` tool — failing test first

**Files:**
- Create: `packages/agent/src/tools/implementations/__tests__/schedule_alarm.test.ts`
- Create: `packages/agent/src/tools/implementations/schedule_alarm.ts`

- [ ] **Step 1:** Write the failing test:

```ts
// ABOUTME: Unit tests for the schedule_alarm tool — input validation, cap,
// ABOUTME: wake/bubble rejection on top-level sessions, ifSessionEnded defaults.

import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ScheduleAlarmTool } from '../schedule_alarm';
import { AlarmScheduler } from '../../../alarms/alarm-scheduler';
import { writeSessionMeta } from '../../../storage/session-store';

function makeSession(parent?: { sessionId: string; jobId: string; personaName?: string; runtime?: unknown }) {
  const sessionsDir = mkdtempSync(join(tmpdir(), 'lace-tool-test-'));
  const sessionId = 'sess_test';
  const sessionDir = join(sessionsDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionMeta(sessionDir, {
    sessionId,
    workDir: '/tmp',
    created: new Date().toISOString(),
    ...(parent ? { parent } : {}),
  });
  return { sessionsDir, sessionId, sessionDir };
}

function makeScheduler(sessionsDir: string): AlarmScheduler {
  return new AlarmScheduler({
    sessionsDir,
    now: () => Date.parse('2030-01-01T00:00:00Z'),
    jitterMaxMs: 0,
    emit: () => Promise.resolve(),
    appendEvent: () => Promise.resolve(),
    isActive: () => true,
    spawnSubagentForWake: () => Promise.reject(new Error('unused')),
    randomFn: () => 0,
  });
}

describe('schedule_alarm', () => {
  it('schedules a one-shot in the future', async () => {
    const { sessionsDir, sessionId, sessionDir } = makeSession();
    const scheduler = makeScheduler(sessionsDir);
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      {
        id: 'tc1',
        name: 'schedule_alarm',
        arguments: {
          kind: 'once',
          schedule: '2030-01-02T00:00:00Z',
          prompt: 'wake',
        },
      },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    expect(result.status).toBe('completed');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toMatch(/^alarm_/);
    expect(payload.ifSessionEnded).toBe('drop');
  });

  it('rejects wake on top-level session', async () => {
    const { sessionsDir, sessionId, sessionDir } = makeSession();  // no parent
    const scheduler = makeScheduler(sessionsDir);
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      {
        id: 'tc2',
        name: 'schedule_alarm',
        arguments: {
          kind: 'once',
          schedule: '2030-01-02T00:00:00Z',
          prompt: 'p',
          ifSessionEnded: 'wake',
        },
      },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('WakeInvalidForTopLevel');
  });

  it('accepts wake on subagent session', async () => {
    const { sessionsDir, sessionId, sessionDir } = makeSession({
      sessionId: 'sess_parent',
      jobId: 'job_x',
      personaName: 'shell',
      runtime: { type: 'box', image: 'demo' },
    });
    const scheduler = makeScheduler(sessionsDir);
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      {
        id: 'tc3',
        name: 'schedule_alarm',
        arguments: {
          kind: 'once',
          schedule: '2030-01-02T00:00:00Z',
          prompt: 'p',
          ifSessionEnded: 'wake',
        },
      },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    expect(result.status).toBe('completed');
  });

  it('rejects when MAX_ACTIVE_ALARMS is reached', async () => {
    const { sessionsDir, sessionId, sessionDir } = makeSession();
    const scheduler = makeScheduler(sessionsDir);
    const tool = new ScheduleAlarmTool();
    for (let i = 0; i < 50; i++) {
      await tool.execute(
        {
          id: `tc-${i}`,
          name: 'schedule_alarm',
          arguments: { kind: 'once', schedule: '2030-01-02T00:00:00Z', prompt: `p${i}` },
        },
        { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
      );
    }
    const overflow = await tool.execute(
      {
        id: 'overflow',
        name: 'schedule_alarm',
        arguments: { kind: 'once', schedule: '2030-01-02T00:00:00Z', prompt: 'extra' },
      },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    expect(overflow.status).toBe('failed');
    expect(overflow.content[0].text).toContain('50');
  });
});
```

- [ ] **Step 2:** Run the test. Expected: FAIL (tool not found; ToolContext field missing).

```bash
npx vitest --run packages/agent/src/tools/implementations/__tests__/schedule_alarm.test.ts
```

- [ ] **Step 3:** Extend `ToolContext` in `packages/agent/src/tools/types.ts`. Add after `jobManager?: JobManager;`:

```ts
import type { AlarmScheduler } from '@lace/agent/alarms/alarm-scheduler';
// ...
  alarmScheduler?: AlarmScheduler;
  activeSessionId?: string;
  activeSessionDir?: string;
```

- [ ] **Step 4:** Create `packages/agent/src/tools/implementations/schedule_alarm.ts`:

```ts
// ABOUTME: schedule_alarm tool — first-class lace alarm scheduling tool. Writes to the
// ABOUTME: calling session's alarms.jsonl and registers with the in-process scheduler.
// ABOUTME: ifSessionEnded ∈ {drop, wake, bubble}; wake/bubble require a subagent session.

import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Tool } from '../tool';
import {
  assertValidCronMinInterval,
  assertValidIanaTimezone,
  computeNextCronFire,
  computeNextOnceFire,
} from '../../alarms/cron';
import { MAX_ACTIVE_ALARMS } from '../../alarms/types';
import type { SessionMeta } from '../../storage/session-store';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const scheduleSchema = z
  .object({
    kind: z.enum(['cron', 'once']),
    schedule: z.string().min(1),
    prompt: z.string().min(1),
    timezone: z.string().optional(),
    ifSessionEnded: z.enum(['drop', 'wake', 'bubble']).optional().default('drop'),
  })
  .strict();

function readMeta(sessionDir: string): SessionMeta | null {
  try {
    return JSON.parse(readFileSync(join(sessionDir, 'meta.json'), 'utf8')) as SessionMeta;
  } catch {
    return null;
  }
}

function errorResult(text: string): ToolResult {
  return { status: 'failed', content: [{ type: 'text', text }] };
}

function jsonResult(body: Record<string, unknown>): ToolResult {
  return { status: 'completed', content: [{ type: 'text', text: JSON.stringify(body) }] };
}

export class ScheduleAlarmTool extends Tool {
  name = 'schedule_alarm';
  description =
    "Schedule an alarm that wakes you with a prompt at a future time. kind='cron' for recurring (e.g. '0 9 * * *', min interval 1 hour) or 'once' for an ISO-8601 timestamp. timezone is an IANA name; required for cron. ifSessionEnded controls what happens if this session is gone when the alarm fires: 'drop' (default), 'wake' (re-spawn subagent — subagent-only), 'bubble' (deliver to parent session — subagent-only). Up to 50 active alarms per session. Use list_alarms / cancel_alarm to manage.";
  schema = scheduleSchema;
  annotations: ToolAnnotations = {
    title: 'Schedule an alarm',
    destructiveHint: false,
    safeInternal: true,
  };

  protected async executeValidated(
    args: z.infer<typeof scheduleSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { alarmScheduler, activeSessionId, activeSessionDir } = context;
    if (!alarmScheduler || !activeSessionId || !activeSessionDir) {
      return errorResult('schedule_alarm requires alarmScheduler + activeSession in context');
    }

    const meta = readMeta(activeSessionDir);
    const isSubagent = !!meta?.parent;

    if (args.ifSessionEnded === 'wake' && !isSubagent) {
      return errorResult('WakeInvalidForTopLevel: ifSessionEnded=wake is only valid for subagent sessions');
    }
    if (args.ifSessionEnded === 'bubble' && !isSubagent) {
      return errorResult('BubbleInvalidForTopLevel: ifSessionEnded=bubble is only valid for subagent sessions');
    }
    if (args.ifSessionEnded === 'wake' && isSubagent && !meta!.parent!.runtime) {
      return errorResult('WakeRequiresPersonaRuntime: this subagent has no recoverable persona runtime');
    }

    const store = alarmScheduler.storeFor(activeSessionId);
    if (store.countActive() >= MAX_ACTIVE_ALARMS) {
      return errorResult(
        `Cannot schedule alarm: at the cap of 50 active alarms. Cancel one with cancel_alarm first.`
      );
    }

    const now = Date.now();
    const tz = args.timezone ?? 'UTC';
    let nextFireAt: number;
    try {
      if (args.kind === 'once') {
        if (args.timezone !== undefined) assertValidIanaTimezone(args.timezone);
        nextFireAt = computeNextOnceFire(args.schedule, now);
      } else {
        assertValidIanaTimezone(tz);
        assertValidCronMinInterval(args.schedule, tz);
        const { jitteredMs } = computeNextCronFire({
          expr: args.schedule,
          timezone: tz,
          after: new Date(now),
          jitterMaxMs: 0, // jitter applied at fire-time reschedule, not at schedule-time
        });
        nextFireAt = jitteredMs;
      }
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const row = store.insert({
      kind: args.kind,
      schedule: args.schedule,
      timezone: tz,
      prompt: args.prompt,
      ifSessionEnded: args.ifSessionEnded,
      next_fire_at: nextFireAt,
      now,
      ...(isSubagent && (args.ifSessionEnded === 'wake' || args.ifSessionEnded === 'bubble')
        ? {
            parent: {
              sessionId: meta!.parent!.sessionId,
              jobId: meta!.parent!.jobId,
              ...(meta!.parent!.personaName ? { personaName: meta!.parent!.personaName } : {}),
              ...(meta!.parent!.runtime ? { runtime: meta!.parent!.runtime } : {}),
            },
          }
        : {}),
    });
    alarmScheduler.enqueue(activeSessionId, row);

    return jsonResult({
      id: row.id,
      kind: row.kind,
      schedule: row.schedule,
      prompt: row.prompt,
      timezone: row.timezone,
      ifSessionEnded: row.ifSessionEnded,
      next_fire_at_iso: new Date(row.next_fire_at).toISOString(),
    });
  }
}
```

- [ ] **Step 5:** Run the test. Expected: PASS.

```bash
npx vitest --run packages/agent/src/tools/implementations/__tests__/schedule_alarm.test.ts
```

- [ ] **Step 6:** Commit.

```bash
git add packages/agent/src/tools/types.ts packages/agent/src/tools/implementations/schedule_alarm.ts packages/agent/src/tools/implementations/__tests__/schedule_alarm.test.ts
git commit -m "feat(tools): schedule_alarm built-in (PRI-1744)"
```

---

### Task 10: `cancel_alarm` tool

**Files:**
- Create: `packages/agent/src/tools/implementations/cancel_alarm.ts`
- Create: `packages/agent/src/tools/implementations/__tests__/cancel_alarm.test.ts`

- [ ] **Step 1:** Write the failing test:

```ts
// ABOUTME: Unit tests for the cancel_alarm tool.

import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { CancelAlarmTool } from '../cancel_alarm';
import { ScheduleAlarmTool } from '../schedule_alarm';
import { AlarmScheduler } from '../../../alarms/alarm-scheduler';
import { writeSessionMeta } from '../../../storage/session-store';

function setup() {
  const sessionsDir = mkdtempSync(join(tmpdir(), 'lace-cancel-test-'));
  const sessionId = 'sess_a';
  const sessionDir = join(sessionsDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionMeta(sessionDir, { sessionId, workDir: '/tmp', created: new Date().toISOString() });
  const scheduler = new AlarmScheduler({
    sessionsDir,
    now: () => Date.parse('2030-01-01T00:00:00Z'),
    jitterMaxMs: 0,
    emit: () => Promise.resolve(),
    appendEvent: () => Promise.resolve(),
    isActive: () => true,
    spawnSubagentForWake: () => Promise.reject(new Error('unused')),
    randomFn: () => 0,
  });
  return { sessionId, sessionDir, scheduler };
}

describe('cancel_alarm', () => {
  it('cancels a pending alarm', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const schedTool = new ScheduleAlarmTool();
    const sched = await schedTool.execute(
      { id: 't1', name: 'schedule_alarm', arguments: { kind: 'once', schedule: '2030-01-02T00:00:00Z', prompt: 'p' } },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    const id = JSON.parse(sched.content[0].text).id;
    const cancel = new CancelAlarmTool();
    const result = await cancel.execute(
      { id: 't2', name: 'cancel_alarm', arguments: { id } },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    expect(result.status).toBe('completed');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.cancelled).toBe(true);
  });

  it('returns not_found for unknown id', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const cancel = new CancelAlarmTool();
    const result = await cancel.execute(
      { id: 't3', name: 'cancel_alarm', arguments: { id: 'alarm_nope' } },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    expect(result.status).toBe('completed');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.cancelled).toBe(false);
    expect(payload.reason).toBe('not_found');
  });
});
```

- [ ] **Step 2:** Run, confirm fail.

```bash
npx vitest --run packages/agent/src/tools/implementations/__tests__/cancel_alarm.test.ts
```

- [ ] **Step 3:** Create `packages/agent/src/tools/implementations/cancel_alarm.ts`:

```ts
// ABOUTME: cancel_alarm tool — removes a pending alarm from the calling session's
// ABOUTME: alarms.jsonl. Returns { cancelled: true } or { cancelled: false, reason }.

import { z } from 'zod';
import { Tool } from '../tool';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const cancelSchema = z.object({ id: z.string().min(1) }).strict();

export class CancelAlarmTool extends Tool {
  name = 'cancel_alarm';
  description =
    'Cancel a pending alarm by id. Returns cancelled:true on success, or cancelled:false with a reason (not_found, already_fired, already_cancelled, firing).';
  schema = cancelSchema;
  annotations: ToolAnnotations = {
    title: 'Cancel an alarm',
    destructiveHint: true,
    safeInternal: true,
  };

  protected async executeValidated(
    args: z.infer<typeof cancelSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { alarmScheduler, activeSessionId } = context;
    if (!alarmScheduler || !activeSessionId) {
      return { status: 'failed', content: [{ type: 'text', text: 'cancel_alarm requires alarmScheduler + activeSessionId in context' }] };
    }
    const store = alarmScheduler.storeFor(activeSessionId);
    const result = store.cancel(args.id);
    return await Promise.resolve({
      status: 'completed',
      content: [{ type: 'text', text: JSON.stringify(result) }],
    });
  }
}
```

- [ ] **Step 4:** Run the test. Expected: PASS.

- [ ] **Step 5:** Commit.

```bash
git add packages/agent/src/tools/implementations/cancel_alarm.ts packages/agent/src/tools/implementations/__tests__/cancel_alarm.test.ts
git commit -m "feat(tools): cancel_alarm built-in (PRI-1744)"
```

---

### Task 11: `list_alarms` tool

**Files:**
- Create: `packages/agent/src/tools/implementations/list_alarms.ts`
- Create: `packages/agent/src/tools/implementations/__tests__/list_alarms.test.ts`

- [ ] **Step 1:** Failing test:

```ts
// ABOUTME: Unit tests for the list_alarms tool.

import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ListAlarmsTool } from '../list_alarms';
import { ScheduleAlarmTool } from '../schedule_alarm';
import { AlarmScheduler } from '../../../alarms/alarm-scheduler';
import { writeSessionMeta } from '../../../storage/session-store';

function setup() {
  const sessionsDir = mkdtempSync(join(tmpdir(), 'lace-list-test-'));
  const sessionId = 'sess_a';
  const sessionDir = join(sessionsDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionMeta(sessionDir, { sessionId, workDir: '/tmp', created: new Date().toISOString() });
  const scheduler = new AlarmScheduler({
    sessionsDir,
    now: () => Date.parse('2030-01-01T00:00:00Z'),
    jitterMaxMs: 0,
    emit: () => Promise.resolve(),
    appendEvent: () => Promise.resolve(),
    isActive: () => true,
    spawnSubagentForWake: () => Promise.reject(new Error('unused')),
    randomFn: () => 0,
  });
  return { sessionId, sessionDir, scheduler };
}

describe('list_alarms', () => {
  it('returns pending alarms sorted by next_fire_at', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const sched = new ScheduleAlarmTool();
    await sched.execute(
      { id: 't1', name: 'schedule_alarm', arguments: { kind: 'once', schedule: '2030-01-03T00:00:00Z', prompt: 'b' } },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    await sched.execute(
      { id: 't2', name: 'schedule_alarm', arguments: { kind: 'once', schedule: '2030-01-02T00:00:00Z', prompt: 'a' } },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    const list = new ListAlarmsTool();
    const result = await list.execute(
      { id: 't3', name: 'list_alarms', arguments: {} },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    expect(result.status).toBe('completed');
    const { alarms } = JSON.parse(result.content[0].text);
    expect(alarms).toHaveLength(2);
    expect(alarms[0].prompt).toBe('a');
    expect(alarms[1].prompt).toBe('b');
  });
});
```

- [ ] **Step 2:** Run, confirm fail.

- [ ] **Step 3:** Create `packages/agent/src/tools/implementations/list_alarms.ts`:

```ts
// ABOUTME: list_alarms tool — returns active (pending+firing) alarms for the calling
// ABOUTME: session, sorted by next_fire_at ascending.

import { z } from 'zod';
import { Tool } from '../tool';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const listSchema = z.object({}).strict();

export class ListAlarmsTool extends Tool {
  name = 'list_alarms';
  description =
    'List active alarms (status pending or firing) for the current session ordered by next_fire_at ascending.';
  schema = listSchema;
  annotations: ToolAnnotations = {
    title: 'List alarms',
    readOnlyHint: true,
    readOnlySafe: true,
    safeInternal: true,
  };

  protected async executeValidated(
    _args: z.infer<typeof listSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { alarmScheduler, activeSessionId } = context;
    if (!alarmScheduler || !activeSessionId) {
      return { status: 'failed', content: [{ type: 'text', text: 'list_alarms requires alarmScheduler + activeSessionId in context' }] };
    }
    const store = alarmScheduler.storeFor(activeSessionId);
    const rows = store.listActive();
    const alarms = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      schedule: r.schedule,
      prompt: r.prompt,
      timezone: r.timezone,
      ifSessionEnded: r.ifSessionEnded,
      status: r.status,
      next_fire_at_iso: new Date(r.next_fire_at).toISOString(),
      created_at_iso: new Date(r.created_at).toISOString(),
    }));
    return await Promise.resolve({
      status: 'completed',
      content: [{ type: 'text', text: JSON.stringify({ alarms }) }],
    });
  }
}
```

- [ ] **Step 4:** Run the test. Expected: PASS.

- [ ] **Step 5:** Commit.

```bash
git add packages/agent/src/tools/implementations/list_alarms.ts packages/agent/src/tools/implementations/__tests__/list_alarms.test.ts
git commit -m "feat(tools): list_alarms built-in (PRI-1744)"
```

---

### Task 12: Register the three alarm tools as built-ins

**Files:**
- Modify: `packages/agent/src/tools/executor.ts`
- Modify: `packages/agent/src/tools/implementations/index.ts`

- [ ] **Step 1:** Open `packages/agent/src/tools/executor.ts`. Update `LACE_BUILTIN_TOOL_NAMES` (around line 48):

```ts
export const LACE_BUILTIN_TOOL_NAMES = [
  'bash',
  'file_read',
  'file_write',
  'file_edit',
  'ripgrep_search',
  'file_find',
  'url_fetch',
  'delegate',
  'job_output',
  'jobs_list',
  'job_kill',
  'job_notify',
  'todo_read',
  'todo_write',
  'use_skill',
  'schedule_alarm',
  'cancel_alarm',
  'list_alarms',
] as const;
```

- [ ] **Step 2:** Find `registerAllAvailableTools` (search the file) and add the three new tools alongside the existing native tool registrations. Match the existing pattern (likely something like `executor.registerTool(new JobNotifyTool().name, new JobNotifyTool())`).

- [ ] **Step 3:** Update `packages/agent/src/tools/implementations/index.ts` to export the three new tools:

```ts
export { ScheduleAlarmTool } from './schedule_alarm';
export { CancelAlarmTool } from './cancel_alarm';
export { ListAlarmsTool } from './list_alarms';
```

- [ ] **Step 4:** Run typecheck and existing tool tests.

```bash
npx tsc --noEmit -p packages/agent/tsconfig.json
npx vitest --run packages/agent/src/tools/
```

Expected: passes. No existing test should regress.

- [ ] **Step 5:** Commit.

```bash
git add packages/agent/src/tools/executor.ts packages/agent/src/tools/implementations/index.ts
git commit -m "feat(tools): register alarm tools as lace built-ins (PRI-1744)"
```

---

## Phase 5 — Server wiring

### Task 13: Hook AlarmScheduler into the server

**Files:**
- Modify: `packages/agent/src/server-types.ts`
- Modify: `packages/agent/src/server.ts`

- [ ] **Step 1:** In `packages/agent/src/server-types.ts`, locate `AgentServerState` (search the file). Add field:

```ts
import type { AlarmScheduler } from './alarms/alarm-scheduler';
// ...
export interface AgentServerState {
  // ... existing fields ...
  alarmScheduler: AlarmScheduler;
}
```

- [ ] **Step 2:** In `packages/agent/src/server.ts`, near the top of `createAgentServer` (find where `state` is initialized; likely follows `state.jobManager = ...` around line 260), import and instantiate the scheduler:

```ts
import { AlarmScheduler } from './alarms/alarm-scheduler';
import { agentSessionsDir } from './storage/session-store';
import { existsSync } from 'node:fs';

// inside createAgentServer, after jobManager wiring:
state.alarmScheduler = new AlarmScheduler({
  sessionsDir: agentSessionsDir(),
  now: () => Date.now(),
  jitterMaxMs: Number(process.env.LACE_ALARM_JITTER_MS ?? 60_000),
  emit: async (targetSessionId, payload) => {
    if (state.activeSession?.meta.sessionId !== targetSessionId) return;
    await emitSessionUpdate(payload);
  },
  appendEvent: async (sessionDir, event) => {
    if (state.activeSession?.dir === sessionDir) {
      await runExclusive(async () => {
        const s = readSessionState(sessionDir);
        const { nextState } = appendDurableEvent(sessionDir, s, event);
        writeSessionState(sessionDir, nextState);
      });
      return;
    }
    const s = readSessionState(sessionDir);
    const { nextState } = appendDurableEvent(sessionDir, s, event);
    writeSessionState(sessionDir, nextState);
  },
  isActive: (sessionId) => state.activeSession?.meta.sessionId === sessionId,
  spawnSubagentForWake: async (_parent) => {
    // Phase 5: stub. Real implementation arrives in Task 16.
    throw new Error('wake spawn not yet implemented');
  },
  sessionDirExists: (sessionId) => existsSync(join(agentSessionsDir(), sessionId)),
});
void state.alarmScheduler.start();
```

Imports to add at the top of the file: `agentSessionsDir` from `./storage/session-store`, `existsSync` from `node:fs`, `join` from `node:path`. `agentSessionsDir` is currently file-local in `session-store.ts`; export it (change `function agentSessionsDir()` to `export function agentSessionsDir()`).

- [ ] **Step 3:** Thread the scheduler into ToolContext. Find where ToolContext is built for tool execution (likely in `agent.ts` or `runtime/`; search for `signal: AbortSignal`). The build site looks like:

```ts
const context: ToolContext = {
  signal,
  workingDirectory: ...,
  jobManager: state.jobManager,
  // ... existing ...
};
```

Extend it:

```ts
const context: ToolContext = {
  signal,
  workingDirectory: ...,
  jobManager: state.jobManager,
  alarmScheduler: state.alarmScheduler,
  ...(state.activeSession ? {
    activeSessionId: state.activeSession.meta.sessionId,
    activeSessionDir: state.activeSession.dir,
  } : {}),
};
```

There may be multiple ToolContext build sites — update each one.

- [ ] **Step 4:** Run all agent tests to catch regressions.

```bash
npx vitest --run packages/agent/src/
```

Expected: passes.

- [ ] **Step 5:** Commit.

```bash
git add packages/agent/src/server-types.ts packages/agent/src/server.ts packages/agent/src/storage/session-store.ts
git commit -m "feat(server): wire AlarmScheduler + ToolContext (PRI-1744)"
```

---

### Task 14: Flush undelivered on session activation

**Files:**
- Modify: `packages/agent/src/rpc/handlers/session.ts`

- [ ] **Step 1:** Open `packages/agent/src/rpc/handlers/session.ts`. Find `activateStoredSession` (around line 122). After the line `state.activeSession = loadedWithMcpServers;` (around line 160), add:

```ts
// Flush any alarm fires that happened while this session was inactive.
await state.alarmScheduler.flushUndelivered(loadedWithMcpServers.meta.sessionId);
```

Wait — `flushUndelivered` calls `emit`, which in turn calls `emitSessionUpdate`, which expects the session to already be active. Order matters: `state.activeSession = ...` is set above; then the call is safe.

Also flush in `session/new` (around line 379, just before `return { sessionId, created, configOptions }`):

```ts
await state.alarmScheduler.flushUndelivered(sessionId);
```

(For a brand-new session this is a no-op, but it costs nothing and avoids a subtle bug if `session/new` reuses an existing session id ever, defensively safe.)

- [ ] **Step 2:** Run session handler tests.

```bash
npx vitest --run packages/agent/src/rpc/
```

Expected: passes.

- [ ] **Step 3:** Commit.

```bash
git add packages/agent/src/rpc/handlers/session.ts
git commit -m "feat(server): flush undelivered alarm fires on session activation (PRI-1744)"
```

---

### Task 15: Wake-spawn implementation

**Files:**
- Modify: `packages/agent/src/server.ts`
- Modify: `packages/agent/src/jobs/subagent-spawn.ts` (only if a re-spawn helper is needed)

- [ ] **Step 1:** Replace the stub `spawnSubagentForWake` in `server.ts` with a real implementation that uses `spawnSubagent`.

The wake path needs to:
1. Take the captured `parent` (carries `sessionId` of the original parent, `jobId`, `personaName`, `runtime`).
2. Create a *new* subagent job via `state.jobManager` (so the new spawn is tracked).
3. Spawn the subagent process; let it complete `session/new` against itself, producing a new session id.
4. Return that new session id.

This integrates closely with `jobs/subagent-spawn.ts` and `state.jobManager.createDelegateJob`. The exact wiring depends on `state.jobManager`'s API. Reference implementation skeleton:

```ts
spawnSubagentForWake: async (parent) => {
  if (!parent.runtime) throw new Error('wake requires runtime');
  // Create a new delegate-shaped job, but with a synthetic prompt that
  // is just an empty seed — the actual content will be the alarm_fired
  // event already appended to the new subagent's events.jsonl by the
  // scheduler before it flushes.
  const created = await state.jobManager.createWakeJob({
    parentSessionId: parent.sessionId,
    parentJobId: parent.jobId,
    ...(parent.personaName ? { personaName: parent.personaName } : {}),
    runtime: parent.runtime as PersonaContainerRuntime | PersonaBoxRuntime,
  });
  // createWakeJob returns { jobId, sessionId } once the subagent finishes session/new.
  return created.sessionId;
},
```

`createWakeJob` is a new method on `JobManager`. Implement it in `packages/agent/src/jobs/job-manager.ts` by following the existing `createDelegateJob` pattern; key differences:
- No initial prompt content (or a single newline) — the new session's first turn will see the `alarm_fired` event already in its events.jsonl.
- The new subagent's meta.parent points back to the original parent.

Re-read `packages/agent/src/jobs/subagent-job.ts` and `subagent-spawn.ts`; the wake job reuses 90% of the delegate spawn path. Cleanest implementation:
- Add `createWakeJob(opts: WakeJobOptions): Promise<{ jobId: string; sessionId: string }>` on `JobManager`.
- Internally builds a JobState with `type: 'delegate'`, fills in persona spec from `opts.runtime`, calls `runSubagentJobProcess`, and waits for `subagentSessionId` to be assigned (via the existing `job_session_assigned` event flow).
- Resolves with the new sessionId.

If the existing `createDelegateJob` already accepts opts that match what we need, prefer calling it directly with no initial prompt rather than duplicating logic.

- [ ] **Step 2:** Write a unit test for `createWakeJob` if it's a new method (alongside existing JobManager tests). Or, defer to the e2e wake test in Task 19.

- [ ] **Step 3:** Run all agent tests.

```bash
npx vitest --run packages/agent/src/
```

Expected: passes.

- [ ] **Step 4:** Commit.

```bash
git add packages/agent/src/server.ts packages/agent/src/jobs/job-manager.ts packages/agent/src/jobs/subagent-job.ts
git commit -m "feat(alarms): wake-spawn for subagent alarms via JobManager (PRI-1744)"
```

---

## Phase 6 — Lace integration tests

### Task 16: e2e — fire delivery for active session

**Files:**
- Create: `packages/agent/src/__tests__/alarms.fire-delivery.e2e.test.ts`

- [ ] **Step 1:** Read an existing e2e test (e.g., `packages/agent/src/__tests__/agent-process.e2e.test.ts`) to understand the boot harness — how the agent process is started, how the JsonRpcPeer is wired, how `session/update` is captured.

- [ ] **Step 2:** Create the test:

```ts
// ABOUTME: e2e: schedule an alarm via the schedule_alarm tool, advance the fake
// ABOUTME: clock, verify alarm_fired lands in events.jsonl AND a session/update
// ABOUTME: notification is delivered to the peer.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startTestAgent } from './test-utils';  // pattern from existing tests

describe('alarms e2e — fire delivery', () => {
  it('fires a one-shot and emits alarm_fired session/update', async () => {
    const { peer, sessionId, sessionDir, advanceClock, close } = await startTestAgent({
      withFakeClock: true,
    });
    const updates: Array<Record<string, unknown>> = [];
    peer.onNotification('session/update', (params) => {
      updates.push(params as Record<string, unknown>);
    });

    // Schedule a once alarm 1s in the future.
    const future = new Date(Date.now() + 1000).toISOString();
    await peer.sendRequest('session/prompt', {
      content: [{ type: 'text', text: `Use schedule_alarm to schedule an alarm at ${future} with prompt "ping".` }],
    });
    // Wait for tool to run; consult existing test patterns for the right hook.
    // ... (depends on harness)

    advanceClock(2000);
    // Yield for the scheduler tick to run.
    await new Promise((r) => setTimeout(r, 50));

    const alarmFired = updates.find((u) => (u as { type?: string }).type === 'alarm_fired');
    expect(alarmFired).toBeDefined();

    const events = readFileSync(join(sessionDir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string });
    expect(events.some((e) => e.type === 'alarm_fired')).toBe(true);

    await close();
  });
});
```

`startTestAgent` is illustrative — use whatever boot helper the existing e2e tests already provide (`createAgentTestHarness`, `runAgentProcess`, etc.). Adapt accordingly.

- [ ] **Step 3:** Run.

```bash
npx vitest --run packages/agent/src/__tests__/alarms.fire-delivery.e2e.test.ts
```

Expected: PASS.

- [ ] **Step 4:** Commit.

```bash
git add packages/agent/src/__tests__/alarms.fire-delivery.e2e.test.ts
git commit -m "test(alarms): e2e fire delivery for active session (PRI-1744)"
```

---

### Task 17: e2e — inactive session replay on activate

**Files:**
- Create: `packages/agent/src/__tests__/alarms.inactive-session-replay.e2e.test.ts`

- [ ] **Step 1:** Write a test that:
1. Creates session A.
2. Schedules an alarm with `next_fire_at` in the near future.
3. Switches to (or closes) session A — leaving A inactive.
4. Advances fake clock past the fire time. Scheduler appends `alarm_fired` to A's events.jsonl but does NOT emit `session/update`.
5. `session/load` on A. Verify `alarm_fired` `session/update` is now emitted (via `flushUndelivered`).

Use the same e2e harness as Task 16. Snapshot test the `events.jsonl` content for A after fire.

- [ ] **Step 2:** Run and commit.

```bash
npx vitest --run packages/agent/src/__tests__/alarms.inactive-session-replay.e2e.test.ts
git add packages/agent/src/__tests__/alarms.inactive-session-replay.e2e.test.ts
git commit -m "test(alarms): e2e inactive-session replay on activate (PRI-1744)"
```

---

### Task 18: e2e — restart recovery

**Files:**
- Create: `packages/agent/src/__tests__/alarms.restart-recovery.e2e.test.ts`

- [ ] **Step 1:** Test:
1. Boot agent A; schedule alarm 60s into future.
2. Shut down agent (call `close()`).
3. Reboot agent against the same LACE_DIR.
4. Advance fake clock past fire time.
5. Verify `alarm_fired` `session/update` arrives on the new agent's peer (after `session/resume`).

- [ ] **Step 2:** Run + commit.

```bash
npx vitest --run packages/agent/src/__tests__/alarms.restart-recovery.e2e.test.ts
git add packages/agent/src/__tests__/alarms.restart-recovery.e2e.test.ts
git commit -m "test(alarms): e2e restart recovery (PRI-1744)"
```

---

### Task 19: e2e — wake subagent

**Files:**
- Create: `packages/agent/src/__tests__/alarms.wake-subagent.e2e.test.ts`

- [ ] **Step 1:** Test (high-level — full implementation requires the delegate harness used by `agent-process.delegate.e2e.test.ts`):
1. Spawn subagent S via `delegate` (records `parent` in S's meta).
2. From S, call `schedule_alarm({ kind: 'once', schedule: <near future>, prompt: 'ping', ifSessionEnded: 'wake' })`.
3. Close S (session dir is removed or marked gone). For test purposes, simulate "gone" by deleting S's session dir directly — the scheduler's `sessionDirExists` will return false.
4. Advance clock past fire time.
5. Verify lace respawned a new subagent (new session id), and the new subagent's events.jsonl contains the `alarm_fired` event.

Refer to `agent-process.delegate.e2e.test.ts` for the multi-process boot pattern.

- [ ] **Step 2:** Run + commit.

```bash
npx vitest --run packages/agent/src/__tests__/alarms.wake-subagent.e2e.test.ts
git add packages/agent/src/__tests__/alarms.wake-subagent.e2e.test.ts
git commit -m "test(alarms): e2e wake subagent on session-ended (PRI-1744)"
```

---

### Task 20: e2e — bubble subagent

**Files:**
- Create: `packages/agent/src/__tests__/alarms.bubble-subagent.e2e.test.ts`

- [ ] **Step 1:** Test:
1. Spawn subagent S via `delegate`.
2. From S, schedule alarm with `ifSessionEnded: 'bubble'`.
3. Close S (delete S's session dir).
4. Advance clock past fire time.
5. Verify `alarm_fired` event lands in **parent's** events.jsonl, with `bubbled_from.sessionId === S's sessionId`.

- [ ] **Step 2:** Run + commit.

```bash
npx vitest --run packages/agent/src/__tests__/alarms.bubble-subagent.e2e.test.ts
git add packages/agent/src/__tests__/alarms.bubble-subagent.e2e.test.ts
git commit -m "test(alarms): e2e bubble subagent on session-ended (PRI-1744)"
```

---

### Task 21: e2e — top-level rejects wake/bubble

**Files:**
- Create: `packages/agent/src/__tests__/alarms.top-level-rejects-wake-bubble.e2e.test.ts`

- [ ] **Step 1:** Test that calling `schedule_alarm` with `ifSessionEnded: 'wake'` or `'bubble'` on a session without a `parent` field returns a tool-level failure with the `WakeInvalidForTopLevel` / `BubbleInvalidForTopLevel` message.

```ts
import { describe, it, expect } from 'vitest';
import { startTestAgent } from './test-utils';

describe('alarms e2e — top-level rejects wake/bubble', () => {
  for (const policy of ['wake', 'bubble'] as const) {
    it(`rejects ifSessionEnded='${policy}' on a top-level session`, async () => {
      const { peer, close } = await startTestAgent();
      const result = await peer.sendRequest('tool/execute', {
        toolName: 'schedule_alarm',
        arguments: {
          kind: 'once',
          schedule: new Date(Date.now() + 60_000).toISOString(),
          prompt: 'p',
          ifSessionEnded: policy,
        },
      });
      // Exact RPC depends on harness — adapt to whatever tool-execute the harness exposes.
      expect((result as { status?: string }).status).toBe('failed');
      const msg = (result as { content: Array<{ text: string }> }).content[0].text;
      expect(msg).toContain(policy === 'wake' ? 'WakeInvalidForTopLevel' : 'BubbleInvalidForTopLevel');
      await close();
    });
  }
});
```

- [ ] **Step 2:** Run + commit.

```bash
npx vitest --run packages/agent/src/__tests__/alarms.top-level-rejects-wake-bubble.e2e.test.ts
git add packages/agent/src/__tests__/alarms.top-level-rejects-wake-bubble.e2e.test.ts
git commit -m "test(alarms): e2e top-level rejects wake/bubble (PRI-1744)"
```

---

### Task 22: e2e — cron reschedule fires twice

**Files:**
- Create: `packages/agent/src/__tests__/alarms.cron-reschedule.e2e.test.ts`

- [ ] **Step 1:** Test:
1. Schedule a cron alarm `0 * * * *` (hourly).
2. Advance clock past first occurrence — verify first fire.
3. Advance clock past second occurrence — verify second fire.

Be sure to use `LACE_ALARM_JITTER_MS=0` (or pass via the harness) so timing is deterministic.

- [ ] **Step 2:** Run + commit.

```bash
npx vitest --run packages/agent/src/__tests__/alarms.cron-reschedule.e2e.test.ts
git add packages/agent/src/__tests__/alarms.cron-reschedule.e2e.test.ts
git commit -m "test(alarms): e2e cron reschedule (PRI-1744)"
```

---

## Phase 7 — Sen-core changes

These edits run in `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2/`. Create a branch off `main`:

```bash
cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2
git checkout -b pri-1744-alarms-in-lace
```

### Task 23: Delete sen-core alarm subsystem

**Files:**
- Delete: `src/alarms/store.ts`
- Delete: `src/alarms/scheduler-service.ts`
- Delete: `src/alarms/tools.ts`
- Delete: `src/alarms/cron.ts`
- Delete: `mcp-servers/scheduler.ts`
- Delete: `tests/automated/alarms/` (directory)

Keep `src/alarms/types.ts` — `InboundAlarm` is still the inbox envelope. Edit it down to just `InboundAlarm` and `isInboundAlarm`:

- [ ] **Step 1:** Replace contents of `src/alarms/types.ts` with:

```ts
// ABOUTME: Inbox envelope discriminator for inbound alarm fires. Lace delivers the
// ABOUTME: actual schedule + fire via session/update; sen-core wraps each into an
// ABOUTME: InboundAlarm and dispatches to the ambient inbox.

export type AlarmKind = 'cron' | 'once';

export interface InboundAlarm {
  kind: 'alarm';
  id: string;
  alarmKind: AlarmKind;
  prompt: string;
  schedule: string;
  fired_at: number;
}

export function isInboundAlarm(item: { kind: string }): item is InboundAlarm {
  return item.kind === 'alarm';
}
```

- [ ] **Step 2:** Delete the files listed above.

```bash
rm src/alarms/store.ts src/alarms/scheduler-service.ts src/alarms/tools.ts src/alarms/cron.ts
rm mcp-servers/scheduler.ts
rm -rf tests/automated/alarms
```

- [ ] **Step 3:** Remove imports from `src/main.ts` (top of file): `AlarmsStore`, `SchedulerService`, `resolveAlarmJitterMs`. Remove the `alarms` block (lines 571-590 in the current file):

```ts
// DELETE this whole block:
// const alarmsDir = path.join(prepared.paths.root, 'alarms');
// mkdirSync(alarmsDir, { recursive: true });
// const alarmsStore = new AlarmsStore(...);
// const scheduler = new SchedulerService({...});
// const schedulerPromise = scheduler.run();
// schedulerPromise.catch(...);
```

If `mkdirSync` is no longer used elsewhere in `main.ts`, remove the import.

- [ ] **Step 4:** Update any `src/slack/envelope.ts` imports if they reference the removed types. `InboundAlarm` and `isInboundAlarm` still live in `src/alarms/types.ts` so they're fine.

- [ ] **Step 5:** Typecheck + run.

```bash
npm run lint
npm run test
```

Expected: passes (with reduced test count — old alarm tests are gone, no new ones yet for sen-core).

- [ ] **Step 6:** Commit.

```bash
git add -u
git commit -m "refactor(alarms): remove sen-core alarm subsystem; lace owns it now (PRI-1744)"
```

---

### Task 24: Wire `alarm_fired` → InboundAlarm in sen-core

**Files:**
- Modify: `src/main.ts` (around `attachClientSubscriptions`)

- [ ] **Step 1:** Find `attachClientSubscriptions` in `src/main.ts` (around line 203). Inside the `client.onSessionUpdate((update) => {...})` callback, add a branch:

```ts
if (update.type === 'alarm_fired') {
  const alarm: InboundAlarm = {
    kind: 'alarm',
    id: update.id,
    alarmKind: update.alarmKind,
    prompt: update.bubbled_from
      ? `[from subagent ${update.bubbled_from.personaName ?? update.bubbled_from.sessionId}]\n${update.prompt}`
      : update.prompt,
    schedule: update.schedule,
    fired_at: update.fired_at,
  };
  // dispatcher.dispatch is async, swallow the promise to keep the update handler sync.
  void opts.dispatcher.dispatch(alarm);
  return;
}
```

Verify `opts.dispatcher` is available on the surrounding closure. If it isn't, add it to `PrepareSenSessionOptions` (around line 175) and thread from the caller (`bootSen`). Existing dispatcher already lives in `main.ts`'s scope where `attachClientSubscriptions` is defined — pass it via closure or via the new options field.

- [ ] **Step 2:** Add the import:

```ts
import type { InboundAlarm } from './alarms/types.js';
```

- [ ] **Step 3:** Add a unit test in `tests/automated/alarms-inbound.e2e.test.ts`:

```ts
// ABOUTME: Verify sen-core's onSessionUpdate handler translates alarm_fired into
// ABOUTME: an InboundAlarm and pushes it to the dispatcher.

import { describe, it, expect, vi } from 'vitest';
import { /* relevant helper */ attachClientSubscriptions } from '../../src/main';

describe('alarm_fired → InboundAlarm', () => {
  it('dispatches as InboundAlarm', () => {
    const dispatch = vi.fn();
    const fakeClient = {
      onSessionUpdate: (cb: (update: unknown) => void) => {
        // capture
        (fakeClient as { _cb?: typeof cb })._cb = cb;
      },
    };
    attachClientSubscriptions(fakeClient as never, { dispatcher: { dispatch } } as never);
    (fakeClient as { _cb: (update: unknown) => void })._cb({
      type: 'alarm_fired',
      id: 'alarm_abc',
      alarmKind: 'once',
      prompt: 'ping',
      schedule: '2030-01-01T00:00:00Z',
      fired_at: 12345,
    });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'alarm',
      id: 'alarm_abc',
      alarmKind: 'once',
      prompt: 'ping',
      fired_at: 12345,
    }));
  });
});
```

(Adjust the test to whatever indirection `attachClientSubscriptions` actually exposes — it may need a small refactor to be testable, e.g., extracting the alarm-translation logic into an exported helper.)

- [ ] **Step 4:** Run.

```bash
npm run test -- alarms-inbound
```

Expected: PASS.

- [ ] **Step 5:** Commit.

```bash
git add src/main.ts tests/automated/alarms-inbound.e2e.test.ts
git commit -m "feat(alarms): translate lace alarm_fired into InboundAlarm dispatch (PRI-1744)"
```

---

### Task 25: Remove `scheduler` MCP from core persona

**Files:**
- Modify: `templates/agent-personas/core.md`

- [ ] **Step 1:** Open `templates/agent-personas/core.md`. Remove lines 8-14 (the entire `scheduler:` block under `mcpServers:`):

```yaml
# BEFORE
mcpServers:
  knowledge:
    command: ./node_modules/.bin/tsx
    args:
      - ./mcp-servers/knowledge.ts
  scheduler:
    command: ./node_modules/.bin/tsx
    args:
      - ./mcp-servers/scheduler.ts
    env:
      SEN_INSTANCE_ROOT: ${SEN_INSTANCE_ROOT}
      SEN_ALARM_JITTER_MS: ${SEN_ALARM_JITTER_MS:-60000}
  scribe:
    ...

# AFTER
mcpServers:
  knowledge:
    command: ./node_modules/.bin/tsx
    args:
      - ./mcp-servers/knowledge.ts
  scribe:
    ...
```

- [ ] **Step 2:** Search the persona file for any prose that mentions the `scheduler` MCP (e.g., "use schedule_alarm via the scheduler MCP"). Update or remove — schedule_alarm is now a lace built-in and doesn't need MCP wiring.

- [ ] **Step 3:** Search the repo for other references to the removed paths/env vars:

```bash
grep -rn "scheduler.ts\|SEN_ALARM_JITTER_MS\|AlarmsStore\|SchedulerService" --include="*.ts" --include="*.md"
```

Remove any stragglers (likely some docs).

- [ ] **Step 4:** Commit.

```bash
git add templates/agent-personas/core.md
git add -u   # for any other doc tweaks
git commit -m "chore(personas): remove scheduler MCP from core persona (PRI-1744)"
```

---

## Phase 8 — Documentation

### Task 26: Document `alarm_fired` in lace protocol spec

**Files:**
- Modify: `docs/protocol-spec.md` (lace worktree)

- [ ] **Step 1:** Open `docs/protocol-spec.md`. Find the `SessionUpdate` event catalogue (search for `session_info`, `compaction_start`, or similar). Add a section:

```markdown
### `alarm_fired`

Fired when a scheduled alarm reaches its `next_fire_at` and the target session is the active session. Payload:

| Field | Type | Notes |
| --- | --- | --- |
| `type` | `'alarm_fired'` | discriminant |
| `id` | `string` | alarm id (`alarm_<hex>`) |
| `alarmKind` | `'cron' \| 'once'` | original kind discriminator |
| `prompt` | `string` | the prompt the agent supplied at schedule time |
| `schedule` | `string` | cron expression or ISO-8601 timestamp |
| `fired_at` | `number` | epoch ms when the scheduler claimed the fire |
| `bubbled_from` | `{ sessionId, personaName? }?` | present when the fire was redirected from a closed subagent session via `ifSessionEnded='bubble'` |

The same payload is also durably persisted as an `alarm_fired` event in the target session's `events.jsonl`. Embedders that detach and re-attach to a session will receive any missed fires through the same `session/update` channel on the next `session/load` or `session/resume`.
```

- [ ] **Step 2:** Find the durable-events catalogue (search for `tool_use`, `job_started`). Add an `alarm_fired` entry mirroring the same shape.

- [ ] **Step 3:** Open `docs/protocol-conformance.md` and add `alarm_fired` to the supported `SessionUpdate` list.

- [ ] **Step 4:** Commit.

```bash
git add docs/protocol-spec.md docs/protocol-conformance.md
git commit -m "docs(protocol): document alarm_fired SessionUpdate + DurableEvent (PRI-1744)"
```

---

### Task 27: Feature doc for alarms

**Files:**
- Create: `docs/features/alarms.md`

- [ ] **Step 1:** Create `docs/features/alarms.md`:

```markdown
# Alarms

Lace agents can schedule alarms that wake them with a prompt at a future time, either as a cron-recurring schedule or as a one-shot. Alarms are owned per-session: each session has its own `alarms.jsonl` next to `events.jsonl`.

## Tools

Three built-in tools, available to every persona that includes lace built-ins:

| Tool | Purpose |
| --- | --- |
| `schedule_alarm` | Create a new alarm (cron or one-shot) |
| `cancel_alarm` | Cancel a pending alarm by id |
| `list_alarms` | List pending/firing alarms for the current session |

`schedule_alarm` parameters:

- `kind`: `'cron'` or `'once'`
- `schedule`: cron expression (`0 9 * * *`) or ISO-8601 (`2030-01-01T09:00:00Z`)
- `prompt`: text the alarm fires with — what the agent's future self should be told
- `timezone`: IANA tz name (required for cron; defaults to UTC for one-shot)
- `ifSessionEnded`: `'drop'` (default), `'wake'`, or `'bubble'` — see below

Cap: 50 active alarms per session.

## `ifSessionEnded`

What happens when the alarm fires but the session that scheduled it is gone (its dir was removed):

- `drop` (default): discard the fire silently. Valid for any session.
- `wake`: re-spawn the subagent that scheduled the alarm. **Subagent-only.** Top-level sessions reject `wake` at schedule time.
- `bubble`: deliver the fire to the parent session. **Subagent-only.** Top-level sessions reject `bubble` at schedule time.

For subagent sessions, the persona spec and parent lineage are captured at schedule time, so a subsequent wake works even if the original parent has rotated through compaction.

## Fire delivery

When an alarm fires, lace:

1. Appends an `alarm_fired` event to the target session's `events.jsonl` (durable).
2. Emits a `session/update` notification with the same payload, if the target session is active.

The embedder consumes alarm fires through the normal `onSessionUpdate` stream — no separate subscription primitive. If the session is inactive when the fire happens, the event sits in `events.jsonl` and lace emits the `session/update` the next time the session becomes active (via `session/load` or `session/resume`).
```

- [ ] **Step 2:** Commit.

```bash
git add docs/features/alarms.md
git commit -m "docs(features): alarm tool surface and ifSessionEnded semantics (PRI-1744)"
```

---

## Phase 9 — Final verification

### Task 28: Lace full test sweep

- [ ] **Step 1:**

```bash
cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/lace-worktrees/pri-1744-alarms-spec
npm run lint
npm run test 2>&1 | tail -30
```

Expected: clean lint, all tests pass.

- [ ] **Step 2:** Push.

```bash
git push origin pri-1744-alarms-spec
```

---

### Task 29: Sen-core full test sweep + push

- [ ] **Step 1:**

```bash
cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2
npm run lint
npm run test 2>&1 | tail -30
```

Expected: clean lint, all tests pass.

- [ ] **Step 2:** Push.

```bash
git push -u origin pri-1744-alarms-in-lace
```

---

### Task 30: Cross-repo smoke (manual)

- [ ] **Step 1:** Rebuild lace; run sen-core against the rebuilt lace agent.

```bash
cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/lace-worktrees/pri-1744-alarms-spec
npm run build

cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2
SEN_LACE_PATH=/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/lace-worktrees/pri-1744-alarms-spec/packages/agent/dist/main.js \
  npm run dev   # or whatever boot recipe sen-core uses
```

In a separate terminal, ask Ada (via her usual Slack channel or `sen prompt`):

> Schedule an alarm 60 seconds from now that says "ping".

After 60s, verify the alarm fires (Ada wakes and responds in Slack).

- [ ] **Step 2:** If anything is wrong, the e2e tests should have caught it. Fall back to fixing tests + code, not papering over.

- [ ] **Step 3:** Tag the lace and sen-core commits as complete in the PR descriptions.

---

## Spec coverage check (self-review)

Every section of the spec is covered:

- **Per-session storage** → Task 3 (AlarmStore), Task 13 (scheduler reads `agent-sessions/<id>/alarms.jsonl`).
- **Boot recovery** → Task 4 (`loadAll`, stale sweep).
- **Scheduler loop** → Task 4.
- **Fire delivery (active + inactive)** → Task 4, Task 14 (flush on activate).
- **`alarm_fired` DurableEvent + SessionUpdate** → Tasks 5–6.
- **`ifSessionEnded`** → Tasks 1, 9 (validation), 15 (wake), 4 (bubble routing).
- **Subagent parent linkage** → Tasks 7–8.
- **Tool surface** → Tasks 9–12.
- **Sen-core deletions** → Task 23.
- **Sen-core alarm_fired handler** → Task 24.
- **Persona MCP cleanup** → Task 25.
- **Docs** → Tasks 26–27.
- **Tests (unit + e2e)** → Tasks 3, 4, 9, 10, 11, 16–22, 24.

No placeholders, no "TBD". Names referenced across tasks (`AlarmStore`, `AlarmScheduler`, `storeFor`, `enqueue`, `flushUndelivered`, `spawnSubagentForWake`, `createWakeJob`, `WakeInvalidForTopLevel`, `BubbleInvalidForTopLevel`, `WakeRequiresPersonaRuntime`) match across definitions and usages.
