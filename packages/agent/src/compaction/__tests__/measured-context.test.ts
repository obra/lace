// ABOUTME: Tests for sizing the preserved tail against the model's REPORTED context
// ABOUTME: size rather than the local chars/4 floor (PRI-2947). Covers the
// ABOUTME: measurement lookup, the estimator calibration scale, and the effect on
// ABOUTME: trimTailToTokenBudget / track-based compact().

import { describe, it, expect } from 'vitest';
import type { DurableEventData, TypedDurableEvent } from '@lace/agent/storage/event-types';
import {
  lastReportedContextTokens,
  estimateCurrentContextTokens,
  contextMeasurementScale,
  trimTailToTokenBudget,
  estimateTailTokens,
  splitAtTailBoundary,
} from '../toolkit';
import { compact } from '../track-compaction';
import { estimateProviderTokens } from '@lace/agent/utils/token-estimation';
import type { ProviderMessage } from '@lace/agent/providers/base-provider';

const event = (
  seq: number,
  type: DurableEventData['type'],
  data: Record<string, unknown>,
  turnId?: string
): TypedDurableEvent => ({
  eventSeq: seq,
  timestamp: `2026-08-25T00:00:${String(seq).padStart(2, '0')}Z`,
  ...(turnId ? { turnId } : {}),
  type,
  data: { type, ...data } as TypedDurableEvent['data'],
});

/** A turn whose assistant message carries `chars` characters of text. */
const sizedTurn = (
  startSeq: number,
  t: number,
  chars: number,
  lastCallInputContextTokens?: number
): TypedDurableEvent[] => {
  const turnId = `turn_${t}`;
  return [
    event(startSeq, 'prompt', {
      content: [{ type: 'text', text: `msg ${t}` }],
      track: `ext:T${t}`,
    }),
    event(startSeq + 1, 'turn_start', {}, turnId),
    event(startSeq + 2, 'message', { content: 'x'.repeat(chars) }, turnId),
    event(
      startSeq + 3,
      'turn_end',
      {
        stopReason: 'end_turn',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          ...(lastCallInputContextTokens !== undefined ? { lastCallInputContextTokens } : {}),
        },
      },
      turnId
    ),
  ];
};

const buildSession = (turnSizes: number[], measured?: number): TypedDurableEvent[] => {
  const events: TypedDurableEvent[] = [];
  let seq = 1;
  turnSizes.forEach((chars, t) => {
    // Only the newest turn carries the measurement, mirroring what a live
    // session looks like at the moment compaction runs.
    const isLast = t === turnSizes.length - 1;
    events.push(...sizedTurn(seq, t, chars, isLast ? measured : undefined));
    seq += 4;
  });
  return events;
};

// ---------------------------------------------------------------------------
// Finding the measurement in the durable log
// ---------------------------------------------------------------------------

describe('lastReportedContextTokens', () => {
  it('returns the newest turn_end’s reported context size', () => {
    const events = [...sizedTurn(1, 0, 10, 111_000), ...sizedTurn(5, 1, 10, 222_000)];
    expect(lastReportedContextTokens(events)).toBe(222_000);
  });

  it('is undefined — not zero — when no turn reported one', () => {
    // Legacy transcripts, a first turn, or a provider that reports nothing.
    // Zero would read as "empty context" and suppress compaction forever.
    const events = buildSession([10, 10]);
    expect(lastReportedContextTokens(events)).toBeUndefined();
  });

  it('ignores a measurement taken before the last compaction', () => {
    // That figure describes the pre-compaction context. Pairing it with an
    // estimate of the post-compaction event set would invent a huge scale and
    // peel the tail to nothing.
    const events = [
      ...sizedTurn(1, 0, 10, 900_000),
      event(5, 'context_compacted', { strategy: 'track-based', preserved: [] }),
      ...sizedTurn(6, 1, 10),
    ];
    expect(lastReportedContextTokens(events)).toBeUndefined();
  });
});

