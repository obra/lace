// ABOUTME: Trusted session affinity and current-role memory access, outside model configuration.
import type { HostMemoryBinding } from '@lace/ent-protocol';
import type { AgentServerState } from '../server-types';
import type { SessionMeta, SessionState } from '../storage/session-store';
import type { MemoryRuntime } from './types';
const sessions = new WeakMap<
  MemoryRuntime,
  Map<string, { role: string; binding: HostMemoryBinding }>
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
  return { memoryInstanceId: runtime.configuration.binding.instanceId, reader };
}
export function childMemoryConfiguration(state: AgentServerState, role: string, actorId: string) {
  const runtime = state.memory;
  if (!runtime) return undefined;
  return {
    databasePath: runtime.configuration.databasePath,
    binding: runtime.bindingForRole(role, actorId),
  };
}
