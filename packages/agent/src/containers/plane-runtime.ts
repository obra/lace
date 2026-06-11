// ABOUTME: Standalone ContainerRuntime that talks the sen-docker plane client.
// ABOUTME: The plane owns docker create/start details; lace sends selector verbs only.

import { execFile, spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { promisify } from 'util';
import { logger } from '@lace/agent/utils/logger';
import { appendEnvironmentOverlayArgs, commandWithExecEnvironment } from './exec-environment';
import {
  ContainerConfig,
  ContainerError,
  ContainerInfo,
  ContainerNotFoundError,
  ContainerRuntime,
  ContainerState,
  ExecOptions,
  ExecResult,
  ExecStreamHandle,
  ExecStreamOptions,
  PlaneSpawnRequest,
} from './types';

const execFileAsync = promisify(execFile);

export interface PlaneRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PlaneRunOptions {
  timeout?: number;
}

export interface PlaneRunner {
  run(args: string[], options?: PlaneRunOptions): Promise<PlaneRunResult>;
}

type ExecFileError = Error & {
  code?: number | string;
  killed?: boolean;
  signal?: string;
  stdout?: string;
  stderr?: string;
};

function synthesizeJobId(sessionId: string): string {
  const short = sessionId.replace(/^sess_/, '').slice(0, 24) || 'unknown';
  return `job_${short}`;
}

class ExecFilePlaneRunner implements PlaneRunner {
  constructor(private readonly planeBin: string) {}

  async run(args: string[], options: PlaneRunOptions = {}): Promise<PlaneRunResult> {
    try {
      const { stdout, stderr } = await execFileAsync(this.planeBin, args, {
        timeout: options.timeout,
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
      };
    } catch (error: unknown) {
      const err = error as ExecFileError;
      if (typeof err.code === 'number') {
        return {
          stdout: err.stdout || '',
          stderr: err.stderr || '',
          exitCode: err.code,
        };
      }
      throw error;
    }
  }
}

// The plane container owns its environment, not the exec caller. Two sources are
// injected into the container at create time and must NOT be re-passed on
// `docker exec -e` (the shim's exec env allowlist deliberately denies caller env to
// keep it inert, so re-passing them fails the exec):
//   1. HOME (shim-injected from the persona's working directory) and PATH (from the
//      image) — always container-provided.
//   2. Every persona-declared var in the container's own spec env (e.g.
//      NODE_EXTRA_CA_CERTS) — the shim injects these at create from the persona file.
// Strip both from the inherit-mode `-e` overlay. `env -i` replace-mode
// (commandWithExecEnvironment) is left to the caller, which owns the full env there.
const ALWAYS_CONTAINER_PROVIDED_ENV = new Set(['HOME', 'PATH']);

function withoutContainerProvidedEnv<T extends { environment?: Record<string, string> }>(
  options: T,
  containerEnv?: Record<string, string>
): T {
  if (!options.environment) {
    return options;
  }
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.environment)) {
    if (ALWAYS_CONTAINER_PROVIDED_ENV.has(key)) {
      continue;
    }
    if (containerEnv && Object.prototype.hasOwnProperty.call(containerEnv, key)) {
      continue;
    }
    environment[key] = value;
  }
  return { ...options, environment };
}

export class PlaneRuntime implements ContainerRuntime {
  private readonly runner: PlaneRunner;
  private readonly containers = new Map<string, ContainerInfo>();
  private readonly configs = new Map<string, ContainerConfig | PlaneSpawnRequest>();

  constructor(
    private readonly planeBin: string,
    options: { run?: PlaneRunner['run'] } = {}
  ) {
    this.runner = options.run ? { run: options.run } : new ExecFilePlaneRunner(planeBin);
  }

  async create(config: PlaneSpawnRequest | ContainerConfig): Promise<string> {
    const persona = config.persona;
    if (!persona) {
      throw new ContainerError(
        'PlaneRuntime.create requires config.persona (selector field)',
        config.name ?? config.id
      );
    }
    const role = config.role;
    if (!role) {
      throw new ContainerError(
        'PlaneRuntime.create requires config.role (credential-helper authz selector)',
        config.name ?? config.id
      );
    }
    const requestedName = config.id ?? config.name ?? config.jobId ?? persona;

    const parentSession =
      config.parentSession ??
      ('parentSessionId' in config ? config.parentSessionId : undefined) ??
      '';
    const childSession =
      config.childSession ?? ('childSessionId' in config ? config.childSessionId : undefined) ?? '';
    const jobId = config.jobId ?? synthesizeJobId(childSession || parentSession);

    logger.info('Spawning persona via sen-docker plane', {
      persona,
      role,
      parentSession,
      childSession: childSession || undefined,
      jobId,
    });

    const result = await this.runChecked(
      ['spawn', persona, parentSession, childSession, jobId, role],
      requestedName,
      `plane spawn failed for persona '${persona}'`
    );
    const name = result.stdout.trim() || requestedName;
    this.containers.set(name, {
      id: name,
      state: 'running',
      mounts: 'mounts' in config ? config.mounts : undefined,
      startedAt: new Date(),
    });
    this.configs.set(name, { ...config, id: name });
    return name;
  }

