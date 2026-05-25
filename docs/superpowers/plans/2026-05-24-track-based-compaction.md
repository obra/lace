# Track-based Compaction Implementation Plan (lace side)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace lace's `summarize` compaction strategy with a track-aware strategy that demuxes per-track input (Slack threads / subagent jobs / scheduler / system), applies per-track salience filters, and produces a structured markdown prefix + verbatim recent-turn tail.

**Architecture:** Producers stamp a `track?: string` on durable `prompt` and `context_injected` events. Compaction reads canonical events, builds turnId → track map, groups earlier events by track, applies per-track salience extraction (with LLM fallback for oversize tracks), and writes one `context_compacted` event whose `preserved[]` is `[prefix-user-message, ...verbatim-tail-messages]`. Trigger lives inside lace's runner, fires after `turn_end` with 60%/90% context-window pressure thresholds.

**Tech Stack:** TypeScript strict, vitest, lace's existing event-sourcing + storage layer (`appendDurableEvent`, `readDurableEvents`, `writeAndAdvance`), existing `CompactionContext` type with `agent`/`provider` access for the LLM-fallback path.

**Spec:** `docs/superpowers/specs/2026-05-24-track-based-compaction-design.md` in this worktree.

**Scope of this plan:** Lace only. Producer track-stamping (sen-core slack listener, sen-core delegate, scheduler MCP) is a separate plan that ships lockstep — out of scope here.

---

## File map

**Create:**
- `packages/agent/src/compaction/track-compaction.ts` — `compact()` + demux + per-track salience filters
- `packages/agent/src/compaction/track-render.ts` — markdown renderer for compacted blocks
- `packages/agent/src/core/conversation/compaction-trigger.ts` — pressure evaluator + threshold predicate
- `packages/agent/src/compaction/__tests__/track-compaction.test.ts`
- `packages/agent/src/compaction/__tests__/track-render.test.ts`
- `packages/agent/src/core/conversation/__tests__/compaction-trigger.test.ts`

**Modify:**
- `packages/agent/src/storage/event-types.ts` — add `track?` field; add `lastCallInputContextTokens` to TurnEndUsage
- `packages/agent/src/core/conversation/runner.ts` — populate `lastCallInputContextTokens`; hook trigger after `turn_end`
- `packages/agent/src/conversation/slash-commands.ts` — `/compact` calls new `compact()`
- `packages/agent/src/rpc/handlers/session-operations.ts` — `ent/session/compact` calls new `compact()`; drop `trim-tool-results` wire enum

**Delete:**
- `packages/agent/src/compaction/summarize-strategy.ts`
- `packages/agent/src/compaction/summarize-strategy.test.ts`
- `packages/agent/src/compaction/registry.ts`
- `packages/agent/src/compaction/compact-dropped-messages.ts`
- `packages/agent/src/compaction/trim-tool-results-strategy.ts` (its callers are also deleted)
- `packages/agent/src/compaction/trim-tool-results-strategy.test.ts`

---

## Task 1: Add `track?` field + `lastCallInputContextTokens` to event types

**Files:**
- Modify: `packages/agent/src/storage/event-types.ts:18-21, 41-82, 110-114`
- Test: `packages/agent/src/storage/__tests__/event-types.test.ts`

- [ ] **Step 1: Write failing test**

Append to `packages/agent/src/storage/__tests__/event-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { TypedDurableEvent } from '../event-types';

describe('track field', () => {
  it('PromptEventData accepts optional track', () => {
    const e: TypedDurableEvent = {
      eventSeq: 1,
      timestamp: '2026-05-24T00:00:00Z',
      type: 'prompt',
      data: {
        type: 'prompt',
        content: [{ type: 'text', text: 'hi' }],
        track: 'slack:T1:C1:1.0',
      },
    };
    expect(e.data.type === 'prompt' && e.data.track).toBe('slack:T1:C1:1.0');
  });

  it('ContextInjectedEventData accepts optional track', () => {
    const e: TypedDurableEvent = {
      eventSeq: 2,
      timestamp: '2026-05-24T00:00:01Z',
      type: 'context_injected',
      data: {
        type: 'context_injected',
        content: [{ type: 'text', text: 'note' }],
        track: 'alarm:abc',
      },
    };
    expect(e.data.type === 'context_injected' && e.data.track).toBe('alarm:abc');
  });

  it('TurnEndEventData.usage accepts lastCallInputContextTokens', () => {
    const e: TypedDurableEvent = {
      eventSeq: 3,
      timestamp: '2026-05-24T00:00:02Z',
      type: 'turn_end',
      data: {
        type: 'turn_end',
        stopReason: 'end_turn',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationInputTokens: 200,
          cacheReadInputTokens: 300,
          lastCallInputContextTokens: 600,
          costUsd: 0.01,
        },
      },
    };
    expect(e.data.type === 'turn_end' && e.data.usage?.lastCallInputContextTokens).toBe(600);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest --run packages/agent/src/storage/__tests__/event-types.test.ts`
Expected: TypeScript error — `track`, `lastCallInputContextTokens` not assignable.

- [ ] **Step 3: Add fields**

Modify `packages/agent/src/storage/event-types.ts`:

Replace `PromptEventData`:
```ts
export type PromptEventData = {
  type: 'prompt';
  content: ContentBlock[];
  /**
   * Producer-defined demux key for the new track-based compaction strategy.
   * Shape: `<kind>:<id>` (e.g. `slack:T123:C456:1.0`, `job:job_abc`, `alarm:xyz`).
   * Lace stores opaquely; compaction reads it. Optional — legacy events lack
   * it and are bucketed as `'untracked'` at compaction time.
   */
  track?: string;
};
```

Replace `ContextInjectedEventData`:
```ts
export type ContextInjectedEventData = {
  type: 'context_injected';
  content: ContentBlock[];
  priority?: string;
  /** See PromptEventData.track. */
  track?: string;
};
```

In `TurnEndEventData.usage`, add after `cacheReadInputTokens?: number;` and before `costUsd: number;`:
```ts
    /**
     * The LAST API call's on-the-wire input context size for this turn (not
     * summed across calls). Tool-loop turns issue multiple API calls; the
     * `inputTokens`/cache field sums above are turn-cumulative. Compaction
     * needs the most recent call's snapshot so its pressure arithmetic
     * matches what the next call will actually send. Required for the
     * track-based compaction trigger. Undefined on events written before
     * this field shipped.
     */
    lastCallInputContextTokens?: number;
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest --run packages/agent/src/storage/__tests__/event-types.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/storage/event-types.ts packages/agent/src/storage/__tests__/event-types.test.ts
git commit -m "storage: add track field + lastCallInputContextTokens to event types"
```

---

## Task 2: Populate `lastCallInputContextTokens` in runner.ts

**Files:**
- Modify: `packages/agent/src/core/conversation/runner.ts:383, 595-625, 985-1000`
- Test: `packages/agent/src/core/conversation/__tests__/runner.test.ts`

Runner today tracks `totalInputTokens`, `totalCacheCreationInputTokens`, `totalCacheReadInputTokens` as turn-cumulative sums. We add three running variables that capture the LAST API call's values, then write their sum on `turn_end.usage.lastCallInputContextTokens`.

- [ ] **Step 1: Write failing test**

Add to `packages/agent/src/core/conversation/__tests__/runner.test.ts` (in the existing describe block):

```ts
it('writes lastCallInputContextTokens on turn_end for multi-call turns', async () => {
  // Existing test pattern: build a mock provider that responds twice (one tool
  // call cycle), then assert turn_end.usage.lastCallInputContextTokens equals
  // the SECOND response's input+cache totals, not the sum.
  const mockProvider = makeMockProvider([
    {
      stopReason: 'tool_use',
      content: [{ type: 'tool_use', name: 'bash', toolCallId: 't1', input: { command: 'echo' } }],
      usage: {
        promptTokens: 100,
        completionTokens: 20,
        cacheCreationInputTokens: 500,
        cacheReadInputTokens: 0,
      },
    },
    {
      stopReason: 'end_turn',
      content: [{ type: 'text', text: 'done' }],
      usage: {
        promptTokens: 110,
        completionTokens: 5,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 600,
      },
    },
  ]);
  // ...run turn via existing test harness...
  const turnEnd = findLastEvent(events, 'turn_end');
  expect(turnEnd.data.usage.inputTokens).toBe(210); // sum
  expect(turnEnd.data.usage.lastCallInputContextTokens).toBe(710); // 110 + 0 + 600
});
```

