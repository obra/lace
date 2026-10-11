import { isDeepStrictEqual } from 'node:util';
import type { DurableHandoffStatus } from '@lace/ent-protocol';
import { readAllSessionEventLines, type DurableEvent } from '@lace/agent/storage/event-log';
import { PROCESS_DIED_STOP_REASON } from '@lace/agent/storage/event-types';

export type DurableHandoffResult = {
  durableHandoffStatus: DurableHandoffStatus;
};

type StrictEventReadResult = { ok: true; events: DurableEvent[] } | { ok: false; error: unknown };

export function readDurableEventsForHandoff(sessionDir: string): StrictEventReadResult {
  const events: DurableEvent[] = [];
  for (const line of readAllSessionEventLines(sessionDir)) {
    try {
      const parsed = JSON.parse(line) as DurableEvent;
      if (typeof parsed.eventSeq !== 'number') {
        return { ok: false, error: new Error('durable event missing eventSeq') };
      }
      events.push(parsed);
    } catch (error) {
      return { ok: false, error };
    }
  }
  return { ok: true, events };
}

export function classifyPromptHandoff(
  events: DurableEvent[],
  idempotencyKey: string,
  content: unknown[],
  activeTurnId?: string
): DurableHandoffStatus {
  const prompt = events.find(
    (event) => event.type === 'prompt' && eventIdempotencyKey(event) === idempotencyKey
  );
  if (!prompt) return classifyContextInjectedHandoff(events, idempotencyKey, content);
  if (!isDeepStrictEqual(prompt.data?.content, content)) return 'duplicate-unsafe-retry';
  if (!prompt.turnId) return 'duplicate-unsafe-retry';
  if (activeTurnId === prompt.turnId) return 'duplicate-in-progress';

  const laterSameTurnEvents = events.filter(
    (event) => event.eventSeq > prompt.eventSeq && event.turnId === prompt.turnId
  );
  if (
    laterSameTurnEvents.some(
      (event) => event.type === 'message' || event.type === 'tool_use' || event.type === 'turn_end'
    )
  ) {
    return 'duplicate-already-handled';
  }

  return 'duplicate-unsafe-retry';
}

export function isCompletedHandoffTurn(stopReason: unknown): boolean {
  return stopReason === 'end_turn' || stopReason === 'refusal';
}

// A process death can bypass the live turn-exit drain. An explicit prompt retry may resume
// that interrupted work without appending its already-owned source again. Normal completed
// history and a later successful continuation remain no-ops; failed continuations stay pending.
export function hasInterruptedImmediateHandoff(
  events: DurableEvent[],
  idempotencyKey: string
): boolean {
  const injection = events.find(
    (event) => event.type === 'context_injected' && eventIdempotencyKey(event) === idempotencyKey
  );
  if (!injection || injection.data.priority !== 'immediate') return false;
  if (
    events.some((event) => event.type === 'prompt' && eventIdempotencyKey(event) === idempotencyKey)
  )
    return false;
  let opening: DurableEvent | undefined;
  for (const event of events) {
    if (
      event.type === 'turn_start' &&
      event.eventSeq < injection.eventSeq &&
      (!opening || event.eventSeq > opening.eventSeq)
    )
      opening = event;
  }
  if (!opening?.turnId) return false;
  const interruptedEnd = events.find(
    (event) =>
      event.type === 'turn_end' &&
      event.turnId === opening.turnId &&
      event.eventSeq > injection.eventSeq &&
      event.data.stopReason === PROCESS_DIED_STOP_REASON
  );
  if (!interruptedEnd) return false;
  return !events.some(
    (event) =>
      event.type === 'turn_end' &&
      event.eventSeq > interruptedEnd.eventSeq &&
      isCompletedHandoffTurn(event.data.stopReason)
  );
}

export function classifyContextInjectedHandoff(
  events: DurableEvent[],
  idempotencyKey: string,
  content: unknown[]
): DurableHandoffStatus {
  const event = events.find(
    (event) => event.type === 'context_injected' && eventIdempotencyKey(event) === idempotencyKey
  );
  if (!event) return 'persisted-new';
  return isDeepStrictEqual(event.data?.content, content)
    ? 'duplicate-already-handled'
    : 'duplicate-unsafe-retry';
}

export function rejectHandoffSourceMetadata(params: unknown): void {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return;
  if (!Object.prototype.hasOwnProperty.call(params, 'source')) return;
  throw {
    code: -32602,
    message: 'source metadata is not accepted',
    data: { category: 'protocol' },
  };
}

export function handoffError(
  message: string,
  durableHandoffStatus: DurableHandoffStatus,
  code = 0
): {
  code: number;
  message: string;
  data: { category: string; durableHandoffStatus: DurableHandoffStatus };
} {
  return {
    code,
    message,
    data: { category: 'session', durableHandoffStatus },
  };
}

export function withDurableHandoffStatus(
  error: unknown,
  durableHandoffStatus: DurableHandoffStatus
): unknown {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const data =
      record.data && typeof record.data === 'object' && !Array.isArray(record.data)
        ? (record.data as Record<string, unknown>)
        : {};
    record.data = { ...data, durableHandoffStatus };
    return error;
  }

  return handoffError(String(error), durableHandoffStatus);
}

function eventIdempotencyKey(event: DurableEvent): string | undefined {
  const value = event.data?.idempotencyKey;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