  async start(containerId: string): Promise<void> {
    const info = this.containers.get(containerId);
    if (!info) {
      throw new ContainerNotFoundError(containerId);
    }
    if (info.state === 'running') {
      return;
    }
    throw new ContainerError(
      `PlaneRuntime cannot start stopped plane container ${containerId}; create/spawn is the only supported start path`,
      containerId
    );
  }

  async stop(containerId: string, timeout?: number): Promise<void> {
    const args = ['stop'];
    if (timeout !== undefined) {
      args.push('-t', String(Math.max(0, Math.floor(timeout / 1000))));
    }
    args.push(containerId);
    await this.runChecked(args, containerId, 'plane stop failed');
    this.updateContainerState(containerId, 'stopped');
  }

  async remove(containerId: string): Promise<void> {
    await this.runChecked(['rm', '-f', containerId], containerId, 'plane rm failed');
    this.containers.delete(containerId);
    this.configs.delete(containerId);
  }

  // The shim owns the per_invocation lifecycle: `release` destroys the child's
  // container AND removes its `/work` workspace. lace just sends the verb and
  // drops the child from its local cache.
  async releasePerInvocation(parentSession: string, childSession: string): Promise<void> {
    await this.runChecked(
      ['release', parentSession, childSession],
      childSession,
      'plane release failed'
    );
    // `create` keys the cache under the container name (spawn stdout), not the bare
    // session id, so we cannot delete by `childSession` directly. Find the cached
    // entry whose config records this child and evict it from both maps.
    const cachedKey = this.cacheKeyForChild(childSession);
    if (cachedKey !== undefined) {
      this.containers.delete(cachedKey);
      this.configs.delete(cachedKey);
    }
  }

  private cacheKeyForChild(childSession: string): string | undefined {
    for (const [key, config] of this.configs) {
      const cachedChild =
        config.childSession ?? ('childSessionId' in config ? config.childSessionId : undefined);
      if (cachedChild === childSession) {
        return key;
      }
    }
    return undefined;
  }