describe('estimateCurrentContextTokens', () => {
  it('measures the whole event stream when nothing has been compacted', () => {
    const events = buildSession([20_000, 20_000]);
    expect(estimateCurrentContextTokens(events)).toBe(
      estimateTailTokens(splitAtTailBoundary(events, 10).tail)
    );
  });

  it('counts the compaction prefix plus the events after it, not the summarized history', () => {
    // The replayed context is the preserved prefix + everything since. Counting
    // the pre-compaction events too would inflate the denominator and quietly
    // cancel the correction on any session that has compacted before.
    const preserved = [{ role: 'user', content: 'y'.repeat(4_000) }];
    const events: TypedDurableEvent[] = [
      ...sizedTurn(1, 0, 100_000),
      event(5, 'context_compacted', { strategy: 'track-based', preserved }),
      ...sizedTurn(6, 1, 8_000),
    ];
    const estimated = estimateCurrentContextTokens(events);
    // prefix 4000 chars + one 8000-char turn ≈ 3k tokens; the 100k-char turn
    // before the compaction must not be in there.
    expect(estimated).toBeLessThan(5_000);
    expect(estimated).toBeGreaterThan(2_000);
  });
});

describe('estimateProviderTokens on a malformed history', () => {
  it('counts an unrecognized content shape as no text instead of throwing', () => {
    // Calibration estimates the WHOLE log, not just the slice about to be
    // preserved, so it is the first thing to meet a history no other code path
    // ever folded. sen-core's replay of ada's real bad-state session folds to
    // entries with no `content` field at all, and the estimator's declared type
    // says that cannot happen. Throwing here takes compaction down on exactly
    // the sessions that need it most.
    const malformed = [
      { role: 'user' },
      { role: 'assistant', content: null },
      { role: 'user', content: [null, { type: 'text', text: 'abcd' }] },
    ] as unknown as ProviderMessage[];
    expect(estimateProviderTokens(malformed)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Reconciling the measurement with the local estimate
// ---------------------------------------------------------------------------

describe('contextMeasurementScale', () => {
  it('is exactly 1 when there is no measurement', () => {
    const events = buildSession([20_000, 20_000]);
    expect(contextMeasurementScale(events, undefined)).toBe(1);
  });

  it('is the ratio by which the local estimator under-reads reality', () => {
    const events = buildSession([20_000, 20_000]);
    const estimated = estimateCurrentContextTokens(events);
    expect(contextMeasurementScale(events, estimated * 4)).toBeCloseTo(4, 5);
  });

  it('never shrinks the estimate below the local one', () => {
    // Clamped at 1 so the change can only ever make compaction size the tail
    // more truthfully, never less.
    const events = buildSession([20_000, 20_000]);
    const estimated = estimateCurrentContextTokens(events);
    expect(contextMeasurementScale(events, Math.floor(estimated / 3))).toBe(1);
  });

  it('ignores a nonsensical measurement rather than trusting it', () => {
    const events = buildSession([20_000, 20_000]);
    expect(contextMeasurementScale(events, 0)).toBe(1);
    expect(contextMeasurementScale(events, -5)).toBe(1);
    expect(contextMeasurementScale(events, Number.NaN)).toBe(1);
  });

  it('is 1 when there is nothing to calibrate against', () => {
    // No estimable text at all: the ratio would be a division by zero, and any
    // number we invented from it would be a guess.
    expect(contextMeasurementScale([], 600_000)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The behavior PRI-2947 is about
// ---------------------------------------------------------------------------

describe('trimTailToTokenBudget with a measured context size', () => {
  it('peels turns the local estimate said would fit, when the model says otherwise', () => {
    // The bug, in one test. A short session whose durable text estimates at a
    // few thousand tokens but that the provider reports at 633K: the estimate
    // wins, nothing is peeled, and `earlier` comes back empty.
    const events = buildSession([20_000, 20_000, 20_000, 20_000, 20_000]);
    const budget = 300_000;

    const blind = trimTailToTokenBudget(events, 10, budget);
    expect(blind.earlier).toEqual([]);

    const measured = trimTailToTokenBudget(events, 10, budget, undefined, 633_419);
    expect(measured.earlier.length).toBeGreaterThan(0);
    expect(measured.tail.length).toBeLessThan(blind.tail.length);
  });

  it('reads the measurement out of the log when the caller passes none', () => {
    // /compact and ent.session.compact hold no live usage figure; the newest
    // turn_end does.
    const events = buildSession([20_000, 20_000, 20_000, 20_000, 20_000], 633_419);
    expect(trimTailToTokenBudget(events, 10, 300_000).earlier.length).toBeGreaterThan(0);
  });

  it('prefers the caller’s figure over the log’s', () => {
    // The runner's in-flight number is fresher than the last turn_end — which
    // matters most on the emergency path, where the turn that blew the window
    // has not written one yet.
    const events = buildSession([20_000, 20_000, 20_000, 20_000, 20_000], 10);
    expect(trimTailToTokenBudget(events, 10, 300_000).earlier).toEqual([]);
    expect(
      trimTailToTokenBudget(events, 10, 300_000, undefined, 633_419).earlier.length
    ).toBeGreaterThan(0);
  });

  it('leaves a healthy session alone', () => {
    // The direction that must not regress: a session the model reports as
    // comfortably inside the budget keeps its whole tail. The scaled estimate
    // of the FULL tail is the measurement itself, so "over budget" now means
    // exactly what the compaction trigger means by it.
    const events = buildSession([20_000, 20_000, 20_000, 20_000, 20_000]);
    const baseline = trimTailToTokenBudget(events, 10, 300_000);
    const healthy = trimTailToTokenBudget(events, 10, 300_000, undefined, 120_000);
    expect(healthy.tail.map((e) => e.eventSeq)).toEqual(baseline.tail.map((e) => e.eventSeq));
    expect(healthy.earlier).toEqual([]);
  });

  it('changes nothing when the measurement is absent', () => {
    const events = buildSession(Array(12).fill(20_000));
    const before = trimTailToTokenBudget(events, 10, 12_000);
    const after = trimTailToTokenBudget(events, 10, 12_000, undefined, undefined);
    expect(after.tail.map((e) => e.eventSeq)).toEqual(before.tail.map((e) => e.eventSeq));
  });

  it('does not manufacture an earlier slice out of a single-turn session', () => {
    // The peel loop bottoms out at one turn, and a one-turn split hands back
    // the leading system_prompt_set as `earlier` — non-empty, but no
    // conversation. A strategy would read that as something to summarize and
    // write a compaction that preserved the entire history verbatim, spending
    // the breakpoint that authorized it on nothing at all. That is the PRI-2945
    // wedge, and getting the tail measurement right must not walk back into it.
    const events: TypedDurableEvent[] = [
      event(1, 'system_prompt_set', { text: 'You are a test assistant.' }),
      ...sizedTurn(2, 0, 20_000),
    ];
    const trimmed = trimTailToTokenBudget(events, 10, 300_000, undefined, 633_419);
    expect(trimmed.earlier).toEqual([]);
    return compact(events, {
      threadId: 's_single',
      contextWindow: 1_000_000,
      measuredContextTokens: 633_419,
    }).then((result) => {
      expect('noop' in result).toBe(true);
    });
  });

  it('still preserves the in-flight turn when the measurement dwarfs the budget', () => {
    const events = buildSession([20_000, 20_000, 20_000]);
    const trimmed = trimTailToTokenBudget(events, 10, 1_000, undefined, 5_000_000);
    expect(trimmed.tail.length).toBe(4);
  });
});

describe('track-based compact() with a measured context size', () => {
  it('sheds history on a short session the model reports as full', () => {
    // Fewer turns than TAIL_TURNS, so the turn-count split alone yields no
    // `earlier` — the only thing that can produce one is the tail budget, and
    // before PRI-2947 the budget was compared against a number an order of
    // magnitude below reality.
    const events = buildSession([20_000, 20_000, 20_000, 20_000, 20_000]);

    return Promise.all([
      compact(events, { threadId: 's_blind', contextWindow: 1_000_000 }),
      compact(events, {
        threadId: 's_measured',
        contextWindow: 1_000_000,
        measuredContextTokens: 633_419,
      }),
    ]).then(([blind, measured]) => {
      expect('noop' in blind).toBe(true);
      expect('compactionEvent' in measured).toBe(true);
    });
  });

  it('still noops on a short session the model reports as nearly empty', () => {
    const events = buildSession([20_000, 20_000, 20_000, 20_000, 20_000]);
    return compact(events, {
      threadId: 's_healthy',
      contextWindow: 1_000_000,
      measuredContextTokens: 40_000,
    }).then((result) => {
      expect('noop' in result).toBe(true);
    });
  });
});
