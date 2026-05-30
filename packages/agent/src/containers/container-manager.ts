// ABOUTME: Generic ContainerManager — materializes ContainerSpec into running containers
// ABOUTME: Idempotent by spec.name; knows nothing about personas, worktrees, or sessions,
// ABOUTME: but namespaces all container ids under the `lace-` prefix to support orphan
// ABOUTME: reaping across processes.

import { logger } from '@lace/agent/utils/logger';
import type {
  ContainerConfig,
  ContainerInfo,
  ContainerMount,
  ContainerRuntime,
  ExecStreamHandle,
  ExecStreamOptions,
} from './types';
import { ContainerError, ContainerNotFoundError } from './types';
import type { ContainerHandle, ContainerLifecycleHooks, ContainerSpec } from './spec';

// See ABOUTME above: every container id is namespaced under this prefix so
// cross-process orphan reaping can scope its scan.
const CONTAINER_ID_PREFIX = 'lace-';

export function resolveContainerId(spec: Pick<ContainerSpec, 'name' | 'containerId'>): string {
  // Persistent container runtime opts out of the `lace-` namespace by supplying a verbatim
  // containerId (e.g. `sen-box-shell`). Using a non-`lace-` id is intentional: it
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

function normalizeMountPath(value: string): string {
  if (/^[A-Za-z]:[\\/]$/.test(value)) return value;
  let out = value;
  while (out.length > 1 && /[\\/]$/.test(out)) {
    out = out.slice(0, -1);
  }
  return out;
}

function sameMount(a: ContainerMount, b: ContainerMount): boolean {
  return (
    normalizeMountPath(a.source) === normalizeMountPath(b.source) &&
    normalizeMountPath(a.target) === normalizeMountPath(b.target) &&
    Boolean(a.readonly) === Boolean(b.readonly)
  );
}

function targetMatchesPrefix(target: string, prefix: string): boolean {
  const normalizedTarget = normalizeMountPath(target);
  const normalizedPrefix = normalizeMountPath(prefix);
  return (
    normalizedTarget === normalizedPrefix || normalizedTarget.startsWith(`${normalizedPrefix}/`)
  );
}

function findMissingPersistentMount(
  spec: ContainerSpec,
  adoptable: ContainerInfo
): ContainerMount | null {
  if (!spec.containerId || adoptable.mounts === undefined) return null;
  for (const mount of spec.mounts) {
    if (!adoptable.mounts.some((existing) => sameMount(existing, mount))) {
      return mount;
    }
  }
  return null;
}

function findMissingManagedMount(
  spec: ContainerSpec,
  adoptable: ContainerInfo
): ContainerMount | null {
  if (adoptable.mounts === undefined) return null;
  const prefixes = spec.managedMountTargetPrefixes ?? [];
  if (prefixes.length === 0) return null;
  for (const mount of spec.mounts) {
    if (!prefixes.some((prefix) => targetMatchesPrefix(mount.target, prefix))) continue;
    if (!adoptable.mounts.some((existing) => sameMount(existing, mount))) return mount;
  }
  return null;
}

function findUnexpectedManagedMount(
  spec: ContainerSpec,
  adoptable: ContainerInfo
): ContainerMount | null {
  if (adoptable.mounts === undefined) return null;
  const prefixes = spec.managedMountTargetPrefixes ?? [];
  if (prefixes.length === 0) return null;
  for (const mount of adoptable.mounts) {
    if (!prefixes.some((prefix) => targetMatchesPrefix(mount.target, prefix))) continue;
    if (!spec.mounts.some((expected) => sameMount(expected, mount))) return mount;
  }
  return null;
}

function formatMount(mount: ContainerMount): string {
  return `${mount.source}:${mount.target}${mount.readonly ? ':ro' : ''}`;
}

export class ContainerManager {
  private readonly specs = new Map<string, ContainerSpec>();
  private readonly containerIdsBySpecName = new Map<string, string>();
  private readonly materializations = new Map<string, Promise<ContainerHandle>>();

  constructor(private readonly runtime: ContainerRuntime) {}

  /**
   * Materialize a ContainerSpec into a running container.
   *
   * Idempotent under SEQUENTIAL calls with the same `spec.name`: a second call
   * observes the existing container and returns its handle without recreating.
   *
   * Concurrent calls for the same resolved container id share one in-flight
   * materialization. This closes the tryInspect/create race without requiring
   * every caller-created ToolRuntime instance to coordinate externally.
   */
  async materialize(
    spec: ContainerSpec,
    hooks?: ContainerLifecycleHooks
  ): Promise<ContainerHandle> {
    const resolvedContainerId = resolveContainerId(spec);
    const knownContainerId = this.containerIdsBySpecName.get(spec.name);
    const materializationKey = knownContainerId ?? resolvedContainerId;
    const inFlight = this.materializations.get(materializationKey);
    if (inFlight) {
      return await inFlight;
    }

    const materialization = this.materializeOnce(
      spec,
      hooks,
      resolvedContainerId,
      knownContainerId
    );
    this.materializations.set(materializationKey, materialization);

    try {
      return await materialization;
    } finally {
      if (this.materializations.get(materializationKey) === materialization) {
        this.materializations.delete(materializationKey);
      }
    }
  }

  private async materializeOnce(
    spec: ContainerSpec,
    hooks: ContainerLifecycleHooks | undefined,
    containerId: string,
    knownContainerId?: string
  ): Promise<ContainerHandle> {
    const config: ContainerConfig = {
      id: containerId,
      name: spec.name,
      image: spec.image,
      workingDirectory: spec.workingDirectory,
      mounts: spec.mounts,
      environment: spec.env,
      ports: spec.ports,
      restartPolicy: spec.restartPolicy,
      sysctls: spec.sysctls,
      capAdd: spec.capAdd,
      network: spec.network,
    };

    // Box specs may have a daemon-side container that survived this process —
    // the docker --restart policy keeps `sen-box-shell` alive across agent restarts.
    // Consult the daemon directly so we adopt instead of recreating.
    const inspectContainerId = knownContainerId ?? containerId;
    const adoptable = spec.containerId
      ? await this.runtime.daemonInspect(containerId)
      : await this.tryInspect(inspectContainerId);

    if (adoptable) {
      const missingMount =
        findMissingPersistentMount(spec, adoptable) ?? findMissingManagedMount(spec, adoptable);
      if (missingMount) {
        throw new ContainerError(
          `Existing persistent container '${adoptable.id}' is missing required mount ` +
            `${formatMount(missingMount)}. Remove or recreate the container and retry.`,
          adoptable.id
        );
      }
      const unexpectedMount = findUnexpectedManagedMount(spec, adoptable);
      if (unexpectedMount) {
        throw new ContainerError(
          `Existing persistent container '${adoptable.id}' has unexpected managed mount ` +
            `${formatMount(unexpectedMount)}. Remove or recreate the container and retry.`,
          adoptable.id
        );
      }

      this.specs.set(spec.name, spec);
      this.containerIdsBySpecName.set(spec.name, adoptable.id);
      // Adopt the daemon-side container into the runtime's in-process caches
      // so subsequent start/exec calls succeed. No-op when the runtime has no
      // caches to populate (apple-container falls back to its own create-path
      // bookkeeping which is already in place when the local cache has it).
      if (spec.containerId) {
        await this.runtime.adopt(config, adoptable.state);
      }

      if (adoptable.state === 'running') {
        return { spec, containerId: adoptable.id, state: adoptable.state };
      }
      await this.runtime.start(adoptable.id);
      const after = await this.tryInspect(adoptable.id);
      // Fallback rationale: we just successfully called runtime.start(). If a
      // subsequent tryInspect cannot see the container, the runtime is in an
      // inconsistent state we cannot recover from here. We report 'running'
      // because that's what start() was asked to produce; the caller will
      // discover staleness on the next operation.
      const activeContainerId = after?.id ?? adoptable.id;
      this.containerIdsBySpecName.set(spec.name, activeContainerId);
      return { spec, containerId: activeContainerId, state: after?.state ?? 'running' };
    }

    if (knownContainerId && knownContainerId !== containerId) {
      this.containerIdsBySpecName.delete(spec.name);
    }

    if (hooks?.beforeCreate) {
      await hooks.beforeCreate();
    }

    const createdId = await this.runtime.create(config);
    await this.runtime.start(createdId);

    this.specs.set(spec.name, spec);
    this.containerIdsBySpecName.set(spec.name, createdId);
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
    this.containerIdsBySpecName.delete(specName);

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
    const createdId = this.containerIdsBySpecName.get(specName);
    if (createdId) return createdId;
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
