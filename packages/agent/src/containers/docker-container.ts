// ABOUTME: Docker container runtime using the `docker` CLI
// ABOUTME: Implements ContainerRuntime via docker create/start/stop/exec for lace-managed containers

import { BaseContainerRuntime } from './runtime';
import {
  ContainerConfig,
  ContainerInfo,
  ContainerState,
  ExecOptions,
  ExecResult,
  ExecStreamOptions,
  ExecStreamHandle,
  ContainerError,
  ContainerNotFoundError,
} from './types';
import { logger } from '@lace/agent/utils/logger';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync } from 'fs';

const execFileAsync = promisify(execFile);

const LACE_PREFIX = 'lace-';

type ExecFileError = Error & {
  code?: number | string;
  signal?: string;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
};

interface DockerInspectJson {
  Id?: string;
  Name?: string;
  State?: {
    Status?: string;
    Running?: boolean;
    Pid?: number;
    ExitCode?: number;
    StartedAt?: string;
    FinishedAt?: string;
  };
}

interface DockerPsRowJson {
  ID?: string;
  Names?: string;
  Image?: string;
  State?: string;
  Status?: string;
}

export class DockerContainerRuntime extends BaseContainerRuntime {
  private readonly dockerBin: string;

  constructor(dockerBin: string = 'docker') {
    super();
    this.dockerBin = dockerBin;
  }

  private ensurePrefixed(name: string): string {
    return name.startsWith(LACE_PREFIX) ? name : `${LACE_PREFIX}${name}`;
  }

  private resolveContainerName(config: ContainerConfig): string {
    if (config.name && config.name.length > 0) {
      return this.ensurePrefixed(config.name);
    }
    if (config.id && config.id.length > 0) {
      const suffix = uuidv4().slice(0, 8);
      return this.ensurePrefixed(`${config.id}-${suffix}`);
    }
    return `${LACE_PREFIX}${uuidv4().slice(0, 8)}`;
  }

  private buildCreateArgs(name: string, config: ContainerConfig): string[] {
    const args: string[] = ['create', '--name', name];

    if (config.workingDirectory) {
      args.push('-w', config.workingDirectory);
    }

    for (const mount of config.mounts) {
      const flag = mount.readonly
        ? `${mount.source}:${mount.target}:ro`
        : `${mount.source}:${mount.target}`;
      args.push('-v', flag);
    }

    for (const [key, value] of Object.entries(config.environment || {})) {
      args.push('-e', `${key}=${value}`);
    }

    args.push(config.image);

    if (config.command && config.command.length > 0) {
      args.push(...config.command);
    } else {
      args.push('sleep', 'infinity');
    }

    return args;
  }

  private mapDockerStateToContainerState(state: string | undefined): ContainerState {
    switch ((state || '').toLowerCase()) {
      case 'running':
        return 'running';
      case 'created':
        return 'created';
      case 'exited':
      case 'dead':
      case 'removing':
      case 'paused':
        return 'stopped';
      case 'restarting':
        return 'running';
      default:
        return 'stopped';
    }
  }

  private isNotFoundError(error: unknown): boolean {
    const err = error as ExecFileError;
    const stderr = (err.stderr || '').toLowerCase();
    return (
      stderr.includes('no such container') ||
      stderr.includes('not found') ||
      stderr.includes('no such object')
    );
  }

  private isDockerMissingError(error: unknown): boolean {
    const err = error as ExecFileError & { code?: string | number };
    return err.code === 'ENOENT';
  }

  async create(config: ContainerConfig): Promise<string> {
    const containerName = this.resolveContainerName(config);

    if (this.containers.has(containerName)) {
      throw new ContainerError(`Container name already in use: ${containerName}`, containerName);
    }

    for (const mount of config.mounts) {
      if (!existsSync(mount.source)) {
        logger.info('Creating mount source directory', { path: mount.source });
        mkdirSync(mount.source, { recursive: true });
      }
    }

    const args = this.buildCreateArgs(containerName, config);

    logger.info('Creating docker container', {
      containerId: containerName,
      mountCount: config.mounts.length,
      envCount: Object.keys(config.environment || {}).length,
    });

    try {
      await execFileAsync(this.dockerBin, args);
    } catch (error: unknown) {
      if (this.isDockerMissingError(error)) {
        throw new ContainerError(
          'docker CLI not found on PATH',
          containerName,
          error instanceof Error ? error : undefined
        );
      }
      const errMessage = error instanceof Error ? error.message : String(error);
      const stderr = (error as ExecFileError).stderr || '';
      logger.error('docker create failed', { containerId: containerName, stderr });
      throw new ContainerError(
        `Failed to create container: ${stderr || errMessage}`,
        containerName,
        error instanceof Error ? error : undefined
      );
    }

    const info: ContainerInfo = {
      id: containerName,
      state: 'created',
    };
    this.containers.set(containerName, info);
    this.registerMounts(containerName, config);

    return containerName;
  }

