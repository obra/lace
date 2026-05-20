import { createHash, randomUUID } from 'node:crypto';
import type { RuntimeExecutionBinding } from './types';

type RuntimeIdentityScope = 'session' | 'job' | 'mcp';

export function createRuntimeId(): string {
  return `rt_${randomUUID()}`;
}

export function canonicalRuntimeIdentityJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalRuntimeIdentityJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(
        ([key, entryValue]) => `${JSON.stringify(key)}:${canonicalRuntimeIdentityJson(entryValue)}`
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function legacyRuntimeFingerprint(input: unknown): string {
  return createHash('sha256')
    .update(canonicalRuntimeIdentityJson(input))
    .digest('hex')
    .slice(0, 16);
}

export function buildLegacyRuntimeId(input: {
  scope: RuntimeIdentityScope;
  sessionId: string;
  jobId?: string;
  serverId?: string;
  binding: RuntimeExecutionBinding;
}): string {
  const common = {
    schemaVersion: input.binding.schemaVersion,
    agentPlacement: input.binding.agentPlacement,
    scope: input.scope,
    sessionId: input.sessionId,
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.serverId ? { serverId: input.serverId } : {}),
    toolRuntime: input.binding.toolRuntime,
  };
  const fingerprint = legacyRuntimeFingerprint(common);
  if (input.scope === 'job') {
    if (!input.jobId) throw new Error('job-scoped legacy runtime id requires jobId');
    return `legacy:job:${input.sessionId}:${input.jobId}:${fingerprint}`;
  }
  if (input.scope === 'mcp') {
    if (!input.serverId) throw new Error('mcp-scoped legacy runtime id requires serverId');
    return `legacy:mcp:${input.sessionId}:${input.serverId}:${fingerprint}`;
  }
  return `legacy:session:${input.sessionId}:${fingerprint}`;
}
