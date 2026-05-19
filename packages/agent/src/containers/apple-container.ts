// ABOUTME: Apple Container runtime using the macOS 'container' CLI tool
// ABOUTME: Provides real container isolation using Apple's container platform

import { BaseContainerRuntime } from './runtime';
import {
  ContainerConfig,
  ContainerInfo,
  ExecOptions,
  ExecResult,
  ExecStreamOptions,
  ExecStreamHandle,
  ContainerError,
  ContainerExecError,
} from './types';
import { logger } from '@lace/agent/utils/logger';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync } from 'fs';

const execFileAsync = promisify(execFile);

// Extended container info that includes config for deferred container creation
interface AppleContainerInfo extends ContainerInfo {
  config?: ContainerConfig;
}

export class AppleContainerRuntime extends BaseContainerRuntime {
  private readonly readyPromise: Promise<void>;

  constructor() {
    super();
    // Start system initialization but don't await in constructor
    // Methods will await this.readyPromise before executing
    this.readyPromise = this.ensureSystemStarted();
  }

  private async ensureSystemStarted(): Promise<void> {
    try {
      // Check if system is running by trying to list containers
      await execFileAsync('container', ['list'], { timeout: 2000 });
    } catch {
      // System not started, start it
      logger.info('Starting container system service');
      try {
        await execFileAsync('container', ['system', 'start'], { timeout: 10000 });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('Failed to start container system', { error: errorMessage });
        throw new ContainerError('Container system failed to start', 'system');
      }
    }
  }

  private async listSystemContainers(
    options: {
      all?: boolean;
      timeout?: number;
    } = {}
  ): Promise<Array<{ id: string; status: string }>> {
    const { all = false, timeout = 2000 } = options;

    const args = ['list', ...(all ? ['-a'] : []), '--format', 'json'];
    const { stdout } = await execFileAsync('container', args, { timeout });
    const parsed = JSON.parse(stdout || '[]') as unknown;

    if (!Array.isArray(parsed)) return [];

    const containers: Array<{ id: string; status: string }> = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const configuration = obj.configuration as Record<string, unknown> | undefined;

      const id =
        (configuration && typeof configuration.id === 'string' && configuration.id) ||
        (typeof obj.id === 'string' && obj.id) ||
        null;

      const status =
        (typeof obj.status === 'string' && obj.status) ||
        (typeof obj.state === 'string' && obj.state) ||
        '';

      if (!id) continue;
      containers.push({ id, status });
    }

