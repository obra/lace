// ABOUTME: Apple Container runtime using the macOS 'container' CLI tool
// ABOUTME: Provides real container isolation using Apple's container platform

import { BaseContainerRuntime } from '~/containers/runtime';
import {
  ContainerConfig,
  ContainerInfo,
  ExecOptions,
  ExecResult,
  ContainerError,
  ContainerExecError,
} from '~/containers/types';
import { logger } from '~/utils/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync } from 'fs';

const execAsync = promisify(exec);

// Extended container info that includes config for deferred container creation
interface AppleContainerInfo extends ContainerInfo {
  config?: ContainerConfig;
  volumeArgs?: string;
  envArgs?: string;
}

export class AppleContainerRuntime extends BaseContainerRuntime {
  // Default image to use for containers
  // Microsoft devcontainer includes common dev tools, git, etc.
  private readonly DEFAULT_IMAGE = 'mcr.microsoft.com/devcontainers/base:ubuntu';

  constructor() {
    super();
    // Ensure container system is started
    this.ensureSystemStarted().catch((err) => {
      logger.error('Failed to start container system', { error: err });
    });
  }

  private async ensureSystemStarted(): Promise<void> {
    try {
      // Check if system is running by trying to list containers
      await execAsync('container list', { timeout: 2000 });
    } catch {
      // System not started, start it
      logger.info('Starting container system service');
      await execAsync('container system start', { timeout: 10000 });
    }
  }

  create(config: ContainerConfig): string {
    // Generate unique container ID if not provided
    const uniqueSuffix = uuidv4().slice(0, 8);
    const containerId = config.id ? `${config.id}-${uniqueSuffix}` : `lace-${uniqueSuffix}`;

    logger.info('Creating Apple container', { containerId, config });

    // Ensure mount source directories exist
    for (const mount of config.mounts) {
      if (!existsSync(mount.source)) {
        logger.info('Creating mount source directory', { path: mount.source });
        mkdirSync(mount.source, { recursive: true });
      }
    }

    // Build volume mount arguments
    // Note: the 'container' tool doesn't support :ro/:rw suffixes like Docker
    const volumeArgs = config.mounts
      .map((mount) => {
        // TODO: Handle readonly mounts when container tool supports it
        return `-v "${mount.source}:${mount.target}"`;
      })
      .join(' ');

    // Build environment variable arguments
    const envArgs = Object.entries(config.environment || {})
      .map(([key, value]) => `-e "${key}=${value}"`)
      .join(' ');

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
    info.volumeArgs = volumeArgs;
    info.envArgs = envArgs;

    return containerId;
  }

  async start(containerId: string): Promise<void> {
    const info = this.inspect(containerId);
    if (info.state === 'running') {
      return; // Already running
    }

    const appleInfo = info as AppleContainerInfo;
    const config = appleInfo.config;
    const volumeArgs = appleInfo.volumeArgs || '';
    const envArgs = appleInfo.envArgs || '';

    if (!config) {
      throw new ContainerError('Container config not found', containerId);
    }

    logger.info('Starting Apple container', { containerId });

    try {
      // Create and start the container with a long-running process
      // Using tail -f /dev/null as it's more reliable than sleep loop
      const createCmd = `container run -d --name ${containerId} ${volumeArgs} ${envArgs} -w "${config.workingDirectory}" ${this.DEFAULT_IMAGE} tail -f /dev/null`;

      logger.debug('Container create command', { cmd: createCmd });

      try {
        const { stdout, stderr } = await execAsync(createCmd);
        logger.debug('Container created', { containerId, stdout, stderr });
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
          stdout: errorDetails.stdout,
          code: errorDetails.code,
        });
        throw createError;
      }

      // Wait for container to be fully ready - containers take time to initialize
      // The container tool needs a moment to fully start the container
      await new Promise((resolve) => setTimeout(resolve, 2000));

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
    const info = this.inspect(containerId);
    if (info.state !== 'running') {
      return; // Not running
    }

    logger.info('Stopping Apple container', { containerId });