  async start(containerId: string): Promise<void> {
    const info = this.containers.get(containerId);
    if (!info) {
      throw new ContainerNotFoundError(containerId);
    }

    if (info.state === 'running') {
      logger.debug('Container already running', { containerId });
      return;
    }

    try {
      await execFileAsync(this.dockerBin, ['start', containerId]);
      info.state = 'running';
      info.startedAt = new Date();
      logger.info('Started docker container', { containerId });
    } catch (error: unknown) {
      const stderr = (error as ExecFileError).stderr || '';
      const errMessage = error instanceof Error ? error.message : String(error);
      info.state = 'failed';
      throw new ContainerError(
        `Failed to start container: ${stderr || errMessage}`,
        containerId,
        error instanceof Error ? error : undefined
      );
    }
  }

  async stop(containerId: string, timeout?: number): Promise<void> {
    // The in-process cache (`this.containers`) is empty after a parent restart,
    // so destructive operations must go to the daemon rather than gating on cache.
    // `docker stop` is idempotent (no-op on already-stopped, NotFound mapped below).
    const info = this.containers.get(containerId);
    if (info && info.state !== 'running') {
      logger.debug('Container not running, skipping stop', { containerId });
      return;
    }

    const timeoutSec = typeof timeout === 'number' ? Math.max(0, Math.floor(timeout / 1000)) : 10;
    const args = ['stop', '-t', String(timeoutSec), containerId];

    try {
      await execFileAsync(this.dockerBin, args);
      this.updateContainerState(containerId, 'stopped');
      logger.info('Stopped docker container', { containerId });
    } catch (error: unknown) {
      // If docker reports the container doesn't exist, treat as stopped.
      if (this.isNotFoundError(error)) {
        this.updateContainerState(containerId, 'stopped');
        return;
      }
      const stderr = (error as ExecFileError).stderr || '';
      const errMessage = error instanceof Error ? error.message : String(error);
      throw new ContainerError(
        `Failed to stop container: ${stderr || errMessage}`,
        containerId,
        error instanceof Error ? error : undefined
      );
    }
  }

  async remove(containerId: string): Promise<void> {
    // Cache may be empty after a parent restart; `docker rm -f` is idempotent
    // and the NotFound branch below handles the daemon-side "no such container".
    try {
      await execFileAsync(this.dockerBin, ['rm', '-f', containerId]);
      logger.info('Removed docker container', { containerId });
    } catch (error: unknown) {
      if (!this.isNotFoundError(error)) {
        const stderr = (error as ExecFileError).stderr || '';
        const errMessage = error instanceof Error ? error.message : String(error);
        logger.warn('docker rm failed; cleaning local state anyway', {
          containerId,
          error: stderr || errMessage,
        });
      }
    }

    this.containers.delete(containerId);
    this.unregisterMounts(containerId);
  }

