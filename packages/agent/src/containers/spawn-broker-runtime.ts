// ABOUTME: SpawnBrokerContainerRuntime — the ContainerRuntime that drives the spawn
// ABOUTME: broker over its unix socket instead of running Docker locally. create()
// ABOUTME: maps to the broker's `spawn` (the broker builds the WHOLE spec from its
// ABOUTME: own catalog); identity is broker-owned. The SELECTOR fields are SELECTOR ONLY.

import { BaseContainerRuntime } from './runtime';
import type {
  ContainerConfig,
  ContainerInfo,
  ContainerMount,
  ContainerState,
  ExecOptions,
  ExecResult,
  ExecStreamHandle,
  ExecStreamOptions,
} from './types';
import { brokerExecStream, brokerRequestJson } from './spawn-broker-client';

export class SpawnBrokerRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpawnBrokerRuntimeError';
  }
}

const CONTAINER_STATES: readonly ContainerState[] = ['created', 'running', 'stopped', 'failed'];

function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SpawnBrokerRuntimeError(`broker response missing string field '${field}'`);
  }
  return value;
}

function expectState(value: unknown): ContainerState {
  if (typeof value === 'string' && (CONTAINER_STATES as readonly string[]).includes(value)) {
    return value as ContainerState;
  }
  throw new SpawnBrokerRuntimeError(
    `broker response has invalid container state '${String(value)}'`
  );
}

function toMounts(value: unknown): ContainerMount[] {
  if (!Array.isArray(value)) {
    throw new SpawnBrokerRuntimeError('broker response missing mounts array');
  }
  return value.map((raw): ContainerMount => {
    if (typeof raw !== 'object' || raw === null) {
      throw new SpawnBrokerRuntimeError('broker mount entry is not an object');
    }
    const m = raw as Record<string, unknown>;
    return {
      source: expectString(m.source, 'mount.source'),
      target: expectString(m.target, 'mount.target'),
      ...(typeof m.readonly === 'boolean' ? { readonly: m.readonly } : {}),
    };
  });
}

function toContainerInfo(value: unknown): ContainerInfo {
  if (typeof value !== 'object' || value === null) {
    throw new SpawnBrokerRuntimeError('broker response has no container info');
  }
  const info = value as Record<string, unknown>;
  return {
    id: expectString(info.id, 'info.id'),
    state: expectState(info.state),
    ...(typeof info.exitCode === 'number' ? { exitCode: info.exitCode } : {}),
    ...(Array.isArray(info.mounts) ? { mounts: toMounts(info.mounts) } : {}),
  };
}

function errorFrom(res: Record<string, unknown>, op: string): SpawnBrokerRuntimeError {
  const message = typeof res.error === 'string' ? res.error : 'unknown error';
  return new SpawnBrokerRuntimeError(`broker ${op} failed: ${message}`);
}

