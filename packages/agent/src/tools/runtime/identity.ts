import { createHash, randomUUID } from 'node:crypto';
import type { RuntimeExecutionBinding, ToolRuntimeDescriptor } from './types';

type RuntimeMcpPlacement = 'host' | 'toolRuntime';

type RuntimeIdInput =
  | {
      scope: 'session';
      sessionId: string;
      binding: RuntimeExecutionBinding;
    }
  | {
      scope: 'job';
      sessionId: string;
      jobId: string;
      binding: RuntimeExecutionBinding;
    }
  | {
      scope: 'mcp';
      sessionId: string;
      serverId: string;
      placement: RuntimeMcpPlacement;
      transport: string;
      effectiveCwd: string;
      binding: RuntimeExecutionBinding;
    };

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
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(
        ([key, entryValue]) => `${JSON.stringify(key)}:${canonicalRuntimeIdentityJson(entryValue)}`
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function runtimeFingerprint(input: unknown): string {
  return createHash('sha256')
    .update(canonicalRuntimeIdentityJson(input))
    .digest('hex')
    .slice(0, 16);
}

function sortedRecord<T>(value: Record<string, T> | undefined): Record<string, T> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  );
}

function normalizeToolRuntimeForIdentity(toolRuntime: ToolRuntimeDescriptor): unknown {
  if (toolRuntime.type === 'host') {
    return {
      type: toolRuntime.type,
      cwd: toolRuntime.cwd,
    };
  }
  if (toolRuntime.type === 'boundedHost') {
    return {
      type: toolRuntime.type,
      root: toolRuntime.root,
      cwd: toolRuntime.cwd,
    };
  }
  return {
    type: toolRuntime.type,
    spec: {
      image: toolRuntime.spec.image,
      workingDirectory: toolRuntime.spec.workingDirectory,
      mounts: [...toolRuntime.spec.mounts].sort((left, right) =>
        left.containerPath < right.containerPath
          ? -1
          : left.containerPath > right.containerPath
            ? 1
            : 0
      ),
      env: sortedRecord(toolRuntime.spec.env),
      secretEnv: sortedRecord(toolRuntime.spec.secretEnv),
      ports: toolRuntime.spec.ports
        ? [...toolRuntime.spec.ports].sort((left, right) => left.container - right.container)
        : undefined,
    },
    cwd: toolRuntime.cwd,
  };
}

function normalizeRuntimeIdentityInput(input: RuntimeIdInput): unknown {
  const common = {
    schemaVersion: input.binding.schemaVersion,
    scope: input.scope,
    sessionId: input.sessionId,
    ...(input.scope === 'job' ? { jobId: input.jobId } : {}),
    ...(input.scope === 'mcp'
      ? {
          serverId: input.serverId,
          placement: input.placement,
          transport: input.transport,
          effectiveCwd: input.effectiveCwd,
        }
      : {}),
    toolRuntime: normalizeToolRuntimeForIdentity(input.binding.toolRuntime),
  };
  return common;
}

export function buildRuntimeId(input: RuntimeIdInput): string {
  const common = normalizeRuntimeIdentityInput(input);
  const fingerprint = runtimeFingerprint(common);
  if (input.scope === 'job') {
    return `runtime:job:${input.sessionId}:${input.jobId}:${fingerprint}`;
  }
  if (input.scope === 'mcp') {
    return `runtime:mcp:${input.sessionId}:${input.serverId}:${fingerprint}`;
  }
  return `runtime:session:${input.sessionId}:${fingerprint}`;
}