Note: adapt to the existing `runner.test.ts` patterns; reuse helpers already in the file.

- [ ] **Step 2: Verify failure**

Run: `npx vitest --run packages/agent/src/core/conversation/__tests__/runner.test.ts -t "lastCallInputContextTokens"`
Expected: FAIL — field is `undefined` on the emitted `turn_end`.

- [ ] **Step 3: Update runner.ts**

Around `runner.ts:383` (where `let totalInputTokens = 0;` lives), add three siblings:

```ts
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheCreationInputTokens = 0;
    let totalCacheReadInputTokens = 0;
    // Per-call snapshot of the LAST response's input + cache fields. Overwritten
    // each call; the final value reflects the model's most recent on-the-wire
    // context size. Used by the track-based compaction trigger.
    let lastCallInputTokens = 0;
    let lastCallCacheCreationInputTokens = 0;
    let lastCallCacheReadInputTokens = 0;
```

In the per-response usage block at `runner.ts:599-608`, after `totalCacheReadInputTokens += cacheReadInputTokens;`:

```ts
          lastCallInputTokens = inputTokens;
          lastCallCacheCreationInputTokens = cacheCreationInputTokens;
          lastCallCacheReadInputTokens = cacheReadInputTokens;
```

In the `turn_end` write at `runner.ts:985-1000`, in the `usage` block add a `lastCallInputContextTokens` field:

```ts
        await writeAndAdvance({
          type: 'turn_end',
          data: {
            stopReason,
            stopDetails,
            cacheMissReason: lastCacheMissReason ?? null,
            usage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              cacheCreationInputTokens: totalCacheCreationInputTokens,
              cacheReadInputTokens: totalCacheReadInputTokens,
              lastCallInputContextTokens:
                lastCallInputTokens +
                lastCallCacheCreationInputTokens +
                lastCallCacheReadInputTokens,
              costUsd: turnCostUsd,
            },
          },
        });
```

Also mirror this in the second `usage` block at `runner.ts:1024-1030` (the return value):

```ts
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheCreationInputTokens: totalCacheCreationInputTokens,
        cacheReadInputTokens: totalCacheReadInputTokens,
        lastCallInputContextTokens:
          lastCallInputTokens +
          lastCallCacheCreationInputTokens +
          lastCallCacheReadInputTokens,
        costUsd: turnCostUsd,
      },
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest --run packages/agent/src/core/conversation/__tests__/runner.test.ts -t "lastCallInputContextTokens"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/core/conversation/runner.ts packages/agent/src/core/conversation/__tests__/runner.test.ts
git commit -m "runner: emit usage.lastCallInputContextTokens on turn_end"
```

---

## Task 3: Build compaction-trigger.ts pressure evaluator

**Files:**
- Create: `packages/agent/src/core/conversation/compaction-trigger.ts`
- Test: `packages/agent/src/core/conversation/__tests__/compaction-trigger.test.ts`

The trigger is a pure function. Given a `TurnEndEventData.usage`, a context-window size, and a recent state (just the trigger's own count of how many compactions have happened, in-memory), decide whether to compact.

- [ ] **Step 1: Write failing test**

Create `packages/agent/src/core/conversation/__tests__/compaction-trigger.test.ts`:

```ts
// ABOUTME: Tests for the track-based compaction trigger
// ABOUTME: Pressure thresholds, stopReason gating, cache field defaults

import { describe, it, expect } from 'vitest';
import { computePressure, shouldFireCompaction } from '../compaction-trigger';
import type { TurnEndEventData } from '@lace/agent/storage/event-types';

const usage = (overrides: Partial<NonNullable<TurnEndEventData['usage']>>) => ({
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  ...overrides,
});

describe('computePressure', () => {
  it('uses lastCallInputContextTokens when present', () => {
    expect(computePressure(usage({ lastCallInputContextTokens: 500_000 }), 1_000_000)).toBe(0.5);
  });

  it('falls back to inputTokens + cache fields when lastCallInputContextTokens absent', () => {
    expect(
      computePressure(
        usage({ inputTokens: 100, cacheCreationInputTokens: 200, cacheReadInputTokens: 300 }),
        1_000,
      ),
    ).toBe(0.6);
  });

  it('treats missing cache fields as zero', () => {
    expect(computePressure(usage({ inputTokens: 600 }), 1_000)).toBe(0.6);
  });

  it('returns 0 for missing usage', () => {
    expect(computePressure(undefined, 1_000_000)).toBe(0);
  });

  it('returns 0 for non-positive window size', () => {
    expect(computePressure(usage({ inputTokens: 100 }), 0)).toBe(0);
  });
});

describe('shouldFireCompaction', () => {
  const trigger = (stopReason: string, pressure: number) =>
    shouldFireCompaction({ stopReason: stopReason as any, pressure });

  it('fires at 60% for clean stop reasons', () => {
    expect(trigger('end_turn', 0.6)).toBe(true);
    expect(trigger('stop_sequence', 0.61)).toBe(true);
    expect(trigger('max_turns', 0.7)).toBe(true);
  });

  it('does not fire below 60%', () => {
    expect(trigger('end_turn', 0.59)).toBe(false);
  });

  it('fires at 90% emergency regardless', () => {
    expect(trigger('end_turn', 0.9)).toBe(true);
  });

  it('does not fire on error stop reasons', () => {
    expect(trigger('provider_error_overloaded', 0.95)).toBe(false);
    expect(trigger('tool_error_throw', 0.95)).toBe(false);
    expect(trigger('process_died', 0.95)).toBe(false);
    expect(trigger('cancelled', 0.95)).toBe(false);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest --run packages/agent/src/core/conversation/__tests__/compaction-trigger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/agent/src/core/conversation/compaction-trigger.ts`:

```ts
// ABOUTME: Track-based compaction trigger — pressure evaluator + threshold predicate
// ABOUTME: Pure functions; called from runner.run() after turn_end is written

import type { TurnEndEventData } from '@lace/agent/storage/event-types';

const GLOBAL_THRESHOLD = 0.6;
const EMERGENCY_THRESHOLD = 0.9;

const CLEAN_STOP_REASONS = new Set(['end_turn', 'stop_sequence', 'max_turns']);

/**
 * Compute context-window pressure as a fraction (0..1).
 *
 * Prefers `usage.lastCallInputContextTokens` (the last API call's on-the-wire
 * context size). Falls back to summing `inputTokens + cacheCreationInputTokens
 * + cacheReadInputTokens` for legacy events without the lastCall field.
 * Missing cache fields are treated as zero (forward-compat across providers).
 */
export function computePressure(
  usage: TurnEndEventData['usage'] | undefined,
  contextWindowSize: number,
): number {
  if (!usage || contextWindowSize <= 0) return 0;
  if (typeof usage.lastCallInputContextTokens === 'number') {
    return usage.lastCallInputContextTokens / contextWindowSize;
  }
  const inputs =
    (usage.inputTokens ?? 0) +
    (usage.cacheCreationInputTokens ?? 0) +
    (usage.cacheReadInputTokens ?? 0);
  return inputs / contextWindowSize;
}

/**
 * Decide whether to fire compaction at the end of a turn.
 *
 * Fires at 60% pressure on clean stop reasons (end_turn / stop_sequence /
 * max_turns). The 90% emergency threshold applies the same gate — error/abort
 * stop reasons never fire because the model state is unreliable; we'll
 * re-evaluate on the next clean turn.
 */
export function shouldFireCompaction(args: {
  stopReason: string;
  pressure: number;
}): boolean {
  if (!CLEAN_STOP_REASONS.has(args.stopReason)) return false;
  if (args.pressure >= EMERGENCY_THRESHOLD) return true;
  return args.pressure >= GLOBAL_THRESHOLD;
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest --run packages/agent/src/core/conversation/__tests__/compaction-trigger.test.ts`
Expected: PASS (8+ tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/core/conversation/compaction-trigger.ts packages/agent/src/core/conversation/__tests__/compaction-trigger.test.ts
git commit -m "core: add compaction-trigger pressure evaluator"
```

---

## Task 4: Demux helpers in track-compaction.ts

**Files:**
- Create: `packages/agent/src/compaction/track-compaction.ts` (initial: just demux helpers + types)
- Test: `packages/agent/src/compaction/__tests__/track-compaction.test.ts`

Build the turnId-to-track resolver and the event grouping. Pure functions over `TypedDurableEvent[]`.

- [ ] **Step 1: Write failing test**

Create `packages/agent/src/compaction/__tests__/track-compaction.test.ts`:

```ts
// ABOUTME: Tests for track-based compaction — demux, salience, render, orchestrator
// ABOUTME: Pure-function tests over synthetic TypedDurableEvent[] fixtures

import { describe, it, expect } from 'vitest';
import { buildTurnToTrackMap, groupEarlierEventsByTrack } from '../track-compaction';
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';

const event = (seq: number, type: string, data: any, turnId?: string): TypedDurableEvent => ({
  eventSeq: seq,
  timestamp: `2026-05-24T00:00:${String(seq).padStart(2, '0')}Z`,
  ...(turnId ? { turnId } : {}),
  type: type as any,
  data: { type, ...data },
});

describe('buildTurnToTrackMap', () => {
  it('maps turnId to the track of the immediately preceding prompt', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [{ type: 'text', text: 'hi' }], track: 'slack:A' }),
      event(2, 'turn_start', {}, 'turn_X'),
      event(3, 'message', { content: 'reply' }, 'turn_X'),
      event(4, 'turn_end', { stopReason: 'end_turn' }, 'turn_X'),
    ];
    const map = buildTurnToTrackMap(events);
    expect(map.get('turn_X')).toBe('slack:A');
  });

  it('defaults missing track to untracked', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [{ type: 'text', text: 'hi' }] }),
      event(2, 'turn_start', {}, 'turn_X'),
    ];
    expect(buildTurnToTrackMap(events).get('turn_X')).toBe('untracked');
  });

  it('uses the closest preceding prompt across multiple turns', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [], track: 'slack:A' }),
      event(2, 'turn_start', {}, 'turn_1'),
      event(3, 'turn_end', { stopReason: 'end_turn' }, 'turn_1'),
      event(4, 'prompt', { content: [], track: 'slack:B' }),
      event(5, 'turn_start', {}, 'turn_2'),
      event(6, 'turn_end', { stopReason: 'end_turn' }, 'turn_2'),
    ];
    const map = buildTurnToTrackMap(events);
    expect(map.get('turn_1')).toBe('slack:A');
    expect(map.get('turn_2')).toBe('slack:B');
  });
});

