// ABOUTME: Abstract container runtime implementation
// ABOUTME: Base class for container runtime implementations with common functionality

import {
  ContainerRuntime,
  ContainerConfig,
  ContainerInfo,
  ExecOptions,
  ExecResult,
  ContainerState,
  ContainerNotFoundError,
} from './types';
import { logger } from '@lace/core/utils/logger';
import { join } from 'path';

export abstract class BaseContainerRuntime implements ContainerRuntime {
  protected containers = new Map<string, ContainerInfo>();
  protected mountMap = new Map<string, Map<string, string>>(); // containerId -> (hostPath -> containerPath)

  abstract create(config: ContainerConfig): string | Promise<string>;
  abstract start(containerId: string): Promise<void>;
  abstract stop(containerId: string, timeout?: number): Promise<void>;
  abstract remove(containerId: string): Promise<void>;
  abstract exec(containerId: string, options: ExecOptions): Promise<ExecResult>;

  inspect(containerId: string): ContainerInfo {
    const info = this.containers.get(containerId);
    if (!info) {
      throw new ContainerNotFoundError(containerId);
    }
    return info;
  }

  list(): Promise<ContainerInfo[]> {
    return Promise.resolve(Array.from(this.containers.values()));
  }

  translateToContainer(hostPath: string, containerId: string): string {
    const mounts = this.mountMap.get(containerId);
    if (!mounts) {
      throw new ContainerNotFoundError(containerId);
    }

    // Find the mount point that contains this path
    for (const [hostMount, containerMount] of mounts.entries()) {
      if (hostPath.startsWith(hostMount)) {
        const relativePath = hostPath.slice(hostMount.length);
        // Handle exact mount point (no relative path)
        if (relativePath === '') {
          return containerMount + '/';
        }
        return join(containerMount, relativePath);
      }
    }

    // No mount found - path is not accessible in container
    logger.warn('Path not accessible in container', { hostPath, containerId });
    return hostPath; // Return as-is, will fail in container
  }

  translateToHost(containerPath: string, containerId: string): string {
    const mounts = this.mountMap.get(containerId);
    if (!mounts) {
      throw new ContainerNotFoundError(containerId);
    }

    // Reverse lookup: find container mount that contains this path
    for (const [hostMount, containerMount] of mounts.entries()) {
      if (containerPath.startsWith(containerMount)) {
        const relativePath = containerPath.slice(containerMount.length);
        return join(hostMount, relativePath);
      }
    }

    logger.warn('Container path has no host mapping', { containerPath, containerId });
    return containerPath; // Return as-is
  }

  protected updateContainerState(containerId: string, state: ContainerState): void {
    const info = this.containers.get(containerId);
    if (info) {
      info.state = state;
      if (state === 'stopped' || state === 'failed') {
        info.stoppedAt = new Date();
      }
    }
  }

  protected registerMounts(containerId: string, config: ContainerConfig): void {
    const mounts = new Map<string, string>();
    for (const mount of config.mounts) {
      mounts.set(mount.source, mount.target);
    }
    this.mountMap.set(containerId, mounts);
  }

  protected unregisterMounts(containerId: string): void {
    this.mountMap.delete(containerId);
  }
}
