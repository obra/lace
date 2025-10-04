// ABOUTME: Apple Container runtime using the macOS 'container' CLI tool
// ABOUTME: Provides real container isolation using Apple's container platform

import { BaseContainerRuntime } from './runtime';
import {
  ContainerConfig,
  ContainerInfo,
  ExecOptions,
  ExecResult,
  ContainerError,
  ContainerExecError,
} from './types';
import { logger } from '@lace/core/utils/logger';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync } from 'fs';

const execFileAsync = promisify(execFile);

// Extended container info that includes config for deferred container creation
interface AppleContainerInfo extends ContainerInfo {
  config?: ContainerConfig;
}

export class AppleContainerRuntime extends BaseContainerRuntime {
  // Default image to use for containers
  // Microsoft devcontainer includes common dev tools, git, etc.
  private readonly DEFAULT_IMAGE = 'mcr.microsoft.com/devcontainers/base:ubuntu';
  private readonly readyPromise: Promise<void>;
  private readonly image: string;

  constructor(image?: string) {
    super();
    this.image = image || this.DEFAULT_IMAGE;
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

      // Add image and command
      args.push(this.image, 'tail', '-f', '/dev/null');

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
          const { stdout } = await execFileAsync('container', ['list', '--format', 'json'], {
            timeout: 1000,
          });
          const containers = JSON.parse(stdout || '[]') as unknown;
          const found = Array.isArray(containers)
            ? containers.some((c) => (c as { id?: string }).id === containerId)
            : false;

          if (!found) {
            // Container is not running, mark as stopped
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

    const info = this.inspect(containerId);

    // Stop if running (with shorter timeout for cleanup)
    if (info.state === 'running') {
      await this.stop(containerId, 5000);
    }

    logger.info('Removing Apple container', { containerId });

    try {
      // Force remove to handle stuck containers
      await execFileAsync('container', ['rm', '-f', containerId], { timeout: 3000 });
    } catch (error: unknown) {
      // Container might not exist, check if it's really there
      try {
        const { stdout } = await execFileAsync('container', ['list', '-a', '--format', 'json'], {
          timeout: 1000,
        });
        const containers = JSON.parse(stdout || '[]') as unknown;
        const found = Array.isArray(containers)
          ? containers.some((c) => (c as { id?: string }).id === containerId)
          : false;

        if (found) {
          // Container exists but couldn't be removed
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error('Container exists but cannot be removed', {
            containerId,
            error: errorMessage,
          });
        } else {
          // Container doesn't exist, that's fine
          logger.debug('Container does not exist in system', { containerId });
        }
      } catch {
        // Can't check, assume it's gone
        logger.debug('Cannot verify container status, assuming removed', { containerId });
      }
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

  async list(): Promise<ContainerInfo[]> {
    await this.readyPromise; // Wait for system to be ready

    // Sync with actual container system
    try {
      const { stdout } = await execFileAsync('container', ['list', '--format', 'json']);
      const systemContainers = JSON.parse(stdout || '[]') as unknown;

      // Update our records with system state
      if (Array.isArray(systemContainers)) {
        for (const sc of systemContainers) {
          // Type guard function to properly narrow the type
          const isValidContainer = (obj: unknown): obj is { id: string; state: string } => {
            return (
              typeof obj === 'object' &&
              obj !== null &&
              'id' in obj &&
              'state' in obj &&
              typeof (obj as { id: unknown }).id === 'string' &&
              typeof (obj as { state: unknown }).state === 'string'
            );
          };

          if (isValidContainer(sc) && this.containers.has(sc.id)) {
            const info = this.containers.get(sc.id)!;
            info.state = sc.state === 'RUNNING' ? 'running' : 'stopped';
          }
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to sync container list with system', { error: errorMessage });
    }

    return super.list();
  }
}
