// ABOUTME: Generic ContainerManager — materializes ContainerSpec into running containers
// ABOUTME: Idempotent by spec.name; knows nothing about personas, worktrees, or sessions,
// ABOUTME: but namespaces all container ids under the `lace-` prefix to support orphan
// ABOUTME: reaping across processes.

import { logger } from '@lace/agent/utils/logger';
import type {
  ContainerConfig,
  ContainerInfo,
  ContainerRuntime,
  ExecStreamHandle,
  ExecStreamOptions,
} from './types';
import { ContainerNotFoundError } from './types';
import type { ContainerHandle, ContainerLifecycleHooks, ContainerSpec } from './spec';

// See ABOUTME above: every container id is namespaced under this prefix so
// cross-process orphan reaping can scope its scan.
const CONTAINER_ID_PREFIX = 'lace-';

function resolveContainerId(specName: string): string {
  return `${CONTAINER_ID_PREFIX}${specName}`;
}

/**
 * Strip the `lace-` prefix off a container id. Caller MUST have already
 * verified the prefix (e.g. via `startsWith(CONTAINER_ID_PREFIX)` or a scan
 * prefix that begins with it); violating this contract throws.
 */
function specNameFromContainerId(containerId: string): string {
  if (!containerId.startsWith(CONTAINER_ID_PREFIX)) {
    throw new Error(
      `specNameFromContainerId: id ${containerId} does not start with ${CONTAINER_ID_PREFIX}`
    );
  }
  return containerId.slice(CONTAINER_ID_PREFIX.length);
}

export class ContainerManager {
  private readonly specs = new Map<string, ContainerSpec>();

  constructor(private readonly runtime: ContainerRuntime) {}

  async materialize(
    spec: ContainerSpec,
    hooks?: ContainerLifecycleHooks
  ): Promise<ContainerHandle> {
    const containerId = resolveContainerId(spec.name);
    const existing = await this.tryInspect(containerId);

    if (existing) {
      this.specs.set(spec.name, spec);
      if (existing.state === 'running') {
        return { spec, containerId, state: existing.state };
      }
      await this.runtime.start(containerId);
      const after = await this.tryInspect(containerId);
      return { spec, containerId, state: after?.state ?? 'running' };
    }

    if (hooks?.beforeCreate) {
      await hooks.beforeCreate();
    }

    const config: ContainerConfig = {
      id: containerId,
      name: spec.name,
      image: spec.image,
      workingDirectory: spec.workingDirectory,
      mounts: spec.mounts,
      environment: spec.env,
    };

    const createdId = await this.runtime.create(config);
    await this.runtime.start(createdId);

    this.specs.set(spec.name, spec);
    const info = await this.tryInspect(createdId);
    return {
      spec,
      containerId: createdId,
      state: info?.state ?? 'running',
    };
  }

  async inspect(specName: string): Promise<ContainerHandle | null> {
    const containerId = resolveContainerId(specName);
    const info = await this.tryInspect(containerId);
    if (!info) return null;
    const spec = this.specs.get(specName);
    if (!spec) return null;
    return { spec, containerId: info.id, state: info.state };
  }

  async destroy(specName: string, hooks?: ContainerLifecycleHooks): Promise<void> {
    const containerId = resolveContainerId(specName);

    try {
      await this.runtime.stop(containerId);
    } catch (error) {
      this.logBestEffortFailure('stop', containerId, error);
    }

    try {
      await this.runtime.remove(containerId);
    } catch (error) {
      this.logBestEffortFailure('remove', containerId, error);
    }

    this.specs.delete(specName);

    if (hooks?.afterDestroy) {
      await hooks.afterDestroy();
    }
  }

  execStream(specName: string, options: ExecStreamOptions): Promise<ExecStreamHandle> {
    const containerId = resolveContainerId(specName);
    return this.runtime.execStream(containerId, options);
  }

  /**
   * Reap containers under our `lace-` id-prefix that are not in `liveSpecNames`.
   *
   * @param specNamePrefix A SPEC-name prefix (NOT a container-id prefix). It is
   *   prepended internally with `CONTAINER_ID_PREFIX` (`lace-`) to form the
   *   scan prefix. Pass `''` to scan all `lace-` containers.
   * @param liveSpecNames Set of spec names (no `lace-` prefix) that must NOT
   *   be reaped.
   * @returns `reaped` — spec names (no `lace-` prefix) of containers that were
   *   destroyed.
   */
  async reapOrphans(
    specNamePrefix: string,
    liveSpecNames: Set<string>
  ): Promise<{ reaped: string[] }> {
    const scanPrefix = `${CONTAINER_ID_PREFIX}${specNamePrefix}`;
    let containers: ContainerInfo[];
    try {
      containers = await this.runtime.list();
    } catch (error) {
      logger.warn('Container reaper: list() failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { reaped: [] };
    }

    const reaped: string[] = [];

    for (const info of containers) {
      if (!info.id.startsWith(scanPrefix)) continue;
      const specName = specNameFromContainerId(info.id);
      if (liveSpecNames.has(specName)) continue;

      try {
        await this.destroy(specName);
        reaped.push(specName);
      } catch (error) {
        logger.warn('Container reaper: destroy failed', {
          containerId: info.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { reaped };
  }

  private async tryInspect(containerId: string): Promise<ContainerInfo | null> {
    try {
      return await this.runtime.inspect(containerId);
    } catch (error) {
      if (error instanceof ContainerNotFoundError) return null;
      throw error;
    }
  }

  private logBestEffortFailure(op: 'stop' | 'remove', containerId: string, error: unknown): void {
    if (error instanceof ContainerNotFoundError) {
      logger.debug(`ContainerManager.${op}: container already gone`, { containerId });
      return;
    }
    logger.warn(`ContainerManager.${op} failed`, {
      containerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
