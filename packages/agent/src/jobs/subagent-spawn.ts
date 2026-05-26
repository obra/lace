// ABOUTME: Spawn a host-side subagent process
// ABOUTME: Returns a SubagentProcessHandle that subagent-job uses uniformly

import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

/**
 * Uniform handle over a native child process. The subagent-job machinery wires
 * stdin/stdout/stderr into JsonRpcPeer.
 */
export interface SubagentProcessHandle {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  /** Current exit code; null until the process exits. */
  readonly exitCode: number | null;
  kill(signal: NodeJS.Signals): void;
  /** Subscribe to exit. Fires at most once. */
  onExit(cb: (info: { code: number | null; signal: NodeJS.Signals | null }) => void): void;
  /** Subscribe to spawn-time errors. */
  onSpawnError(cb: (err: Error) => void): void;
  /**
   * Resolves when the process has exited. Idempotent.
   */
  wait(): Promise<{ exitCode: number | null }>;
  /**
   * Native ChildProcess exposed so JobState.proc can keep its existing type for
   * job-control.ts and rpc/handlers/jobs.ts. Tests may use null fake handles.
   */
  readonly nativeProcess: ChildProcess | null;
}

export interface SpawnSubagentOptions {
  executionEnv?: Record<string, string>;
}

export class SubagentSpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubagentSpawnError';
  }
}

export async function spawnSubagent(options: SpawnSubagentOptions): Promise<SubagentProcessHandle> {
  return spawnNativeSubagent(options.executionEnv);
}

function spawnNativeSubagent(executionEnv?: Record<string, string>): SubagentProcessHandle {
  const proc = spawn(process.execPath, [process.argv[1] ?? ''], {
    cwd: process.cwd(),
    env: { ...process.env, ...(executionEnv ?? {}) },
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
  };
}