  async exec(containerId: string, options: ExecOptions): Promise<ExecResult> {
    const info = this.containers.get(containerId);
    if (!info) {
      throw new ContainerNotFoundError(containerId);
    }
    if (info.state !== 'running') {
      throw new ContainerError(`Container ${containerId} is not running`, containerId);
    }
    if (options.stdin !== undefined) {
      throw new ContainerError(
        'PlaneRuntime.exec does not support stdin; use execStream for interactive commands',
        containerId
      );
    }

    const args: string[] = ['exec'];
    if (options.workingDirectory) {
      args.push('-w', options.workingDirectory);
    }
    appendEnvironmentOverlayArgs(
      args,
      withoutContainerProvidedEnv(options, this.containerEnvFor(containerId))
    );
    args.push(containerId, ...commandWithExecEnvironment(options));

    try {
      return await this.runner.run(args, { timeout: options.timeout ?? 30000 });
    } catch (error: unknown) {
      if (this.isTimeoutError(error)) {
        throw new ContainerError(
          'Execution timeout',
          containerId,
          error instanceof Error ? error : undefined
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new ContainerError(
        `Failed to exec in plane container: ${message}`,
        containerId,
        error instanceof Error ? error : undefined
      );
    }
  }

  async execStream(containerId: string, options: ExecStreamOptions): Promise<ExecStreamHandle> {
    const info = this.containers.get(containerId);
    if (!info) {
      throw new ContainerNotFoundError(containerId);
    }
    if (info.state !== 'running') {
      throw new ContainerError(`Container ${containerId} is not running`, containerId);
    }

    const args: string[] = ['exec-stream', '-i'];
    if (options.longLived) {
      args.push('--long-lived');
    }
    if (options.workingDirectory) {
      args.push('-w', options.workingDirectory);
    }
    appendEnvironmentOverlayArgs(
      args,
      withoutContainerProvidedEnv(options, this.containerEnvFor(containerId))
    );
    args.push(containerId, ...commandWithExecEnvironment(options));

    logger.debug('Streaming exec in plane container', {
      containerId,
      commandLength: options.command.length,
    });

    let child: ChildProcess;
    try {
      child = spawn(this.planeBin, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ContainerError(
        `Failed to spawn plane exec stream: ${message}`,
        containerId,
        error instanceof Error ? error : undefined
      );
    }

    let spawned = false;
    const waitPromise = new Promise<{ exitCode: number }>((resolve) => {
      let settled = false;
      const settle = (exitCode: number) => {
        if (settled) return;
        settled = true;
        resolve({ exitCode });
      };
      child.once('error', (err) => {
        if (!spawned || settled) return;
        logger.warn('Plane exec stream child errored after spawn', {
          containerId,
          error: err.message,
        });
        settle(1);
      });
      child.once('close', (code) => {
        settle(code ?? 1);
      });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const onSpawn = () => {
          spawned = true;
          child.off('error', onError);
          resolve();
        };
        const onError = (err: Error) => {
          child.off('spawn', onSpawn);
          reject(
            new ContainerError(
              `Failed to spawn plane exec stream: ${err.message}`,
              containerId,
              err
            )
          );
        };
        child.once('spawn', onSpawn);
        child.once('error', onError);
      });
    } catch (error) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Best effort; the process may have failed before it could be killed.
      }
      throw error;
    }

    if (!child.stdin || !child.stdout || !child.stderr) {
      child.kill('SIGKILL');
      throw new ContainerError(
        'Spawned plane exec stream is missing one or more standard streams',
        containerId
      );
    }

    child.stdin.on('error', () => {});

    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      wait: () => waitPromise,
      kill: (signal?: NodeJS.Signals) => {
        child.kill(signal ?? 'SIGTERM');
      },
    };
  }

  async inspect(containerId: string): Promise<ContainerInfo> {
    try {
      return await this.inspectPlaneContainer(containerId, { updateCache: true });
    } catch (error) {
      if (error instanceof ContainerNotFoundError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ContainerError(
        `Failed to inspect plane container: ${message}`,
        containerId,
        error instanceof Error ? error : undefined
      );
    }
  }

  async list(): Promise<ContainerInfo[]> {
    return Array.from(this.containers.values());
  }

  async daemonInspect(containerId: string): Promise<ContainerInfo | null> {
    try {
      return await this.inspectPlaneContainer(containerId);
    } catch (error) {
      if (error instanceof ContainerNotFoundError) return null;
      const message = error instanceof Error ? error.message : String(error);
      throw new ContainerError(
        `Failed to daemon-inspect plane container: ${message}`,
        containerId,
        error instanceof Error ? error : undefined
      );
    }
  }

  async adopt(config: PlaneSpawnRequest | ContainerConfig, _state: ContainerState): Promise<void> {
    await this.create(config);
  }

  private async runChecked(
    args: string[],
    containerId: string | undefined,
    context: string
  ): Promise<PlaneRunResult> {
    try {
      const result = await this.runner.run(args);
      if (result.exitCode !== 0) {
        throw new ContainerError(
          `${context}: ${result.stderr || `exit code ${result.exitCode}`}`,
          containerId
        );
      }
      return result;
    } catch (error: unknown) {
      if (error instanceof ContainerError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ContainerError(
        `${context}: ${message}`,
        containerId,
        error instanceof Error ? error : undefined
      );
    }
  }

  // The persona spec env the shim injected into this container at create time, used
  // to avoid re-passing it on exec (where the shim's allowlist would reject it). Only
  // ContainerConfig carries an `environment`; PlaneSpawnRequest does not.
  private containerEnvFor(containerId: string): Record<string, string> | undefined {
    const config = this.configs.get(containerId);
    return config && 'environment' in config ? config.environment : undefined;
  }

  private updateContainerState(containerId: string, state: ContainerState): void {
    const info = this.containers.get(containerId);
    if (info) {
      info.state = state;
      if (state === 'stopped' || state === 'failed') {
        info.stoppedAt = new Date();
      }
    }
  }

  private isTimeoutError(error: unknown): boolean {
    const err = error as ExecFileError;
    return err.killed === true || err.signal === 'SIGTERM';
  }

  private async inspectPlaneContainer(
    containerId: string,
    options: { updateCache?: boolean } = {}
  ): Promise<ContainerInfo> {
    const state = await this.inspectQuery(containerId, 'state');
    await this.inspectQuery(containerId, 'image');

    const cached = this.containers.get(containerId);
    const info: ContainerInfo = {
      id: containerId,
      state: this.mapPlaneState(state, cached?.state),
    };
    if (cached?.mounts) {
      info.mounts = cached.mounts;
    }
    if (options.updateCache && cached) {
      this.containers.set(containerId, { ...cached, ...info });
    }
    return info;
  }

  private async inspectQuery(containerId: string, key: 'state' | 'image'): Promise<string> {
    const result = await this.runner.run(['inspect', key, containerId]);
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
    const detail = result.stderr || `exit code ${result.exitCode}`;
    if (this.isPlaneNotFoundError(detail)) {
      throw new ContainerNotFoundError(containerId);
    }
    throw new ContainerError(`plane inspect ${key} failed: ${detail}`, containerId);
  }

  private mapPlaneState(statusText: string, cachedState?: ContainerState): ContainerState {
    const status = statusText.trim().toLowerCase();
    if (status === 'running') return 'running';
    if (status === 'created') return 'created';
    if (status === 'exited' || status === 'dead' || status === 'removing') return 'stopped';
    if (status === '') return cachedState ?? 'failed';
    return cachedState ?? 'failed';
  }

  private isPlaneNotFoundError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('no such container') ||
      normalized.includes('not owned') ||
      normalized.includes('unowned')
    );
  }
}
