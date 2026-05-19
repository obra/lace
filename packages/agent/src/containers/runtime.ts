// ABOUTME: Abstract container runtime implementation
// ABOUTME: Base class for container runtime implementations with common functionality

import {
  ContainerRuntime,
  ContainerConfig,
  ContainerInfo,
  ExecOptions,
  ExecResult,
  ExecStreamOptions,
  ExecStreamHandle,
  ContainerState,
  ContainerNotFoundError,
} from './types';
import { logger } from '@lace/agent/utils/logger';
import { join } from 'path';

export abstract class BaseContainerRuntime implements ContainerRuntime {
  protected containers = new Map<string, ContainerInfo>();
  protected mountMap = new Map<string, Map<string, string>>(); // containerId -> (hostPath -> containerPath)

  abstract create(config: ContainerConfig): string | Promise<string>;
  abstract start(containerId: string): Promise<void>;
  abstract stop(containerId: string, timeout?: number): Promise<void>;
  abstract remove(containerId: string): Promise<void>;
  abstract exec(containerId: string, options: ExecOptions): Promise<ExecResult>;
  abstract execStream(containerId: string, options: ExecStreamOptions): Promise<ExecStreamHandle>;

  inspect(containerId: string): ContainerInfo {
    const info = this.containers.get(containerId);
    if (!info) {
      throw new ContainerNotFoundError(containerId);
    }
    return info;
  }

  /**
   * Default daemon-side inspect: falls back to the cached `inspect()` and
   * returns null on NotFound. Runtimes with a real daemon (DockerContainerRuntime)
   * override this to shell out for an authoritative answer.
   */
  async daemonInspect(containerId: string): Promise<ContainerInfo | null> {
    try {
      return this.inspect(containerId);
    } catch (error) {
      if (error instanceof ContainerNotFoundError) return null;
      throw error;
    }
  }

  /**
   * Default adopt: register the container + mounts into the in-process caches
   * so subsequent start/exec calls succeed. Idempotent.
   */
  async adopt(config: ContainerConfig, state: ContainerState): Promise<void> {
    const id = config.id;
    if (!id) {
      throw new Error('adopt() requires config.id to identify the existing container');
    }
    if (!this.containers.has(id)) {
      this.containers.set(id, { id, state });
    } else {
      this.containers.get(id)!.state = state;
    }
    this.registerMounts(id, config);
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
