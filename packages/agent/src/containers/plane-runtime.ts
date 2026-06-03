// ABOUTME: Standalone ContainerRuntime that talks the sen-docker plane client.
// ABOUTME: The plane owns docker create/start details; lace sends selector verbs only.

import { execFile } from 'child_process';
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

export class PlaneRuntime implements ContainerRuntime {
  private readonly runner: PlaneRunner;
  private readonly containers = new Map<string, ContainerInfo>();
  private readonly configs = new Map<string, ContainerConfig | PlaneSpawnRequest>();

  constructor(planeBin: string, options: { run?: PlaneRunner['run'] } = {}) {
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
    const requestedName = config.id ?? config.name ?? config.jobId ?? persona;

    const parentSession = config.parentSession ?? '';
    const childSession = config.childSession ?? '';
    const jobId = config.jobId ?? synthesizeJobId(childSession || parentSession);

    logger.info('Spawning persona via sen-docker plane', {
      persona,
      parentSession,
      childSession: childSession || undefined,
      jobId,
    });

    const result = await this.runChecked(
      ['spawn', persona, parentSession, childSession, jobId],
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
    if (!info || info.state === 'running') {
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
        'PlaneRuntime.exec does not support stdin; use execStream when plane streaming lands',
        containerId
      );
    }

    const args: string[] = ['exec'];
    if (options.workingDirectory) {
      args.push('-w', options.workingDirectory);
    }
    appendEnvironmentOverlayArgs(args, options);
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

  async execStream(_containerId: string, _options: ExecStreamOptions): Promise<ExecStreamHandle> {
    throw new ContainerError('PlaneRuntime.execStream is not implemented in this phase');
  }

  inspect(containerId: string): ContainerInfo {
    const info = this.containers.get(containerId);
    if (!info) {
      throw new ContainerNotFoundError(containerId);
    }
    return info;
  }

  async list(): Promise<ContainerInfo[]> {
    return Array.from(this.containers.values());
  }

  async daemonInspect(containerId: string): Promise<ContainerInfo | null> {
    try {
      return this.inspect(containerId);
    } catch (error) {
      if (error instanceof ContainerNotFoundError) return null;
      throw error;
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
}
