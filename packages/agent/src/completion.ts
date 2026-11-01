// ABOUTME: Session settlement belongs to native turn, finalization and inject-drain owners.
// ABOUTME: Reservations cover async gaps; notifications wake observers to read fresh status.
import type { AgentServerState } from './server-types';
import { hasPendingImmediateInjects, readAllSessionEventLines } from './storage/event-log';
import { readSessionState } from './storage/session-store';
import { injectDrainContent } from './notifications/inject-drain-content';

interface SessionCompletion {
  reservations: number;
  consumedEventSeq?: number;
}
interface CompletionOwner {
  sessions: Map<string, SessionCompletion>;
  changed?: (sessionId: string) => void;
}
const owners = new WeakMap<AgentServerState, CompletionOwner>();
function owner(state: AgentServerState): CompletionOwner {
  let value = owners.get(state);
  if (!value) {
    value = { sessions: new Map() };
    owners.set(state, value);
  }
  return value;
}
function sessionCompletion(state: AgentServerState, dir: string): SessionCompletion {
  const sessions = owner(state).sessions;
  let value = sessions.get(dir);
  if (!value) {
    value = { reservations: 0 };
    sessions.set(dir, value);
  }
  return value;
}

export function observeCompletion(
  state: AgentServerState,
  changed: (sessionId: string) => void
): void {
  owner(state).changed = changed;
}

/** Reserve before publishing a terminal event; release after its continuation is owned. */
export function reserveCompletion(state: AgentServerState): () => void {
  const session = state.activeSession;
  if (!session) return () => {};
  const completion = sessionCompletion(state, session.dir);
  completion.reservations++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    completion.reservations--;
    owner(state).changed?.(session.meta.sessionId);
  };
}

/** Use the existing deferred drain, retaining ownership until admission or discard. */
export function scheduleImmediateInjectDrain(
  state: AgentServerState,
  runner: { current: ((content: unknown[]) => Promise<void>) | null },
  producerSessionId: string,
  watermark?: number,
  consumedEventSeq?: number
): void {
  const session = state.activeSession;
  if (!session || session.meta.sessionId !== producerSessionId) return;
  const completion = sessionCompletion(state, session.dir);
  if (consumedEventSeq !== undefined)
    completion.consumedEventSeq = Math.max(completion.consumedEventSeq ?? 0, consumedEventSeq);
  if (
    !runner.current ||
    !hasPendingImmediateInjects(
      session.dir,
      Math.max(watermark ?? 0, completion.consumedEventSeq ?? 0)
    )
  )
    return;
  const release = reserveCompletion(state);
  setImmediate(() => {
    void (async () => {
      try {
        if (state.activeSession?.dir !== session.dir || state.activeTurn || !runner.current) return;
        if (
          !hasPendingImmediateInjects(
            session.dir,
            Math.max(watermark ?? 0, completion.consumedEventSeq ?? 0)
          )
        )
          return;
        await runner.current(injectDrainContent(session.dir));
      } finally {
        release();
      }
    })();
  });
}

/** A synchronous snapshot after all awaits in the status handler. Never emits a wake. */
export function readCompletion(state: AgentServerState) {
  const session = state.activeSession;
  if (!session) return undefined;
  let terminalTurnId: string | undefined;
  let terminalEventSeq = 0;
  let lastStartSeq = 0;
  for (const line of readAllSessionEventLines(session.dir)) {
    let event: { type?: string; turnId?: string; eventSeq?: number };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      continue;
    }
    if (typeof event.eventSeq !== 'number') continue;
    if (event.type === 'turn_start') lastStartSeq = Math.max(lastStartSeq, event.eventSeq);
    if (event.type === 'turn_end' && event.eventSeq > terminalEventSeq) {
      terminalEventSeq = event.eventSeq;
      terminalTurnId = event.turnId;
    }
  }
  const completion = sessionCompletion(state, session.dir);
  const running = [...state.jobManager.getRunningJobs().values()].some((job) => !job.finished);
  return {
    sessionId: session.meta.sessionId,
    ...(terminalTurnId ? { terminalTurnId } : {}),
    observedStreamSeq: readSessionState(session.dir).nextStreamSeq - 1,
    settled:
      !!terminalTurnId &&
      lastStartSeq < terminalEventSeq &&
      !state.activeTurn &&
      !running &&
      completion.reservations === 0 &&
      !hasPendingImmediateInjects(session.dir, completion.consumedEventSeq ?? 0),
  };
}