describe('groupEarlierEventsByTrack', () => {
  it('groups in-turn events by the turn-track and mid-turn injects by their own track', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [], track: 'slack:A' }),
      event(2, 'turn_start', {}, 'turn_1'),
      event(3, 'tool_use', { toolCallId: 't1', name: 'bash', input: {} }, 'turn_1'),
      event(4, 'context_injected', { content: [], track: 'alarm:X' }), // mid-turn (no turnId)
      event(5, 'message', { content: 'ok' }, 'turn_1'),
      event(6, 'turn_end', { stopReason: 'end_turn' }, 'turn_1'),
    ];
    const turnToTrack = new Map([['turn_1', 'slack:A']]);
    const groups = groupEarlierEventsByTrack(events, turnToTrack);
    expect(groups.get('slack:A')?.map((e) => e.eventSeq)).toEqual([1, 2, 3, 5, 6]);
    expect(groups.get('alarm:X')?.map((e) => e.eventSeq)).toEqual([4]);
  });

  it('top-level events without turnId use their own track', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'context_injected', { content: [], track: 'system:bootstrap' }),
      event(2, 'context_injected', { content: [], track: 'reminder:R' }),
    ];
    const groups = groupEarlierEventsByTrack(events, new Map());
    expect(groups.get('system:bootstrap')?.map((e) => e.eventSeq)).toEqual([1]);
    expect(groups.get('reminder:R')?.map((e) => e.eventSeq)).toEqual([2]);
  });

  it('filters out context_compacted events', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'context_compacted', { strategy: 'old', preserved: [] }),
      event(2, 'prompt', { content: [], track: 'slack:A' }),
    ];
    const groups = groupEarlierEventsByTrack(events, new Map());
    expect(groups.get('untracked')).toBeUndefined();
    expect(groups.get('slack:A')?.map((e) => e.eventSeq)).toEqual([2]);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest --run packages/agent/src/compaction/__tests__/track-compaction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement demux**

Create `packages/agent/src/compaction/track-compaction.ts`:

```ts
// ABOUTME: Track-based compaction strategy — demux + salience + render
// ABOUTME: Replaces summarize-strategy.ts; reuses context_compacted event type

import type {
  TypedDurableEvent,
  PromptEventData,
  ContextInjectedEventData,
} from '@lace/agent/storage/event-types';

export const UNTRACKED = 'untracked' as const;

/**
 * Walk events and map each `turn_start.turnId` to the track of the
 * immediately preceding `prompt` event. Used to attribute in-turn events
 * (tool_use, message, turn_end) to a track.
 */
export function buildTurnToTrackMap(events: TypedDurableEvent[]): Map<string, string> {
  const map = new Map<string, string>();
  let pendingPromptTrack: string | undefined;
  for (const e of events) {
    if (e.type === 'prompt') {
      const data = e.data as PromptEventData;
      pendingPromptTrack = data.track ?? UNTRACKED;
      continue;
    }
    if (e.type === 'turn_start' && e.turnId) {
      map.set(e.turnId, pendingPromptTrack ?? UNTRACKED);
      pendingPromptTrack = undefined;
    }
  }
  return map;
}

/**
 * Group events by track for per-track salience extraction.
 *
 * - Filters out `context_compacted` events (we always rebuild from canonical).
 * - In-turn events inherit their turn's track from `turnToTrack`.
 * - Mid-turn `context_injected` events (no turnId or with their own track)
 *   are emitted under their own `data.track`.
 * - Top-level prompts/injects without a containing turn use their own track.
 * - Events without a track field fall into `'untracked'`.
 */
export function groupEarlierEventsByTrack(
  events: TypedDurableEvent[],
  turnToTrack: Map<string, string>,
): Map<string, TypedDurableEvent[]> {
  const groups = new Map<string, TypedDurableEvent[]>();
  const push = (track: string, e: TypedDurableEvent) => {
    const arr = groups.get(track) ?? [];
    arr.push(e);
    groups.set(track, arr);
  };

  for (const e of events) {
    if (e.type === 'context_compacted') continue;

    if (e.type === 'context_injected') {
      const data = e.data as ContextInjectedEventData;
      const ownTrack = data.track ?? UNTRACKED;
      // Mid-turn injects use their OWN track regardless of enclosing turn.
      push(ownTrack, e);
      continue;
    }

    if (e.type === 'prompt') {
      const data = e.data as PromptEventData;
      push(data.track ?? UNTRACKED, e);
      continue;
    }

    if (e.turnId && turnToTrack.has(e.turnId)) {
      push(turnToTrack.get(e.turnId)!, e);
      continue;
    }

    // Top-level event without a turnId attribution — bucket as untracked.
    push(UNTRACKED, e);
  }

  return groups;
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest --run packages/agent/src/compaction/__tests__/track-compaction.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/compaction/track-compaction.ts packages/agent/src/compaction/__tests__/track-compaction.test.ts
git commit -m "compaction: add track demux helpers"
```

---

## Task 5: Per-track salience filters

**Files:**
- Modify: `packages/agent/src/compaction/track-compaction.ts` (add salience functions)
- Test: `packages/agent/src/compaction/__tests__/track-compaction.test.ts` (extend)

Each salience filter takes a track's events and returns a `TrackBlock` (track id + summary text + rough token count). Filters by track-kind prefix.

- [ ] **Step 1: Write failing tests**

Append to `packages/agent/src/compaction/__tests__/track-compaction.test.ts`:

