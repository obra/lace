import type { DurableHandoffStatus } from '@lace/ent-protocol';
import { readAllSessionEventLines, type DurableEvent } from '@lace/agent/storage/event-log';

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
  activeTurnId?: string
): DurableHandoffStatus {
  const prompt = events.find(
    (event) => event.type === 'prompt' && eventIdempotencyKey(event) === idempotencyKey
  );
  if (!prompt) return 'persisted-new';
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

export function hasContextInjectedHandoff(events: DurableEvent[], idempotencyKey: string): boolean {
  return events.some(
    (event) => event.type === 'context_injected' && eventIdempotencyKey(event) === idempotencyKey
  );
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
