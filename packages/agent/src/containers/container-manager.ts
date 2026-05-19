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

function resolveContainerId(spec: Pick<ContainerSpec, 'name' | 'containerId'>): string {
  // Box runtime opts out of the `lace-` namespace by supplying a verbatim
  // containerId (e.g. `sen-box`). Using a non-`lace-` id is intentional: it
  // makes boxes invisible to the startup reaper, which only lists `lace-*`.
  if (spec.containerId && spec.containerId.length > 0) {
    return spec.containerId;
  }
  return `${CONTAINER_ID_PREFIX}${spec.name}`;
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

  /**
   * Materialize a ContainerSpec into a running container.
   *
   * Idempotent under SEQUENTIAL calls with the same `spec.name`: a second call
   * observes the existing container and returns its handle without recreating.
   *
   * NOT internally serialized against CONCURRENT calls sharing the same
   * `spec.name`. There is a benign TOCTOU between `tryInspect` and
   * `runtime.create`/`start`: two concurrent calls could both observe "no
   * existing container" and both call `create`, producing duplicate-id errors
   * from the runtime.
   *
   * Callers must ensure at most one concurrent `materialize` per `spec.name`.
   * The current call shape (single subagent spawn per (session, persona) pair
   * via `spawnContainerSubagent`) satisfies this.
   *
   * If a future caller violates this invariant, the safe fix is an in-flight
   * `Map<specName, Promise<ContainerHandle>>` that returns the same in-flight
   * promise; do not introduce that machinery preemptively (YAGNI).
   */
  async materialize(
    spec: ContainerSpec,
    hooks?: ContainerLifecycleHooks
  ): Promise<ContainerHandle> {
    const containerId = resolveContainerId(spec);
    const config: ContainerConfig = {
      id: containerId,
      name: spec.name,
      image: spec.image,
      workingDirectory: spec.workingDirectory,
      mounts: spec.mounts,
      environment: spec.env,
      ports: spec.ports,
      restartPolicy: spec.restartPolicy,
    };

    // Box specs may have a daemon-side container that survived this process —
    // the docker --restart policy keeps `sen-box` alive across agent restarts.
    // Consult the daemon directly so we adopt instead of recreating.
    const adoptable = spec.containerId
      ? await this.runtime.daemonInspect(containerId)
      : await this.tryInspect(containerId);

    if (adoptable) {
      this.specs.set(spec.name, spec);
      // Adopt the daemon-side container into the runtime's in-process caches
      // so subsequent start/exec calls succeed. No-op when the runtime has no
      // caches to populate (apple-container falls back to its own create-path
      // bookkeeping which is already in place when the local cache has it).
      if (spec.containerId) {
        await this.runtime.adopt(config, adoptable.state);
      }

      if (adoptable.state === 'running') {
        return { spec, containerId, state: adoptable.state };
      }
      await this.runtime.start(containerId);
      const after = await this.tryInspect(containerId);
      // Fallback rationale: we just successfully called runtime.start(). If a
      // subsequent tryInspect cannot see the container, the runtime is in an
      // inconsistent state we cannot recover from here. We report 'running'
      // because that's what start() was asked to produce; the caller will
      // discover staleness on the next operation.
      return { spec, containerId, state: after?.state ?? 'running' };
    }

    if (hooks?.beforeCreate) {
      await hooks.beforeCreate();
    }

    const createdId = await this.runtime.create(config);
    await this.runtime.start(createdId);

    this.specs.set(spec.name, spec);
    const info = await this.tryInspect(createdId);
    // Same fallback rationale as the stopped-resume branch above: we just
    // successfully called runtime.create()+start(); if tryInspect cannot see
    // the container the runtime is inconsistent. Report 'running' (the
    // intended post-start state) and let the next operation surface staleness.
    return {
      spec,
      containerId: createdId,
      state: info?.state ?? 'running',
    };
  }

  async inspect(specName: string): Promise<ContainerHandle | null> {
    const spec = this.specs.get(specName);
    const containerId = this.resolveBySpecName(specName);
    const info = await this.tryInspect(containerId);
    if (!info) return null;
    if (!spec) return null;
    return { spec, containerId: info.id, state: info.state };
  }

  async destroy(specName: string, hooks?: ContainerLifecycleHooks): Promise<void> {
    const containerId = this.resolveBySpecName(specName);

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
    const containerId = this.resolveBySpecName(specName);
    return this.runtime.execStream(containerId, options);
  }

  /**
   * Resolve a container id for a known-by-name spec. If the spec is cached and
   * carries a verbatim `containerId`, that id is used; otherwise the spec name
   * is `lace-`-prefixed. Reaping uses this fallback path for daemon-side
   * containers the manager has never seen.
   */
  private resolveBySpecName(specName: string): string {
    const cached = this.specs.get(specName);
    return resolveContainerId({ name: specName, containerId: cached?.containerId });
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