```ts
import { salienceForTrack } from '../track-compaction';

describe('salienceForTrack', () => {
  it('alarm tracks drop entirely (return null)', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'context_injected', {
        content: [{ type: 'text', text: '<notification kind="alarm-fired">...' }],
        track: 'alarm:foo',
      }),
    ];
    expect(salienceForTrack('alarm:foo', events)).toBeNull();
  });

  it('reminder tracks drop entirely', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'context_injected', { content: [], track: 'reminder:r1' }),
    ];
    expect(salienceForTrack('reminder:r1', events)).toBeNull();
  });

  it('system:bootstrap drops entirely', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'context_injected', { content: [], track: 'system:bootstrap' }),
    ];
    expect(salienceForTrack('system:bootstrap', events)).toBeNull();
  });

  it('system:idle-errors emits count-only', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'context_injected', { content: [], track: 'system:idle-errors' }),
      event(2, 'context_injected', { content: [], track: 'system:idle-errors' }),
      event(3, 'context_injected', { content: [], track: 'system:idle-errors' }),
    ];
    const block = salienceForTrack('system:idle-errors', events);
    expect(block?.body).toMatch(/3 idle-error reports/i);
  });

  it('slack tracks extract inbound text from prompts and outbound from slack_send_message tool_use', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', {
        content: [{
          type: 'text',
          text: '<messages channel="C1" thread_ts="1.0"><current count="1"><slack_message user="U1">hello</slack_message></current></messages>',
        }],
        track: 'slack:T:C1:1.0',
      }, undefined),
      event(2, 'turn_start', {}, 'turn_1'),
      event(3, 'tool_use', {
        toolCallId: 't1',
        name: 'slack/send_message',
        input: { channel: 'C1', text: 'hi back' },
      }, 'turn_1'),
      event(4, 'turn_end', { stopReason: 'end_turn' }, 'turn_1'),
    ];
    const block = salienceForTrack('slack:T:C1:1.0', events);
    expect(block?.body).toContain('hello');
    expect(block?.body).toContain('hi back');
  });

  it('job tracks emit "delegated X → outcome" using job_started/job_finished', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'job_started', {
        jobId: 'job_a',
        jobType: 'delegate',
        description: 'IP check',
      }),
      event(2, 'job_finished', { jobId: 'job_a', outcome: 'completed' }),
    ];
    const block = salienceForTrack('job:job_a', events);
    expect(block?.body).toMatch(/IP check.*completed/);
  });

  it('untracked falls back to a generic prose extraction', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [{ type: 'text', text: 'a legacy prompt' }] }),
      event(2, 'turn_start', {}, 'turn_1'),
      event(3, 'message', { content: 'an assistant reply' }, 'turn_1'),
      event(4, 'turn_end', { stopReason: 'end_turn' }, 'turn_1'),
    ];
    const block = salienceForTrack('untracked', events);
    expect(block?.body).toContain('a legacy prompt');
    expect(block?.body).toContain('an assistant reply');
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest --run packages/agent/src/compaction/__tests__/track-compaction.test.ts -t "salienceForTrack"`
Expected: FAIL — `salienceForTrack` not exported.

- [ ] **Step 3: Implement**

Append to `packages/agent/src/compaction/track-compaction.ts`:

```ts
import type {
  ToolUseEventData,
  JobStartedEventData,
  JobFinishedEventData,
  MessageEventData,
} from '@lace/agent/storage/event-types';

export type TrackBlock = {
  trackId: string;
  /** Markdown body for this track. */
  body: string;
  /** Rough token estimate (char/4). */
  estimatedTokens: number;
};

const estimate = (s: string) => Math.ceil(s.length / 4);

/**
 * Per-track salience extraction. Returns null for tracks that should be
 * dropped entirely from the rendered prefix (alarm/reminder/bootstrap).
 */
export function salienceForTrack(
  trackId: string,
  events: TypedDurableEvent[],
): TrackBlock | null {
  if (trackId.startsWith('alarm:') || trackId.startsWith('reminder:')) {
    return null;
  }
  if (trackId === 'system:bootstrap') {
    return null;
  }
  if (trackId === 'system:idle-errors') {
    const body = `${events.length} idle-error reports since last compaction.`;
    return { trackId, body, estimatedTokens: estimate(body) };
  }
  if (trackId.startsWith('job:')) {
    return jobSalience(trackId, events);
  }
  if (trackId.startsWith('slack:')) {
    return slackSalience(trackId, events);
  }
  // Fallthrough: untracked or unknown-kind. Use prose extraction.
  return untrackedSalience(trackId, events);
}

function jobSalience(trackId: string, events: TypedDurableEvent[]): TrackBlock {
  const lines: string[] = [];
  let description = '(unknown)';
  let outcome: string | undefined;
  for (const e of events) {
    if (e.type === 'job_started') {
      const d = e.data as JobStartedEventData;
      description = d.description ?? d.command ?? '(no description)';
    } else if (e.type === 'job_finished') {
      const d = e.data as JobFinishedEventData;
      outcome = d.outcome;
    }
  }
  const status = outcome ? statusGlyph(outcome) : '⏳ in-flight';
  lines.push(`- ${trackId} ${status} ${description}`);
  const body = lines.join('\n');
  return { trackId, body, estimatedTokens: estimate(body) };
}

function statusGlyph(outcome: string): string {
  if (outcome === 'completed') return '✓ completed:';
  if (outcome === 'failed') return '✗ failed:';
  if (outcome === 'cancelled') return '⊘ cancelled:';
  return outcome + ':';
}

function slackSalience(trackId: string, events: TypedDurableEvent[]): TrackBlock {
  const inbound: string[] = [];
  const outbound: string[] = [];
  for (const e of events) {
    if (e.type === 'prompt') {
      const text = extractText(e);
      // Pull just the <current> portion if the new envelope is in use; else
      // include the whole text (untouched).
      const current = extractCurrentMessages(text);
      if (current) inbound.push(...current);
      else if (text.trim()) inbound.push(text.trim().slice(0, 500));
    } else if (e.type === 'tool_use') {
      const d = e.data as ToolUseEventData;
      if (d.name === 'slack/send_message') {
        const t = typeof d.input?.text === 'string' ? d.input.text : '';
        if (t.trim()) outbound.push(t.trim().slice(0, 500));
      }
    }
  }
  const lines: string[] = [`### ${trackId}`];
  for (const t of inbound) lines.push(`- They said: ${truncate(t, 240)}`);
  for (const t of outbound) lines.push(`- You replied: ${truncate(t, 240)}`);
  const body = lines.join('\n');
  return { trackId, body, estimatedTokens: estimate(body) };
}

function untrackedSalience(trackId: string, events: TypedDurableEvent[]): TrackBlock {
  const lines: string[] = [];
  for (const e of events) {
    if (e.type === 'prompt') {
      const t = extractText(e).trim();
      if (t) lines.push(`User: ${truncate(t, 500)}`);
    } else if (e.type === 'message') {
      const d = e.data as MessageEventData;
      const t = typeof d.content === 'string' ? d.content : extractText(e);
      if (t.trim()) lines.push(`Assistant: ${truncate(t.trim(), 500)}`);
    }
  }
  const body = lines.length > 0 ? lines.join('\n') : '(empty)';
  return { trackId, body, estimatedTokens: estimate(body) };
}

function extractText(e: TypedDurableEvent): string {
  const data = e.data as { content?: unknown };
  const content = data.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: 'text'; text: string } => (b as any)?.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