  async exec(containerId: string, options: ExecOptions): Promise<ExecResult> {
    const info = this.containers.get(containerId);
    if (!info) {
      throw new ContainerNotFoundError(containerId);
    }
    if (info.state !== 'running') {
      throw new ContainerError(`Container ${containerId} is not running`, containerId);
    }

    const hasStdin = options.stdin !== undefined;
    const args: string[] = ['exec'];

    if (hasStdin) {
      args.push('-i');
    }

    if (options.workingDirectory) {
      args.push('-w', options.workingDirectory);
    }

    for (const [key, value] of Object.entries(options.environment || {})) {
      args.push('-e', `${key}=${value}`);
    }

    args.push(containerId, ...options.command);

    logger.debug('Executing in docker container', {
      containerId,
      commandLength: options.command.length,
    });

    if (hasStdin) {
      return this.execWithStdin(containerId, args, options);
    }

    try {
      const { stdout, stderr } = await execFileAsync(this.dockerBin, args, {
        timeout: options.timeout ?? 30000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
      };
    } catch (error: unknown) {
      const err = error as ExecFileError;

      if (err.killed || err.signal === 'SIGTERM') {
        throw new ContainerError(
          'Execution timeout',
          containerId,
          error instanceof Error ? error : undefined
        );
      }

      if (err.code === 'ERR_CHILD_PROCESS_STDOUT_MAXBUFFER') {
        throw new ContainerError(
          'Exec output exceeded buffer limit',
          containerId,
          error instanceof Error ? error : undefined
        );
      }

      if (typeof err.code === 'number') {
        return {
          stdout: err.stdout || '',
          stderr: err.stderr || '',
          exitCode: err.code,
        };
      }

      const message = err.stderr || err.message || String(error);
      throw new ContainerError(
        `Failed to exec in container: ${message}`,
        containerId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private execWithStdin(
    containerId: string,
    args: string[],
    options: ExecOptions
  ): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.dockerBin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let killedForTimeout = false;
      let timer: NodeJS.Timeout | undefined;

      const timeoutMs = options.timeout ?? 30000;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          killedForTimeout = true;
          child.kill('SIGTERM');
        }, timeoutMs);
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(new ContainerError(`Failed to exec in container: ${err.message}`, containerId, err));
      });
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (killedForTimeout) {
          reject(new ContainerError('Execution timeout', containerId));
          return;
        }
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      });

      if (child.stdin) {
        // Swallow EPIPE if the child exits before draining stdin — close handler is authoritative.
        child.stdin.on('error', () => {});
        child.stdin.end(options.stdin);
      }
    });
  }

  async execStream(containerId: string, options: ExecStreamOptions): Promise<ExecStreamHandle> {
    const info = this.containers.get(containerId);
    if (!info) {
      throw new ContainerNotFoundError(containerId);
    }
    if (info.state !== 'running') {
      throw new ContainerError(`Container ${containerId} is not running`, containerId);
    }

    const args: string[] = ['exec', '-i'];

    if (options.workingDirectory) {
      args.push('-w', options.workingDirectory);
    }

    for (const [key, value] of Object.entries(options.environment || {})) {
      args.push('-e', `${key}=${value}`);
    }

    args.push(containerId, ...options.command);

    logger.debug('Streaming exec in docker container', {
      containerId,
      commandLength: options.command.length,
    });

    const child = spawn(this.dockerBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!child.stdin || !child.stdout || !child.stderr) {
      child.kill('SIGKILL');
      throw new ContainerError('Failed to wire docker exec stdio streams', containerId);
    }

    // Swallow stdin EPIPE — close handler reports the authoritative exit.
    child.stdin.on('error', () => {});

    // Bind close/error listeners exactly once; share the resulting promise across wait() calls.
    const waitPromise = new Promise<{ exitCode: number }>((resolve, reject) => {
      let settled = false;
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(new ContainerError(`docker exec stream failed: ${err.message}`, containerId, err));
      });
      child.on('close', (code, signal) => {
        if (settled) return;
        settled = true;
        if (code === null && signal) {
          // Killed by signal; portable signal-to-exit-code mapping isn't available.
          resolve({ exitCode: 1 });
          return;
        }
        resolve({ exitCode: code ?? 0 });
      });
    });

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

  /**
   * Live-inspect via `docker inspect`: refreshes cached state and returns the parsed info.
   *
   * The inherited synchronous `inspect()` only reads the in-memory cache. ContainerManager
   * (K-49b) calls `refreshState` when it needs an authoritative view of the daemon's state
   * (e.g. to decide whether a previously-materialized container is still running on the host).
   *
   * Kept as a separate method because `BaseContainerRuntime.inspect()` fixes a sync return
   * type; widening it requires a coordinated change to AppleContainerRuntime, which lives
   * in a parallel kata.
   */
  async refreshState(containerId: string): Promise<ContainerInfo> {
    if (!this.containers.has(containerId)) {
      throw new ContainerNotFoundError(containerId);
    }

    try {
      const { stdout } = await execFileAsync(this.dockerBin, [
        'inspect',
        containerId,
        '--format',
        '{{json .}}',
      ]);
      const parsed = JSON.parse(stdout) as DockerInspectJson;
      const info = this.dockerInspectToInfo(containerId, parsed);
      const cached = this.containers.get(containerId);
      if (cached) {
        cached.state = info.state;
        cached.pid = info.pid;
        cached.startedAt = info.startedAt;
        cached.stoppedAt = info.stoppedAt;
        cached.exitCode = info.exitCode;
      }
      return info;
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        throw new ContainerNotFoundError(containerId);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new ContainerError(
        `Failed to inspect container: ${message}`,
        containerId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private dockerInspectToInfo(containerId: string, parsed: DockerInspectJson): ContainerInfo {
    const status = parsed.State?.Status;
    const state = this.mapDockerStateToContainerState(status);
    const startedAt = parsed.State?.StartedAt ? new Date(parsed.State.StartedAt) : undefined;
    const stoppedAt = parsed.State?.FinishedAt ? new Date(parsed.State.FinishedAt) : undefined;

    return {
      id: containerId,
      state,
      pid: parsed.State?.Pid && parsed.State.Pid > 0 ? parsed.State.Pid : undefined,
      startedAt: startedAt && !isNaN(startedAt.getTime()) ? startedAt : undefined,
      stoppedAt:
        stoppedAt && !isNaN(stoppedAt.getTime()) && stoppedAt.getTime() > 0 ? stoppedAt : undefined,
      exitCode: parsed.State?.ExitCode,
    };
  }

  async list(): Promise<ContainerInfo[]> {
    try {
      const { stdout } = await execFileAsync(this.dockerBin, [
        'ps',
        '-a',
        '--filter',
        `name=${LACE_PREFIX}`,
        '--format',
        '{{json .}}',
      ]);

      const rows = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const results: ContainerInfo[] = [];
      for (const line of rows) {
        let row: DockerPsRowJson;
        try {
          row = JSON.parse(line) as DockerPsRowJson;
        } catch {
          logger.warn('Skipping unparseable docker ps row', { line });
          continue;
        }

        const name = (row.Names || '').split(',')[0]?.trim();
        if (!name || !name.startsWith(LACE_PREFIX)) continue;

        const stateString = row.State || row.Status;
        results.push({
          id: name,
          state: this.mapDockerStateToContainerState(stateString),
        });
      }

      return results;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('docker ps failed; returning cached list', { error: message });
      return Array.from(this.containers.values());
    }
  }
}
