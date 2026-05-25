// ABOUTME: Spawn a subagent process - native child process or in-container exec stream
// ABOUTME: Returns a unified SubagentProcessHandle that subagent-job uses uniformly

import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type { ContainerManager } from '@lace/agent/containers/container-manager';
import type { ContainerSpec } from '@lace/agent/containers/spec';
import type { ExecStreamHandle } from '@lace/agent/containers/types';
import type { MountRegistryEntry } from '@lace/agent/server-types';
import { buildPersonaContainerSpec, type PersonaContainerRuntime } from './persona-container-spec';

/**
 * Uniform handle over a subagent process — either a native child process
 * (root personas) or a `docker exec -i` / `container exec` stream into a
 * persona container. The subagent-job machinery wires stdin/stdout/stderr
 * into JsonRpcPeer regardless of which strategy spawned the process.
 */
export interface SubagentProcessHandle {
  // Concrete Node stream types match the NDJSON transport's expectations and
  // both spawn strategies produce them (native ChildProcess; container exec's
  // underlying spawned `docker exec -i` / `container exec` child process).
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  /** Current exit code; null until the process exits. */
  readonly exitCode: number | null;
  kill(signal: NodeJS.Signals): void;
  /** Subscribe to exit. Fires at most once. */
  onExit(cb: (info: { code: number | null; signal: NodeJS.Signals | null }) => void): void;
  /**
   * Subscribe to spawn-time errors (native only). Container spawn errors
   * throw from spawnSubagent() rather than firing this listener.
   */
  onSpawnError(cb: (err: Error) => void): void;
  /**
   * Resolves when the process has exited. Idempotent.
   */
  wait(): Promise<{ exitCode: number | null }>;
  /**
   * Native ChildProcess if this handle wraps one; null for container exec
   * streams. Exposed only so JobState.proc can keep its existing type for
   * legacy consumers (job-control.ts, rpc/handlers/jobs.ts).
   */
  readonly nativeProcess: ChildProcess | null;
  /**
   * Container exec stream if this handle wraps one; null for native spawns.
   * Stored on JobState.containerExec for cleanup.
   */
  readonly containerExec: ExecStreamHandle | null;
}

export interface SpawnSubagentOptions {
  parentSessionId: string;
  personaName?: string;
  personaContainerRuntime?: PersonaContainerRuntime;
  containerManager: ContainerManager | null;
  containerMounts: Readonly<Record<string, MountRegistryEntry>>;
  skillDirs?: readonly string[];
  // Required when personaContainerRuntime.containerSharing === 'per_invocation'.
  // Provides the child subagent's session id for unique container naming (PRI-1796).
  childSessionId?: string;
  scratchDirHostPath?: string;
}

export class SubagentSpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubagentSpawnError';
  }
}

// Path lace-agent lives at inside persona container images. Fixed by spec
// (K-49e architecture decision B: image bakes lace at this path, dev mounts
// it there). Lace itself does not toggle delivery modes.
const IN_CONTAINER_LACE_ENTRY = '/lace/packages/agent/dist/main.js';

export async function spawnSubagent(options: SpawnSubagentOptions): Promise<SubagentProcessHandle> {
  if (options.personaContainerRuntime) {
    if (!options.personaName) {
      throw new SubagentSpawnError(
        'Container runtime spawn requires a persona name (delegate must pass persona arg)'
      );
    }
    if (!options.containerManager) {
      throw new SubagentSpawnError(
        `Persona '${options.personaName}' requests a container runtime but the host ` +
          `platform '${process.platform}' has no supported container runtime.`
      );
    }
    return spawnContainerSubagent({
      parentSessionId: options.parentSessionId,
      personaName: options.personaName,
      runtime: options.personaContainerRuntime,
      containerManager: options.containerManager,
      containerMounts: options.containerMounts,
      skillDirs: options.skillDirs,
      childSessionId: options.childSessionId,
      scratchDirHostPath: options.scratchDirHostPath,
    });
  }

  return spawnNativeSubagent();
}

function spawnNativeSubagent(): SubagentProcessHandle {
  const proc = spawn(process.execPath, [process.argv[1] ?? ''], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // stdio: ['pipe', 'pipe', 'pipe'] guarantees these are non-null.
  const stdin = proc.stdin;
  const stdout = proc.stdout;
  const stderr = proc.stderr;
  if (!stdin || !stdout || !stderr) {
    throw new SubagentSpawnError('Failed to create stdio pipes for child process');
  }

  const waiter = new Promise<{ exitCode: number | null }>((resolve) => {
    proc.once('exit', (code) => resolve({ exitCode: code }));
  });

  return {
    stdin,
    stdout,
    stderr,
    get exitCode() {
      return proc.exitCode;
    },
    kill(signal: NodeJS.Signals) {
      proc.kill(signal);
    },
    onExit(cb) {
      proc.once('exit', (code, signal) => cb({ code, signal }));
    },
    onSpawnError(cb) {
      proc.on('error', cb);
    },
    wait() {
      return waiter;
    },
    nativeProcess: proc,
    containerExec: null,
  };
}

async function spawnContainerSubagent(input: {
  parentSessionId: string;
  personaName: string;
  runtime: PersonaContainerRuntime;
  containerManager: ContainerManager;
  containerMounts: Readonly<Record<string, MountRegistryEntry>>;
  skillDirs?: readonly string[];
  childSessionId?: string;
  scratchDirHostPath?: string;
}): Promise<SubagentProcessHandle> {
  // buildPersonaContainerSpec performs strict input validation and surfaces
  // unknown mount names before any container materialization, so failures here
  // are cheap and clearly attributable.
  const spec = buildPersonaContainerSpec({
    parentSessionId: input.parentSessionId,
    personaName: input.personaName,
    childSessionId: input.childSessionId,
    scratchDirHostPath: input.scratchDirHostPath,
    runtime: input.runtime,
    containerMounts: input.containerMounts,
    skillDirs: input.skillDirs,
  });

  return materializeAndExecStream(spec, input.containerManager);
}

async function materializeAndExecStream(
  spec: ContainerSpec,
  containerManager: ContainerManager
): Promise<SubagentProcessHandle> {
  await containerManager.materialize(spec);

  const handle = await containerManager.execStream(spec.name, {
    command: ['node', IN_CONTAINER_LACE_ENTRY],
    workingDirectory: spec.workingDirectory,
  });

  // Track exit so .exitCode reflects state without forcing every caller to
  // await wait().
  let exitCode: number | null = null;
  const waitPromise: Promise<{ exitCode: number | null }> = handle.wait().then((info) => {
    exitCode = info.exitCode;
    return { exitCode: info.exitCode };
  });

  const exitListeners: Array<
    (info: { code: number | null; signal: NodeJS.Signals | null }) => void
  > = [];
  void waitPromise.then(({ exitCode: code }) => {
    for (const cb of exitListeners) cb({ code, signal: null });
  });

  return {
    stdin: handle.stdin,
    stdout: handle.stdout,
    stderr: handle.stderr,
    get exitCode() {
      return exitCode;
    },
    kill(signal: NodeJS.Signals) {
      handle.kill(signal);
    },
    onExit(cb) {
      exitListeners.push(cb);
    },
    onSpawnError(_cb) {
      // Container spawn surfaces errors synchronously from spawnContainerSubagent,
      // not via this listener. No-op kept so the interface is consistent.
    },
    wait() {
      return waitPromise;
    },
    nativeProcess: null,
    containerExec: handle,
  };
}