function extractCurrentMessages(envelopeText: string): string[] | null {
  // Parse new-envelope `<current count="N"><slack_message ...>TEXT</slack_message>...</current>`
  // and return the inner texts. Returns null if no <current> block found.
  const currentMatch = envelopeText.match(/<current[^>]*>([\s\S]*?)<\/current>/);
  if (!currentMatch) return null;
  const inner = currentMatch[1];
  const msgs: string[] = [];
  const msgRegex = /<slack_message[^>]*>([\s\S]*?)<\/slack_message>/g;
  let m: RegExpExecArray | null;
  while ((m = msgRegex.exec(inner)) !== null) {
    msgs.push(m[1].trim());
  }
  return msgs;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest --run packages/agent/src/compaction/__tests__/track-compaction.test.ts`
Expected: PASS (all tests including new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/compaction/track-compaction.ts packages/agent/src/compaction/__tests__/track-compaction.test.ts
git commit -m "compaction: add per-track salience filters (slack/job/alarm/system)"
```

---

## Task 6: Renderer in track-render.ts

**Files:**
- Create: `packages/agent/src/compaction/track-render.ts`
- Test: `packages/agent/src/compaction/__tests__/track-render.test.ts`

Pure function: given track blocks + a scheduler-state roll-up, produce the markdown prefix string.

- [ ] **Step 1: Write failing test**

Create `packages/agent/src/compaction/__tests__/track-render.test.ts`:

```ts
// ABOUTME: Tests for markdown rendering of compacted track blocks

import { describe, it, expect } from 'vitest';
import { renderCompactionPrefix } from '../track-render';
import type { TrackBlock } from '../track-compaction';

describe('renderCompactionPrefix', () => {
  it('emits the header and the per-section blocks in fixed order', () => {
    const blocks: TrackBlock[] = [
      { trackId: 'slack:T:C1:1.0', body: '### slack:T:C1:1.0\n- They said: hi', estimatedTokens: 10 },
      { trackId: 'job:job_a', body: '- job:job_a ✓ completed: IP check', estimatedTokens: 8 },
    ];
    const out = renderCompactionPrefix({
      blocks,
      scheduler: { alarmsPending: 2, remindersPending: 1 },
    });
    expect(out).toContain('[Earlier conversation, compacted by track]');
    expect(out).toContain('## Slack threads');
    expect(out).toContain('### slack:T:C1:1.0');
    expect(out).toContain('## Subagent jobs');
    expect(out).toContain('- job:job_a ✓ completed: IP check');
    expect(out).toContain('## Scheduler');
    expect(out).toMatch(/2 alarms pending, 1 reminder pending/);
  });

  it('skips empty sections', () => {
    const out = renderCompactionPrefix({
      blocks: [
        { trackId: 'job:a', body: '- job:a ✓ completed: x', estimatedTokens: 5 },
      ],
      scheduler: { alarmsPending: 0, remindersPending: 0 },
    });
    expect(out).not.toContain('## Slack threads');
    expect(out).toContain('## Subagent jobs');
    expect(out).not.toContain('## Scheduler');
  });

  it('emits system events section only if any present', () => {
    const blocks: TrackBlock[] = [
      { trackId: 'system:idle-errors', body: '3 idle-error reports since last compaction.', estimatedTokens: 6 },
    ];
    const out = renderCompactionPrefix({ blocks, scheduler: { alarmsPending: 0, remindersPending: 0 } });
    expect(out).toContain('## System events');
    expect(out).toContain('3 idle-error reports');
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest --run packages/agent/src/compaction/__tests__/track-render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/agent/src/compaction/track-render.ts`:

```ts
// ABOUTME: Markdown renderer for compacted track blocks
// ABOUTME: Pure function; receives TrackBlock[] and scheduler roll-up, returns string

import type { TrackBlock } from './track-compaction';

export type SchedulerRollup = {
  alarmsPending: number;
  remindersPending: number;
};

export type RenderInput = {
  blocks: TrackBlock[];
  scheduler: SchedulerRollup;
};

const HEADER = '[Earlier conversation, compacted by track]';

export function renderCompactionPrefix(input: RenderInput): string {
  const slackBlocks = input.blocks.filter((b) => b.trackId.startsWith('slack:'));
  const jobBlocks = input.blocks.filter((b) => b.trackId.startsWith('job:'));
  const systemBlocks = input.blocks.filter(
    (b) => b.trackId.startsWith('system:') || b.trackId === 'untracked',
  );

  const parts: string[] = [HEADER];

  if (slackBlocks.length > 0) {
    parts.push('\n## Slack threads\n');
    for (const b of slackBlocks) parts.push(b.body);
  }

  if (jobBlocks.length > 0) {
    parts.push('\n## Subagent jobs\n');
    for (const b of jobBlocks) parts.push(b.body);
  }

  const { alarmsPending, remindersPending } = input.scheduler;
  if (alarmsPending > 0 || remindersPending > 0) {
    parts.push('\n## Scheduler');
    parts.push(
      `${alarmsPending} alarm${alarmsPending === 1 ? '' : 's'} pending, ${remindersPending} reminder${remindersPending === 1 ? '' : 's'} pending. Use \`list_alarms\` / \`list_reminders\` for details.`,
    );
  }

  if (systemBlocks.length > 0) {
    parts.push('\n## System events\n');
    for (const b of systemBlocks) parts.push(b.body);
  }

  return parts.join('\n');
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest --run packages/agent/src/compaction/__tests__/track-render.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/compaction/track-render.ts packages/agent/src/compaction/__tests__/track-render.test.ts
git commit -m "compaction: add markdown renderer for compacted prefix"
```

---

## Task 7: Wire `compact()` orchestrator

**Files:**
- Modify: `packages/agent/src/compaction/track-compaction.ts` (add `compact()`)
- Test: `packages/agent/src/compaction/__tests__/track-compaction.test.ts` (extend)

The `compact()` function orchestrates demux + salience + tail-split + render. It's PURE: returns `{compactionEvent, preserved}` without writing.

Tail size: **10 turns verbatim**. Snap leftward if the boundary splits a tool_use from its tool_result.

- [ ] **Step 1: Write failing test**

Append to `packages/agent/src/compaction/__tests__/track-compaction.test.ts`:

```ts
import { compact, splitAtTailBoundary } from '../track-compaction';
import type { CompactionContext } from '../types';

const turnEnd = (seq: number, turnId: string): TypedDurableEvent =>
  event(seq, 'turn_end', { stopReason: 'end_turn' }, turnId);
const turnStart = (seq: number, turnId: string): TypedDurableEvent =>
  event(seq, 'turn_start', {}, turnId);

describe('splitAtTailBoundary', () => {
  it('keeps last 10 turns verbatim', () => {
    const events: TypedDurableEvent[] = [];
    let seq = 1;
    for (let t = 0; t < 12; t++) {
      events.push(event(seq++, 'prompt', { content: [], track: `slack:T${t}` }));
      events.push(turnStart(seq++, `turn_${t}`));
      events.push(turnEnd(seq++, `turn_${t}`));
    }
    const { earlier, tail } = splitAtTailBoundary(events, 10);
    // 12 turns × 3 events = 36; last 10 turns = events 7..36 (3 × 10 = 30 events tail).
    expect(tail.length).toBe(30);
    expect(earlier.length).toBe(6);
  });

  it('snaps leftward to avoid splitting tool_use from tool_result', () => {
    // Construct a 2-turn fixture where the boundary cuts mid-tool-pair.
    // Tail size 1 turn: boundary should snap left to include the whole turn.
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [], track: 'slack:A' }),
      turnStart(2, 'turn_1'),
      event(3, 'tool_use', { toolCallId: 't1', name: 'bash', input: {} }, 'turn_1'),
      // No turn_end yet — multi-call turn, tool_result for t1 lives in turn_1.
      event(4, 'message', { content: [{ type: 'tool_result', toolCallId: 't1', content: 'ok' }] }, 'turn_1'),
      turnEnd(5, 'turn_1'),
      // Second turn starts; if we asked for tail=1, it would include only turn_2.
      event(6, 'prompt', { content: [], track: 'slack:B' }),
      turnStart(7, 'turn_2'),
      turnEnd(8, 'turn_2'),
    ];
    const { earlier, tail } = splitAtTailBoundary(events, 1);
    // turn_2 is 3 events (prompt + turn_start + turn_end).
    expect(tail.length).toBe(3);
    expect(earlier.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns all events as tail when total turns <= tail size', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [], track: 'slack:A' }),
      turnStart(2, 'turn_1'),
      turnEnd(3, 'turn_1'),
    ];
    const { earlier, tail } = splitAtTailBoundary(events, 10);
    expect(earlier).toEqual([]);
    expect(tail.length).toBe(3);
  });
});

describe('compact()', () => {
  const ctx: CompactionContext = { threadId: 'sess_test' };

  it('produces a context_compacted event with strategy="track-based"', async () => {
    const events: TypedDurableEvent[] = [];
    let seq = 1;
    for (let t = 0; t < 12; t++) {
      events.push(event(seq++, 'prompt', { content: [{ type: 'text', text: `msg ${t}` }], track: `slack:T:C:${t}` }));
      events.push(turnStart(seq++, `turn_${t}`));
      events.push(turnEnd(seq++, `turn_${t}`));
    }
    const result = await compact(events, ctx);
    expect(result.compactionEvent.type).toBe('context_compacted');
    const data = result.compactionEvent.data as any;
    expect(data.strategy).toBe('track-based');
    expect(data.messagesCompacted).toBe(6); // earlier events count
    expect(Array.isArray(data.preserved)).toBe(true);
    expect(data.preserved[0].role).toBe('user');
    expect(data.preserved[0].content).toContain('[Earlier conversation');
  });

  it('returns the original tail unchanged when nothing to compact', async () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [{ type: 'text', text: 'one' }], track: 'slack:A' }),
      turnStart(2, 'turn_1'),
      turnEnd(3, 'turn_1'),
    ];
    const result = await compact(events, ctx);
    const data = result.compactionEvent.data as any;
    expect(data.messagesCompacted).toBe(0);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest --run packages/agent/src/compaction/__tests__/track-compaction.test.ts -t "splitAtTailBoundary|compact\\(\\)"`
Expected: FAIL — `splitAtTailBoundary` and `compact` not exported.

- [ ] **Step 3: Implement**

Append to `packages/agent/src/compaction/track-compaction.ts`:

```ts
import { renderCompactionPrefix } from './track-render';
import type { CompactionContext, CompactionResult } from './types';
import type { LaceEvent } from '@lace/agent/threads/types';
import { generateEventId } from '@lace/agent/utils/generate-event-id';