    try {
      // First try graceful stop with shorter timeout
      // Note: container stop returns 143 when it successfully stops the container with SIGTERM
      await execAsync(`container stop ${containerId}`, { timeout: Math.min(timeout, 3000) });
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
        await execAsync(`container kill ${containerId}`, { timeout: 2000 });
        this.updateContainerState(containerId, 'stopped');
      } catch (killError: unknown) {
        // Exit code 143 is also OK for kill
        const killErrorCode = (killError as { code?: number }).code;
        if (killErrorCode === 143) {
          this.updateContainerState(containerId, 'stopped');
          return;
        }

        // Container might already be stopped, check status
        try {
          const { stdout } = await execAsync(`container list --format json | grep ${containerId}`, {
            timeout: 1000,
          });
          if (!stdout) {
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
    const info = this.inspect(containerId);

    // Stop if running (with shorter timeout for cleanup)
    if (info.state === 'running') {
      await this.stop(containerId, 5000);
    }

    logger.info('Removing Apple container', { containerId });

    try {
      // Force remove to handle stuck containers
      await execAsync(`container rm -f ${containerId}`, { timeout: 3000 });
    } catch (error: unknown) {
      // Container might not exist, check if it's really there
      try {
        const { stdout } = await execAsync(
          `container list -a --format json | grep ${containerId}`,
          { timeout: 1000 }
        );
        if (stdout) {
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

  async exec(containerId: string, options: ExecOptions): Promise<ExecResult> {
    const info = this.inspect(containerId);
    if (info.state !== 'running') {
      throw new ContainerError(`Container ${containerId} is not running`, containerId);
    }

    logger.debug('Executing in Apple container', { containerId, command: options.command });

    // Build environment variables for exec
    const envArgs = Object.entries(options.environment || {})
      .map(([key, value]) => `-e "${key}=${value}"`)
      .join(' ');

    // Build the command
    const command = options.command
      .map((arg) => {
        // Escape for shell
        if (/^[a-zA-Z0-9_\-./]+$/.test(arg)) {
          return arg;
        }
        return `'${arg.replace(/'/g, "'\\''")}'`;
      })
      .join(' ');

    const workdirArg = options.workingDirectory ? `-w "${options.workingDirectory}"` : '';
    const fullCommand = `container exec ${envArgs} ${workdirArg} ${containerId} ${command}`;

    logger.debug('Exec command', { fullCommand });

    try {
      const { stdout, stderr } = await execAsync(fullCommand, {
        timeout: options.timeout || 30000,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      return {
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
      };
    } catch (error: unknown) {
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

        // Timeout error
        if (errorWithCode.signal === 'SIGTERM' || errorWithCode.killed) {
          throw new ContainerError(
            'Execution timeout',
            containerId,
            error instanceof Error ? error : undefined
          );
        }

        // Command executed but returned non-zero exit code
        // Still return the output
        return {
          stdout: errorWithCode.stdout || '',
          stderr: errorWithCode.stderr || '',
          exitCode: typeof exitCode === 'number' ? exitCode : 1,
        };
      }

      // Unknown error - container might not be running
      const errorMessage =
        errorWithCode.message || (error instanceof Error ? error.message : String(error));
      logger.error('Exec failed with unknown error', {
        containerId,
        error: errorMessage,
        fullCommand,
      });
      throw new ContainerExecError(containerId, 1, errorMessage);
    }
  }

  async list(): Promise<ContainerInfo[]> {
    // Sync with actual container system
    try {
      const { stdout } = await execAsync('container list --format json');
      const systemContainers = JSON.parse(stdout || '[]');

      // Update our records with system state
      for (const sc of systemContainers) {
        if (sc.id && this.containers.has(sc.id)) {
          const info = this.containers.get(sc.id)!;
          info.state = sc.state === 'RUNNING' ? 'running' : 'stopped';
        }
      }
    } catch (error) {
      logger.warn('Failed to sync container list with system', { error });
    }

    return super.list();
  }
}