    return containers;
  }

  create(config: ContainerConfig): string {
    // Generate unique container ID if not provided
    const uniqueSuffix = uuidv4().slice(0, 8);
    const containerId = config.id ? `${config.id}-${uniqueSuffix}` : `lace-${uniqueSuffix}`;

    logger.info('Creating Apple container', {
      containerId,
      mountCount: config.mounts.length,
      envCount: Object.keys(config.environment || {}).length,
    });

    // Ensure mount source directories exist
    for (const mount of config.mounts) {
      if (!existsSync(mount.source)) {
        logger.info('Creating mount source directory', { path: mount.source });
        mkdirSync(mount.source, { recursive: true });
      }
    }

    // Store container info
    const info: AppleContainerInfo = {
      id: containerId,
      state: 'created',
    };
    this.containers.set(containerId, info);
    this.registerMounts(containerId, config);

    // Note: We'll actually create the container on start()
    // Store config for later use
    info.config = config;

    return containerId;
  }

  async start(containerId: string): Promise<void> {
    await this.readyPromise; // Wait for system to be ready

    const info = this.inspect(containerId);
    if (info.state === 'running') {
      return; // Already running
    }

    const appleInfo = info as AppleContainerInfo;
    const config = appleInfo.config;

    if (!config) {
      throw new ContainerError('Container config not found', containerId);
    }

    logger.info('Starting Apple container', { containerId });

    try {
      // Build args array for container run
      const args = ['run', '-d', '--name', containerId];

      // Add volume mounts
      for (const mount of config.mounts) {
        args.push('-v', `${mount.source}:${mount.target}`);
      }

      // Add environment variables
      for (const [key, value] of Object.entries(config.environment || {})) {
        args.push('-e', `${key}=${value}`);
      }

      // Add working directory
      args.push('-w', config.workingDirectory);

      // Apple's `container` CLI supports -p/--publish with the same
      // host:container[/protocol] format as Docker (verified against
      // container 0.6.0). Emit one -p flag per ContainerConfig.ports entry.
      for (const port of config.ports || []) {
        args.push('-p', `${port.host}:${port.container}`);
      }

      // Add image and command
      args.push(config.image, 'tail', '-f', '/dev/null');

      logger.debug('Starting container', { containerId, argCount: args.length });

      try {
        const { stdout: _stdout, stderr: _stderr } = await execFileAsync('container', args);
        logger.debug('Container created', { containerId });
      } catch (createError: unknown) {
        const errorDetails = createError as {
          message?: string;
          stderr?: string;
          stdout?: string;
          code?: number;
        };
        logger.error('Container creation failed', {
          containerId,
          error: errorDetails.message || String(createError),
          stderr: errorDetails.stderr,
          code: errorDetails.code,
        });
        throw createError;
      }

      // Container is ready immediately after 'container run' completes
      info.state = 'running';
      info.startedAt = new Date();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to start container', { containerId, error: errorMessage });
      info.state = 'failed';
      throw new ContainerError(
        `Failed to start container: ${errorMessage}`,
        containerId,
        error instanceof Error ? error : undefined
      );
    }
  }

  async stop(containerId: string, timeout: number = 10000): Promise<void> {
    await this.readyPromise; // Wait for system to be ready

    const info = this.inspect(containerId);
    if (info.state !== 'running') {
      return; // Not running
    }

    logger.info('Stopping Apple container', { containerId });

    try {
      // First try graceful stop with shorter timeout
      // Note: container stop returns 143 when it successfully stops the container with SIGTERM
      await execFileAsync('container', ['stop', containerId], {
        timeout: Math.min(timeout, 3000),
      });
      this.updateContainerState(containerId, 'stopped');
    } catch (error: unknown) {
      // Exit code 143 means the container was successfully stopped with SIGTERM
      const errorCode = (error as { code?: number }).code;
      if (errorCode === 143) {
        logger.debug('Container stopped with SIGTERM', { containerId });
        this.updateContainerState(containerId, 'stopped');
        return;
      }

      logger.warn('Graceful stop failed, forcing kill', { containerId, errorCode });
      // Force kill if stop failed for other reasons
      try {
        await execFileAsync('container', ['kill', containerId], { timeout: 2000 });
        this.updateContainerState(containerId, 'stopped');
      } catch (killError: unknown) {
        // Exit code 143 is also OK for kill
        const killErrorCode = (killError as { code?: number }).code;
        if (killErrorCode === 143) {
          this.updateContainerState(containerId, 'stopped');
          return;
        }

        // Container might already be stopped, check by listing
        try {
          const containers = await this.listSystemContainers({ timeout: 1000 });
          const container = containers.find((c) => c.id === containerId);

          if (!container) {
            this.updateContainerState(containerId, 'stopped');
            return;
          }

          const normalized = container.status.toLowerCase();
          if (normalized !== 'running') {
            this.updateContainerState(containerId, 'stopped');
            return;
          }
        } catch {
          // Assume stopped if we can't check
          this.updateContainerState(containerId, 'stopped');
          return;
        }
        throw new ContainerError(
          `Failed to stop container`,
          containerId,
          error instanceof Error ? error : undefined
        );
      }
    }
  }

  async remove(containerId: string): Promise<void> {
    await this.readyPromise; // Wait for system to be ready

    this.inspect(containerId); // Verify container exists in our records

    // Always attempt to stop before removal, regardless of cached state.
    // This avoids race conditions where state cache says "stopped" but container is still running.
    await this.stop(containerId, 5000);

    logger.info('Removing Apple container', { containerId });

    try {
      // Prefer a non-force delete. On macOS, forcing delete can trigger an unnecessary stop
      // request even for already-stopped containers, which is prone to flaky XPC timeouts.
      await execFileAsync('container', ['delete', containerId], { timeout: 30000 });
    } catch (error: unknown) {
      try {
        await execFileAsync('container', ['delete', '--force', containerId], { timeout: 30000 });
      } catch {
        // Continue with verification/cleanup below.
      }

      // Container might not exist, check if it's really there
      let containers: Array<{ id: string; status: string }> | null = null;
      try {
        containers = await this.listSystemContainers({ all: true, timeout: 1000 });
      } catch {
        // Best effort
      }

      if (containers) {
        const found = containers.some((c) => c.id === containerId);
        if (!found) {
          logger.debug('Container does not exist in system', { containerId });
          this.containers.delete(containerId);
          this.unregisterMounts(containerId);
          return;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Container exists but cannot be removed', {
          containerId,
          error: errorMessage,
        });
        throw new ContainerError(
          `Failed to remove container: ${errorMessage}`,
          containerId,
          error instanceof Error ? error : undefined
        );
      }

      // Can't check, assume it's gone
      logger.debug('Cannot verify container status, assuming removed', { containerId });
    }

    // Always clean up our records
    this.containers.delete(containerId);
    this.unregisterMounts(containerId);
  }

  private isContainerNotReadyError(error: unknown): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stderr = (error as { stderr?: string }).stderr || '';

    // Check for common "not ready" error patterns
    const notReadyPatterns = [
      'No such container',
      'is not running',
      'cannot connect',
      'connection refused',
      'not found',
    ];

    const combinedMessage = `${errorMessage} ${stderr}`.toLowerCase();
    return notReadyPatterns.some((pattern) => combinedMessage.includes(pattern.toLowerCase()));
  }

  async execStream(containerId: string, options: ExecStreamOptions): Promise<ExecStreamHandle> {
    await this.readyPromise; // Wait for system to be ready

    const info = this.inspect(containerId);
    if (info.state !== 'running') {
      throw new ContainerError(`Container ${containerId} is not running`, containerId);
    }

    // Mirror the arg shape used by exec(); -i keeps stdin open for streaming.
    const args = ['exec', '-i'];

    for (const [key, value] of Object.entries(options.environment || {})) {
      args.push('-e', `${key}=${value}`);
    }

    if (options.workingDirectory) {
      args.push('-w', options.workingDirectory);
    }

    args.push(containerId, ...options.command);

    logger.debug('Streaming exec in Apple container', {
      containerId,
      argCount: args.length,
    });

    const child = spawn('container', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Reject the returned promise on spawn failure (CLI not on PATH, etc.).
    // After 'spawn' fires, post-spawn errors surface via wait().
    try {
      await new Promise<void>((resolve, reject) => {
        const onSpawn = () => {
          child.off('error', onError);
          resolve();
        };
        const onError = (err: Error) => {
          child.off('spawn', onSpawn);
          reject(
            new ContainerError(
              `Failed to spawn 'container' for exec stream: ${err.message}`,
              containerId,
              err
            )
          );
        };
        child.once('spawn', onSpawn);
        child.once('error', onError);
      });
    } catch (err) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Best effort; child may already be unspawned.
      }
      throw err;
    }

    if (!child.stdin || !child.stdout || !child.stderr) {
      throw new ContainerError(
        `Spawned 'container' child is missing one or more standard streams`,
        containerId
      );
    }

    const waitPromise = new Promise<{ exitCode: number }>((resolve) => {
      // Map signal-killed exits to the 128+N convention the rest of this file uses.
      const signalExitCodes: Record<string, number> = {
        SIGHUP: 129,
        SIGINT: 130,
        SIGQUIT: 131,
        SIGABRT: 134,
        SIGKILL: 137,
        SIGTERM: 143,
      };
      let settled = false;
      const settle = (exitCode: number) => {
        if (settled) return;
        settled = true;
        resolve({ exitCode });
      };
      child.once('exit', (code, signal) => {
        if (typeof code === 'number') {
          settle(code);
        } else if (signal) {
          settle(signalExitCodes[signal] ?? 128);
        } else {
          settle(-1);
        }
      });
      child.once('error', (err) => {
        logger.warn('Exec stream child errored after spawn', {
          containerId,
          error: err.message,
        });
        settle(-1);
      });
    });

    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      wait: () => waitPromise,
      kill: (signal?: NodeJS.Signals) => {
        child.kill(signal);
      },
    };
  }

  async exec(containerId: string, options: ExecOptions): Promise<ExecResult> {
    await this.readyPromise; // Wait for system to be ready

    const info = this.inspect(containerId);
    if (info.state !== 'running') {
      throw new ContainerError(`Container ${containerId} is not running`, containerId);
    }

    logger.debug('Executing in Apple container', {
      containerId,
      commandLength: options.command.length,
    });

    // Build args array for container exec
    const args = ['exec'];

    // Add environment variables
    for (const [key, value] of Object.entries(options.environment || {})) {
      args.push('-e', `${key}=${value}`);
    }

    // Add working directory if specified
    if (options.workingDirectory) {
      args.push('-w', options.workingDirectory);
    }

    // Add container id
    args.push(containerId);

    // Add the command to execute
    args.push(...options.command);

    logger.debug('Executing command', { containerId, argCount: args.length });

    // Retry logic: try up to 3 times if container isn't ready
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { stdout, stderr } = await execFileAsync('container', args, {
          timeout: options.timeout ?? 30000,
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });

        return {
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: 0,
        };
      } catch (error: unknown) {
        lastError = error;

        // Check if this is an exec error with output
        const errorWithCode = error as {
          code?: number;
          signal?: string;
          killed?: boolean;
          stdout?: string;
          stderr?: string;
          message?: string;
        };

        if (errorWithCode.code !== undefined) {
          const exitCode = errorWithCode.code;

          // Timeout error - don't retry
          if (errorWithCode.signal === 'SIGTERM' || errorWithCode.killed) {
            throw new ContainerError(
              'Execution timeout',
              containerId,
              error instanceof Error ? error : undefined
            );
          }

          // Command executed but returned non-zero exit code
          // Still return the output - don't retry
          return {
            stdout: errorWithCode.stdout || '',
            stderr: errorWithCode.stderr || '',
            exitCode: typeof exitCode === 'number' ? exitCode : 1,
          };
        }

        // Check if this is a "container not ready" error
        if (attempt < 2 && this.isContainerNotReadyError(error)) {
          logger.debug('Container not ready, retrying', {
            containerId,
            attempt: attempt + 1,
            error: errorWithCode.message,
          });
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue; // Retry
        }

        // Not a retry-able error or we've exhausted retries
        break;
      }
    }

    // All retries exhausted
    const errorWithCode = lastError as {
      message?: string;
      stderr?: string;
    };
    const errorMessage =
      errorWithCode.message || (lastError instanceof Error ? lastError.message : String(lastError));
    logger.error('Exec failed after retries', {
      containerId,
      error: errorMessage,
    });
    throw new ContainerExecError(containerId, 1, errorMessage);
  }

  // Box runtime support (kata #62): macOS does not host long-lived boxes in v1
  // (sen-core deploys on linux). Inherit BaseContainerRuntime's default
  // daemonInspect (falls back to cached inspect, null on NotFound) and adopt
  // (populates the in-process cache) — adequate for the macOS dev path and
  // for any future single-tenant-style flow that lands here.

  async list(): Promise<ContainerInfo[]> {
    await this.readyPromise; // Wait for system to be ready

    // Sync with actual container system
    try {
      const systemContainers = await this.listSystemContainers();
      for (const sc of systemContainers) {
        if (!this.containers.has(sc.id)) continue;
        const info = this.containers.get(sc.id)!;
        info.state = sc.status.toLowerCase() === 'running' ? 'running' : 'stopped';
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to sync container list with system', { error: errorMessage });
    }

    return super.list();
  }
}