const TAIL_TURNS = 10;

/**
 * Split events into [earlier, tail] at the boundary that gives `tailTurns`
 * complete turns at the end. A turn is `prompt + turn_start ... turn_end`.
 * Snaps leftward if the boundary would split an assistant tool_use from its
 * matching tool_result.
 */
export function splitAtTailBoundary(
  events: TypedDurableEvent[],
  tailTurns: number,
): { earlier: TypedDurableEvent[]; tail: TypedDurableEvent[] } {
  // Walk backwards counting turn_end events; the boundary is just before the
  // prompt that opens the (tailTurns)-th turn from the end.
  const turnEndSeqs: number[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'turn_end') turnEndSeqs.push(i);
    if (turnEndSeqs.length >= tailTurns) break;
  }
  if (turnEndSeqs.length < tailTurns) {
    return { earlier: [], tail: events.slice() };
  }
  const earliestTailTurnEndIdx = turnEndSeqs[turnEndSeqs.length - 1];
  // Walk back from that turn_end to find its matching turn_start.
  const targetTurnId = events[earliestTailTurnEndIdx].turnId;
  let boundary = earliestTailTurnEndIdx;
  for (let i = earliestTailTurnEndIdx; i >= 0; i--) {
    if (events[i].type === 'turn_start' && events[i].turnId === targetTurnId) {
      // Include the preceding prompt if present.
      if (i > 0 && events[i - 1].type === 'prompt') {
        boundary = i - 1;
      } else {
        boundary = i;
      }
      break;
    }
  }
  // Snap leftward if any tool_use in `earlier` has its matching tool_result in `tail`.
  boundary = snapLeftIfOrphanedTool(events, boundary);
  return { earlier: events.slice(0, boundary), tail: events.slice(boundary) };
}

function snapLeftIfOrphanedTool(events: TypedDurableEvent[], boundary: number): number {
  while (boundary > 0) {
    const oldToolCallIds = new Set<string>();
    for (let i = 0; i < boundary; i++) {
      const e = events[i];
      if (e.type === 'tool_use') {
        oldToolCallIds.add((e.data as ToolUseEventData).toolCallId);
      }
    }
    let hasOrphan = false;
    for (let i = boundary; i < events.length; i++) {
      const e = events[i];
      if (e.type !== 'message') continue;
      const content = (e.data as MessageEventData).content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as { type?: string; toolCallId?: string };
        if (b.type === 'tool_result' && b.toolCallId && oldToolCallIds.has(b.toolCallId)) {
          hasOrphan = true;
          break;
        }
      }
      if (hasOrphan) break;
    }
    if (!hasOrphan) return boundary;
    boundary -= 1;
  }
  return boundary;
}

/**
 * Track-based compaction orchestrator. Pure: returns the event the caller
 * should write, without writing it.
 */
export async function compact(
  events: TypedDurableEvent[],
  _ctx: CompactionContext,
): Promise<CompactionResult> {
  const { earlier, tail } = splitAtTailBoundary(events, TAIL_TURNS);

  let prefixContent: string;
  if (earlier.length === 0) {
    prefixContent = '[Earlier conversation, compacted by track]\n(no earlier content)';
  } else {
    const turnToTrack = buildTurnToTrackMap(events);
    const groups = groupEarlierEventsByTrack(earlier, turnToTrack);
    const blocks: TrackBlock[] = [];
    for (const [trackId, trackEvents] of groups) {
      const block = salienceForTrack(trackId, trackEvents);
      if (block) blocks.push(block);
    }
    prefixContent = renderCompactionPrefix({
      blocks,
      scheduler: { alarmsPending: 0, remindersPending: 0 },
    });
  }

  const preservedTail = tail
    .filter((e) => e.type === 'message' || e.type === 'prompt')
    .map((e) => preservedMessageFromEvent(e));

  const compactionEvent: LaceEvent = {
    id: generateEventId(),
    type: 'COMPACTION', // legacy in-memory type; on-disk serializer writes 'context_compacted'
    timestamp: new Date(),
    context: { threadId: _ctx.threadId },
    data: {
      strategy: 'track-based',
      messagesCompacted: earlier.length,
      preserved: [
        { role: 'user' as const, content: prefixContent },
        ...preservedTail,
      ],
    },
  };

  return { compactionEvent, compactedEvents: [] };
}

