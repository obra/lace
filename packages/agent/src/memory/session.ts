// ABOUTME: Trusted session affinity and current-role memory access, outside model configuration.
import { logger } from '../utils/logger';
import type { HostMemoryBinding } from '@lace/ent-protocol';
import type { AgentServerState } from '../server-types';
import type { SessionMeta, SessionState } from '../storage/session-store';
import type { AutomaticRecallInput, AutomaticRecallResult, MemoryRuntime } from './types';
const sessions = new WeakMap<
  MemoryRuntime,
  Map<
    string,
    { role: string; binding: HostMemoryBinding; cue?: string; selection?: AutomaticRecallResult }
  >
>();
export function sessionMemory(
  state: AgentServerState,
  session: { meta: SessionMeta; state: SessionState }
) {
  const runtime = state.memory;
  const affinity = session.state.memoryInstanceId;
  if (affinity && (!runtime || runtime.configuration.binding.instanceId !== affinity))
    throw new Error('Session memory authority unavailable or mismatched');
  if (!runtime) return undefined;
  const role = session.meta.persona ?? session.state.config?.personaName ?? 'lace';
  let known = sessions.get(runtime);
  if (!known) {
    known = new Map();
    sessions.set(runtime, known);
  }
  let entry = known.get(session.meta.sessionId);
  if (!entry || entry.role !== role) {
    const binding =
      !entry && !session.meta.parent && role === runtime.configuration.binding.role
        ? runtime.configuration.binding
        : runtime.bindingForRole(role, session.meta.sessionId);
    entry = { role, binding };
    known.set(session.meta.sessionId, entry);
  }
  const reader = runtime.reader(entry.binding);
  const sessionEntry = entry;
  return {
    memoryInstanceId: runtime.configuration.binding.instanceId,
    reader,
    prepareAutomaticRecall: runtime.configuration.recall
      ? async (input: AutomaticRecallInput) => {
          const started = performance.now();
          const key = JSON.stringify(input.cueIds);
          const selection = sessionEntry.cue === key ? sessionEntry.selection : undefined;
          if (!selection) {
            sessionEntry.cue = key;
            sessionEntry.selection = undefined;
          }
          const result = await waitForRecall(
            reader.automatic({ ...input, ...(selection ? { selection } : {}) }),
            input.signal
          );
          input.signal.throwIfAborted();
          sessionEntry.selection = { ...result, groups: result.selected };
          sessionEntry.cue = key;
          const diagnostics = {
            mode: result.mode,
            reason: result.reason,
            coverage: result.coverage,
            groups: result.groups.length,
            originals: result.groups.flatMap((group) =>
              group.originals.map((original) => original.handle)
            ),
            notes: [
              ...new Set(
                result.groups.flatMap((group) =>
                  group.accounts.map((account) => `${account.id}:${account.revision}`)
                )
              ),
            ],
            tokens: result.tokens,
            durationMs: performance.now() - started,
            reused: !!selection,
          };
          logger.info('memory.recall.prepared', diagnostics);
          return { ...result, diagnostics };
        }
      : undefined,
  };
}
export function childMemoryConfiguration(state: AgentServerState, role: string, actorId: string) {
  const runtime = state.memory;
  if (!runtime) return undefined;
  // Delegates read shared memory on demand. The main agent prepares automatic recall.
  return {
    databasePath: runtime.configuration.databasePath,
    binding: runtime.bindingForRole(role, actorId),
  };
}

export function clearSessionMemory(state: AgentServerState) {
  if (state.memory) sessions.get(state.memory)?.clear();
}
async function waitForRecall<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new Error('Recall cancelled'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