async function collect(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * ContainerRuntime implementation that delegates every privileged operation to
 * the spawn broker. main-sen has NO docker.sock; this client reaches the broker's
 * listen socket (mounted RO) and the broker is the only holder of docker access.
 *
 * Lifecycle mapping:
 * - create() → `spawn`. The broker IGNORES the caller's image/mounts/network/etc.
 *   and rebuilds the full ContainerConfig from its own catalog using only
 *   `config.persona`. create() forwards only the SELECTOR fields
 *   (persona/parentSessionId/childSessionId) — they shape nothing broker-side.
 *   The broker also create+start+netns'es the container, so start() is a no-op.
 * - execStream()/exec() → `execStream`. The broker mints/strips/injects the agent
 *   token; the caller never controls identity. jobId is omitted (the broker falls
 *   back to the spawn jobId — per-job audit fidelity is follow-up #159).
 * - stop/remove/daemonInspect/adopt/list → the matching broker verbs.
 * - inspect() (sync) + translate* read the client-side cache populated at
 *   spawn/adopt from the broker's resolvedMounts.
 */
export class SpawnBrokerContainerRuntime extends BaseContainerRuntime {
  private readonly socketPath: string;

  constructor(input: { socketPath: string }) {
    super();
    this.socketPath = input.socketPath;
  }

  async create(config: ContainerConfig): Promise<string> {
    const { persona, parentSessionId, childSessionId } = config;
    if (!persona) {
      throw new SpawnBrokerRuntimeError(
        'SpawnBrokerContainerRuntime.create requires config.persona — the broker only spawns personas'
      );
    }
    if (!parentSessionId) {
      throw new SpawnBrokerRuntimeError(
        'SpawnBrokerContainerRuntime.create requires config.parentSessionId (SELECTOR field)'
      );
    }
    // Persistent personas (e.g. persistent-box) carry NO childSessionId — the spec
    // builder intentionally omits it (persistent containers are named by persona,
    // not per-child). The broker protocol REQUIRES a path-safe childSessionId, but
    // BrokerPersonaCatalog ignores it for persistent name/scratch derivation, so
    // substituting the (already path-safe) parentSessionId is safe and keeps one
    // spawn path. Without this, persistent-box would throw at first spawn.
    const wireChildSessionId = childSessionId ?? parentSessionId;
    // jobId stand-in = the wire childSessionId (no protocol change; the broker
    // refines per-exec attribution on the first execStream — see follow-up #159).
    const res = await brokerRequestJson(this.socketPath, {
      op: 'spawn',
      persona,
      parentSessionId,
      childSessionId: wireChildSessionId,
      jobId: wireChildSessionId,
    });
    if (res.ok !== true) throw errorFrom(res, 'spawn');
    const containerName = expectString(res.containerName, 'containerName');
    const state = expectState(res.state);
    const resolvedMounts = toMounts(res.resolvedMounts);
    this.cacheContainer(containerName, state, config, resolvedMounts);
    return containerName;
  }

  // The broker's `spawn` already created + started + netns-init'd the container.
  async start(_containerId: string): Promise<void> {}

  async stop(containerId: string, timeout?: number): Promise<void> {
    const res = await brokerRequestJson(this.socketPath, {
      op: 'stop',
      containerName: containerId,
      ...(timeout !== undefined ? { timeoutSeconds: timeout } : {}),
    });
    if (res.ok !== true) throw errorFrom(res, 'stop');
    this.updateContainerState(containerId, 'stopped');
  }

  async remove(containerId: string): Promise<void> {
    const res = await brokerRequestJson(this.socketPath, {
      op: 'destroy',
      containerName: containerId,
    });
    if (res.ok !== true) throw errorFrom(res, 'destroy');
    this.containers.delete(containerId);
    this.unregisterMounts(containerId);
  }

  async exec(containerId: string, options: ExecOptions): Promise<ExecResult> {
    const handle = await this.execStream(containerId, {
      command: options.command,
      ...(options.workingDirectory ? { workingDirectory: options.workingDirectory } : {}),
      ...(options.environment ? { environment: options.environment } : {}),
      ...(options.environmentMode ? { environmentMode: options.environmentMode } : {}),
    });
    if (options.stdin !== undefined) handle.stdin.write(options.stdin);
    handle.stdin.end();
    const [stdout, stderr, completion] = await Promise.all([
      collect(handle.stdout),
      collect(handle.stderr),
      handle.wait(),
    ]);
    return { stdout, stderr, exitCode: completion.exitCode };
  }

  async execStream(containerId: string, options: ExecStreamOptions): Promise<ExecStreamHandle> {
    // jobId omitted: the broker falls back to the spawn jobId from its ownership
    // record (per-exec jobId threading is follow-up #159 — audit fidelity only).
    return brokerExecStream(this.socketPath, {
      op: 'execStream',
      containerName: containerId,
      command: options.command,
      ...(options.environment ? { environment: options.environment } : {}),
      ...(options.workingDirectory ? { workingDirectory: options.workingDirectory } : {}),
      ...(options.environmentMode ? { environmentMode: options.environmentMode } : {}),
    });
  }

  override async daemonInspect(containerId: string): Promise<ContainerInfo | null> {
    const res = await brokerRequestJson(this.socketPath, {
      op: 'status',
      containerName: containerId,
    });
    if (res.ok !== true) throw errorFrom(res, 'status');
    if (res.exists !== true) return null;
    return toContainerInfo(res.info);
  }

  override async adopt(config: ContainerConfig, _state: ContainerState): Promise<void> {
    const containerName = config.name ?? config.id;
    if (!containerName) {
      throw new SpawnBrokerRuntimeError(
        'adopt requires config.name or config.id to name the container'
      );
    }
    const res = await brokerRequestJson(this.socketPath, {
      op: 'adopt',
      containerName,
    });
    if (res.ok !== true) throw errorFrom(res, 'adopt');
    const adoptedState = expectState(res.state);
    const resolvedMounts = toMounts(res.resolvedMounts);
    this.cacheContainer(containerName, adoptedState, config, resolvedMounts);
  }

  override async list(): Promise<ContainerInfo[]> {
    const res = await brokerRequestJson(this.socketPath, { op: 'list' });
    if (res.ok !== true) throw errorFrom(res, 'list');
    if (!Array.isArray(res.containers)) {
      throw new SpawnBrokerRuntimeError('broker list returned no containers array');
    }
    return res.containers.map((c) => toContainerInfo(c));
  }

  // Populate the in-process caches from the broker's resolved truth so the sync
  // inspect() + translate* (file-tool host-direct path mapping) work locally. The
  // broker's resolvedMounts — not the caller's ignored config.mounts — are the
  // real bind mounts, so they back the mountMap.
  private cacheContainer(
    containerName: string,
    state: ContainerState,
    config: ContainerConfig,
    resolvedMounts: ContainerMount[]
  ): void {
    this.containers.set(containerName, { id: containerName, state, mounts: resolvedMounts });
    this.registerMounts(containerName, {
      ...config,
      name: containerName,
      id: containerName,
      mounts: resolvedMounts,
    });
  }
}