function preservedMessageFromEvent(e: TypedDurableEvent): {
  role: 'user' | 'assistant';
  content: string;
} {
  const text = extractText(e);
  return { role: e.type === 'prompt' ? 'user' : 'assistant', content: text };
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest --run packages/agent/src/compaction/__tests__/track-compaction.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/compaction/track-compaction.ts packages/agent/src/compaction/__tests__/track-compaction.test.ts
git commit -m "compaction: wire compact() orchestrator with tail-snap"
```

---

## Task 8: LLM fallback for oversize tracks

**Files:**
- Modify: `packages/agent/src/compaction/track-compaction.ts`
- Test: `packages/agent/src/compaction/__tests__/track-compaction.test.ts`

When a single track's deterministic block exceeds 5,000 tokens (estimated), call `ctx.provider` or `ctx.agent` to summarize. Same provider as the session — no provider-pinning.

- [ ] **Step 1: Write failing test**

Append to `packages/agent/src/compaction/__tests__/track-compaction.test.ts`:

```ts
import type { AIProvider } from '@lace/agent/providers/base-provider';

describe('compact() with LLM fallback', () => {
  it('calls provider.createResponse when a track block exceeds 5K tokens', async () => {
    const calls: { messages: any; tools: any }[] = [];
    const mockProvider = {
      createResponse: async (messages: any, tools: any) => {
        calls.push({ messages, tools });
        return { content: 'condensed summary', usage: { promptTokens: 0, completionTokens: 50 } };
      },
      setSystemPrompt: () => {},
    } as unknown as AIProvider;

    // Build a huge slack track: many prompts with long bodies.
    const events: TypedDurableEvent[] = [];
    let seq = 1;
    const longText = 'x'.repeat(2500);
    for (let i = 0; i < 12; i++) {
      events.push(event(seq++, 'prompt', {
        content: [{ type: 'text', text: `<messages><current count="1"><slack_message user="U">${longText}</slack_message></current></messages>` }],
        track: 'slack:T:C:0',
      }));
      events.push(turnStart(seq++, `turn_${i}`));
      events.push(turnEnd(seq++, `turn_${i}`));
    }
    // Add 10 trailing turns to satisfy the tail-size requirement.
    for (let i = 0; i < 10; i++) {
      events.push(event(seq++, 'prompt', { content: [], track: 'slack:T:C:1' }));
      events.push(turnStart(seq++, `tail_${i}`));
      events.push(turnEnd(seq++, `tail_${i}`));
    }
    const result = await compact(events, { threadId: 'sess', provider: mockProvider });
    expect(calls.length).toBeGreaterThan(0);
    const data = result.compactionEvent.data as any;
    expect(data.preserved[0].content).toContain('condensed summary');
  });

  it('does NOT call provider when all tracks fit', async () => {
    let called = false;
    const mockProvider = {
      createResponse: async () => {
        called = true;
        return { content: '', usage: { promptTokens: 0, completionTokens: 0 } };
      },
      setSystemPrompt: () => {},
    } as unknown as AIProvider;
    const events: TypedDurableEvent[] = [];
    let seq = 1;
    for (let i = 0; i < 12; i++) {
      events.push(event(seq++, 'prompt', { content: [{ type: 'text', text: 'short' }], track: 'slack:T:C:0' }));
      events.push(turnStart(seq++, `turn_${i}`));
      events.push(turnEnd(seq++, `turn_${i}`));
    }
    await compact(events, { threadId: 'sess', provider: mockProvider });
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest --run packages/agent/src/compaction/__tests__/track-compaction.test.ts -t "LLM fallback"`
Expected: FAIL — provider never called.

- [ ] **Step 3: Implement**

In `packages/agent/src/compaction/track-compaction.ts`, add a constant and a helper, and replace the loop inside `compact()`:

```ts
const SOFT_TOKEN_CAP_PER_TRACK = 5_000;

async function maybeShrinkBlock(
  block: TrackBlock,
  ctx: CompactionContext,
): Promise<TrackBlock> {
  if (block.estimatedTokens <= SOFT_TOKEN_CAP_PER_TRACK) return block;
  if (!ctx.provider && !ctx.agent) return block; // no summarizer available; return as-is
  const prompt =
    `Summarize the following ${block.trackId.split(':')[0]} track conversation concisely. ` +
    `Preserve who said what, key decisions, and open questions. ` +
    `Output at most 800 tokens.\n\n${block.body}`;
  let summary = '';
  try {
    if (ctx.agent) {
      summary = await ctx.agent.generateSummary(prompt, []);
    } else if (ctx.provider) {
      const resp = await ctx.provider.createResponse(
        [{ role: 'user', content: prompt }],
        [],
        'default',
      );
      summary = resp.content;
    }
  } catch {
    return block; // on error, keep deterministic block
  }
  const body = `### ${block.trackId}\n${summary}`;
  return { trackId: block.trackId, body, estimatedTokens: estimate(body) };
}
```

In the `compact()` body, change the block-collection to be async:

```ts
    const blocks: TrackBlock[] = [];
    for (const [trackId, trackEvents] of groups) {
      const block = salienceForTrack(trackId, trackEvents);
      if (!block) continue;
      blocks.push(await maybeShrinkBlock(block, _ctx));
    }
```

(Rename `_ctx` to `ctx` since we now use it — remove the underscore in the parameter list.)

- [ ] **Step 4: Verify pass**

Run: `npx vitest --run packages/agent/src/compaction/__tests__/track-compaction.test.ts`
Expected: PASS (all tests including LLM-fallback).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/compaction/track-compaction.ts packages/agent/src/compaction/__tests__/track-compaction.test.ts
git commit -m "compaction: add LLM fallback for tracks exceeding 5K-token cap"
```

---

## Task 9: Update `/compact` slash command

**Files:**
- Modify: `packages/agent/src/conversation/slash-commands.ts:1-225` (specifically lines 13-14 imports and lines 133-211 `case 'compact'`)

The current `/compact` calls `compactDroppedMessagesWithCore` against the provider-message array. The new one reads canonical events, calls `compact()`, writes `context_compacted` via `writeAndAdvance`.

- [ ] **Step 1: Find current callsite**

Read `packages/agent/src/conversation/slash-commands.ts:133-211` to locate the `case 'compact'` branch and the `writeAndAdvance` parameter passed by the caller.

- [ ] **Step 2: Write failing test**

Find an existing `slash-commands.test.ts` (if present) or create one that asserts /compact emits an event with `strategy: 'track-based'`. Skip this step's detailed code if the test file doesn't exist; instead add the assertion to the existing RPC integration test in Task 10 and rely on type-checking + the integration test in Task 13 to catch regressions here.

- [ ] **Step 3: Replace the case body**

Replace lines 13-14:
```ts
import { compact } from '@lace/agent/compaction/track-compaction';
import { readDurableEvents } from '@lace/agent/storage/event-log';
```
(Remove the imports of `compactDroppedMessagesWithCore` and `SUMMARIZER_SYSTEM_PROMPT`.)

Replace the `case 'compact'` body with:
```ts
    case 'compact': {
      try {
        const sessionDir = ctx.session.dir;
        const events = readDurableEvents(sessionDir);
        if (events.length === 0) {
          return finishTurn('Context is already minimal. Nothing to compact.');
        }
        const result = await compact(events, {
          threadId: ctx.session.meta.sessionId,
          provider: ctx.provider,
        });
        await writeAndAdvance({
          type: 'context_compacted',
          data: result.compactionEvent.data,
        });
        return finishTurn(`Context compacted. ${
          (result.compactionEvent.data as { messagesCompacted: number }).messagesCompacted
        } earlier events folded into prefix; last 10 turns preserved verbatim.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return finishTurn(`Error during compaction: ${msg}`);
      }
    }
```

(Adapt parameter names to whatever the existing slash-command signature provides — `ctx.session`, `ctx.provider`, `writeAndAdvance` are the names the current file uses; confirm by reading the function signature in `slash-commands.ts`.)

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit -p packages/agent/tsconfig.json`
Expected: no errors. If errors, fix the parameter names.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/conversation/slash-commands.ts
git commit -m "conversation: /compact uses new track-based compact()"
```

---

## Task 10: Update `ent/session/compact` RPC handler

**Files:**
- Modify: `packages/agent/src/rpc/handlers/session-operations.ts:39-40, 424-580`
- Test: `packages/agent/src/rpc/handlers/__tests__/session-operations.compact-prompt.test.ts` (update)

Replace the dual-strategy dispatcher with a single call to the new `compact()`.

- [ ] **Step 1: Update RPC handler**

Replace lines 39-40:
```ts
import { compact } from '@lace/agent/compaction/track-compaction';
```
(Remove the imports of `compactDroppedMessagesWithCore` and `SUMMARIZER_SYSTEM_PROMPT`.)

Replace the `peer.onRequest('ent/session/compact', ...)` body (lines 424-580 approximately) with:
```ts
  peer.onRequest('ent/session/compact', async (params: unknown) => {
    assertSessionReady(state);

    const parsed = params as { strategy?: string } | undefined;
    if (parsed?.strategy && parsed.strategy !== 'track-based') {
      throwInvalidParams('strategy must be track-based (legacy strategies removed)');
    }

    return await runExclusive(async () => {
      const sessionDir = state.activeSession!.dir;
      const events = readDurableEvents(sessionDir);
      const { messages: beforeMessages, systemPrompt } = buildProviderMessagesFromDurableEvents(
        sessionDir,
      );
      const previousTokens =
        estimateProviderTokens(beforeMessages) + estimateTokens(systemPrompt);

      const sessionStateForConfig = readSessionState(sessionDir);
      const effectiveConfig = getEffectiveConfig(state.config, sessionStateForConfig.config);

      const provider = await createProviderForTurn({
        connectionId: effectiveConfig.connectionId,
        modelId: effectiveConfig.modelId,
      });

      const result = await compact(events, {
        threadId: state.activeSession!.meta.sessionId,
        provider,
      });

      let sessionState = readSessionState(sessionDir);
      const { nextState } = appendDurableEvent(sessionDir, sessionState, {
        type: 'context_compacted',
        data: result.compactionEvent.data,
      });
      sessionState = nextState;
      writeSessionState(sessionDir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);

      const { messages: afterMessages } = buildProviderMessagesFromDurableEvents(sessionDir);
      const currentTokens = estimateProviderTokens(afterMessages) + estimateTokens(systemPrompt);

      return {
        previousTokens,
        currentTokens,
        messagesCompacted: (result.compactionEvent.data as { messagesCompacted: number })
          .messagesCompacted,
      };
    });
  });
```

Add the `readDurableEvents` import if not already present.

- [ ] **Step 2: Update test**

`packages/agent/src/rpc/handlers/__tests__/session-operations.compact-prompt.test.ts` references the old `strategy: 'summarize' | 'trim-tool-results'` enum. Update it to:
- Pass `strategy: 'track-based'` (or no strategy)
- Assert the returned event has `data.strategy === 'track-based'`
- Drop assertions on `targetTokens`, `preserveRecent`, `summary` (these are no longer in the response)

- [ ] **Step 3: Verify**

Run: `npx vitest --run packages/agent/src/rpc/handlers/__tests__/session-operations.compact-prompt.test.ts`
Expected: PASS after updates.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/rpc/handlers/session-operations.ts packages/agent/src/rpc/handlers/__tests__/session-operations.compact-prompt.test.ts
git commit -m "rpc: ent/session/compact uses track-based compact(); remove legacy strategies"
```

---

## Task 11: Hook trigger in runner.run() after turn_end

**Files:**
- Modify: `packages/agent/src/core/conversation/runner.ts` (after the `turn_end` write at line ~1000)
- Test: `packages/agent/src/core/conversation/__tests__/runner.test.ts`

After the runner writes `turn_end`, call the trigger; if it fires, call `compact()` and write the resulting event via the same raw `appendDurableEvent` path the runner uses elsewhere.

- [ ] **Step 1: Write failing test**

Add a test that runs a turn at 70% pressure with a clean stopReason, then asserts a `context_compacted` event appears in the session's event log:

```ts
it('fires track-based compaction after turn_end at 60%+ pressure', async () => {
  const mockProvider = makeMockProvider([
    {
      stopReason: 'end_turn',
      content: [{ type: 'text', text: 'done' }],
      usage: {
        promptTokens: 700_000,
        completionTokens: 10,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    },
  ]);
  // ...run a turn via test harness (existing patterns), then:
  const events = readDurableEvents(sessionDir);
  expect(events.some((e) => e.type === 'context_compacted')).toBe(true);
});

it('does not fire on error stop reasons', async () => {
  const mockProvider = makeMockProvider([
    {
      stopReason: 'provider_error_overloaded',
      content: [],
      usage: { promptTokens: 900_000, completionTokens: 0 },
    },
  ]);
  const events = readDurableEvents(sessionDir);
  expect(events.some((e) => e.type === 'context_compacted')).toBe(false);
});
```

(Adapt to runner test harness conventions; reuse `makeMockProvider` if it exists, or follow the pattern of nearby tests.)

- [ ] **Step 2: Verify failure**

Run the new tests. Expected: FAIL — no compaction fires.

- [ ] **Step 3: Implement**

In `runner.ts`, immediately after the successful `turn_end` write (after the try/catch that wraps `writeAndAdvance({type: 'turn_end', ...})` at ~line 1000), add:

```ts
      // Track-based compaction trigger. Synchronous in the runner's
      // runExclusive scope; uses the raw appendDurableEvent path (the runner
      // is already inside the scope).
      try {
        const usage = {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheCreationInputTokens: totalCacheCreationInputTokens,
          cacheReadInputTokens: totalCacheReadInputTokens,
          lastCallInputContextTokens:
            lastCallInputTokens +
            lastCallCacheCreationInputTokens +
            lastCallCacheReadInputTokens,
          costUsd: turnCostUsd,
        };
        const contextWindowSize = provider.getModelContextWindow();
        const pressure = computePressure(usage, contextWindowSize);
        if (shouldFireCompaction({ stopReason, pressure })) {
          const events = readDurableEvents(sessionDir);
          const result = await compact(events, { threadId: sessionId, provider });
          let sessionState = readSessionState(sessionDir);
          const { nextState } = appendDurableEvent(sessionDir, sessionState, {
            type: 'context_compacted',
            data: result.compactionEvent.data,
          });
          writeSessionState(sessionDir, nextState);
        }
      } catch (compactionErr) {
        logger.error('runner: track-based compaction failed', {
          err: compactionErr instanceof Error ? compactionErr.message : String(compactionErr),
          turnId,
          stopReason,
        });
        // No persistent disable. Pressure stays high; next turn re-evaluates.
      }
```

Add imports at the top of `runner.ts`:
```ts
import { computePressure, shouldFireCompaction } from './compaction-trigger';
import { compact } from '@lace/agent/compaction/track-compaction';
```

The names `sessionDir`, `sessionId`, `provider` must match the runner's local variable names — read lines 360-400 to confirm.

- [ ] **Step 4: Verify pass**

Run: `npx vitest --run packages/agent/src/core/conversation/__tests__/runner.test.ts -t "compaction"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/core/conversation/runner.ts packages/agent/src/core/conversation/__tests__/runner.test.ts
git commit -m "runner: wire track-based compaction trigger after turn_end"
```

---

## Task 12: Delete legacy compaction strategy files

**Files:**
- Delete: `packages/agent/src/compaction/summarize-strategy.ts`
- Delete: `packages/agent/src/compaction/summarize-strategy.test.ts`
- Delete: `packages/agent/src/compaction/registry.ts`
- Delete: `packages/agent/src/compaction/compact-dropped-messages.ts`
- Delete: `packages/agent/src/compaction/trim-tool-results-strategy.ts`
- Delete: `packages/agent/src/compaction/trim-tool-results-strategy.test.ts`
- Modify: `packages/agent/src/compaction/index.ts` (drop deleted exports)
- Modify: `packages/agent/src/compaction/types.ts` (drop `CompactionStrategy` interface if unused)

- [ ] **Step 1: Delete files**

```bash
rm packages/agent/src/compaction/summarize-strategy.ts \
   packages/agent/src/compaction/summarize-strategy.test.ts \
   packages/agent/src/compaction/registry.ts \
   packages/agent/src/compaction/compact-dropped-messages.ts \
   packages/agent/src/compaction/trim-tool-results-strategy.ts \
   packages/agent/src/compaction/trim-tool-results-strategy.test.ts
```

- [ ] **Step 2: Update barrel + types**

Read `packages/agent/src/compaction/index.ts` and remove any exports from deleted files. Add:
```ts
export { compact } from './track-compaction';
```

Read `packages/agent/src/compaction/types.ts`. If `CompactionStrategy` interface has no remaining callers (verify with `grep -rn "CompactionStrategy"` in `src/`), remove it. Keep `CompactionContext` and `CompactionResult` since the new code uses them.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit -p packages/agent/tsconfig.json`
Expected: no errors. If errors point to other callers, follow the import trail and update those callsites.

- [ ] **Step 4: Verify full test suite**

Run: `npx vitest --run packages/agent`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/compaction/
git commit -m "compaction: delete legacy summarize + trim-tool-results + registry"
```

---

## Task 13: Integration test against the Ada fixture

**Files:**
- Create: `packages/agent/src/compaction/__tests__/track-compaction.integration.test.ts`

This test reads the real Ada fixture from `sen2/compaction/fixtures/ada-main/events.jsonl` and verifies the new `compact()` runs end-to-end on it. The fixture path is outside the lace repo — the test reads via a path computed from `__dirname`; if missing, the test skips with a clear message.

- [ ] **Step 1: Write the test**

Create the file:

```ts
// ABOUTME: Integration test running compact() against Ada's real session fixture
// ABOUTME: Fixture lives outside the lace repo at sen2/compaction/fixtures/ada-main/

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { compact } from '../track-compaction';
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../../../../../compaction/fixtures/ada-main/events.jsonl',
);

describe('compact() against Ada fixture', () => {
  it.skipIf(!existsSync(FIXTURE_PATH))(
    'compacts a 2,036-event session into a prefix < 30K tokens',
    async () => {
      const raw = readFileSync(FIXTURE_PATH, 'utf-8');
      const events: TypedDurableEvent[] = raw
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as TypedDurableEvent);

      const result = await compact(events, { threadId: 'sess_ada_fixture' });
      const data = result.compactionEvent.data as {
        strategy: string;
        messagesCompacted: number;
        preserved: { role: string; content: string }[];
      };

      expect(data.strategy).toBe('track-based');
      expect(data.preserved.length).toBeGreaterThan(0);

      const prefix = data.preserved[0].content;
      expect(prefix).toContain('[Earlier conversation, compacted by track]');

      // Rough token check: prefix should be well under 30K tokens.
      const estPrefixTokens = Math.ceil(prefix.length / 4);
      expect(estPrefixTokens).toBeLessThan(30_000);

      // The Ada fixture has Slack threads + jobs + alarms.
      expect(prefix).toContain('## Slack threads');
      expect(prefix).toContain('## Subagent jobs');
    },
    30_000,
  );
});
```

- [ ] **Step 2: Verify**

Run: `npx vitest --run packages/agent/src/compaction/__tests__/track-compaction.integration.test.ts`
Expected (if fixture present): PASS. Expected (if fixture absent): test is skipped — fine.

- [ ] **Step 3: Eyeball the rendered prefix**

Add a manual smoke step: run the test with `--reporter=verbose` and dump the rendered prefix to console if the assertion fails. Eyeball the output for obvious gaps (e.g., a thread's user prompts not appearing, jobs not listed).

```bash
LACE_DUMP_COMPACTION=1 npx vitest --run packages/agent/src/compaction/__tests__/track-compaction.integration.test.ts
```

(Add a `console.log(prefix)` guarded by `if (process.env.LACE_DUMP_COMPACTION)` inside the test body so this works.)

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/compaction/__tests__/track-compaction.integration.test.ts
git commit -m "compaction: integration test against Ada fixture"
```

---

## Final checks

- [ ] **Run full test suite**

```bash
npx vitest --run packages/agent
```
Expected: all green.

- [ ] **Run lint**

```bash
npm run lint --workspace=packages/agent
```
Expected: clean.

- [ ] **Run typecheck**

```bash
npx tsc --noEmit -p packages/agent/tsconfig.json
```
Expected: no errors.

- [ ] **Run full lace build**

```bash
npm run build
```
Expected: success.

- [ ] **Use superpowers:finishing-a-development-branch** to complete the branch (commit any outstanding work, prepare for merge to main).
