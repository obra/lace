// ABOUTME: R6 invariant — per_invocation environments must not share a writable
// ABOUTME: mount-registry name with persistent environments.

import type { EnvironmentRegistry, ParsedEnvironment } from './environment-registry';
import type { MountRegistryEntry } from '@lace/agent/server-types';

// `scratch` is Lace-managed for per_invocation environments and `sen-cred` is
// plane-provided (the shim injects a per-container capability socket; the name
// is the gate signal, not a shared host path). Neither counts as an
// author-chosen overlap. Other names are ordinary environment-declared mounts.
const RESERVED_MOUNT_NAMES = new Set(['scratch', 'sen-cred']);

export class EnvironmentMountConflictError extends Error {
  constructor(
    public readonly environmentName: string,
    public readonly mountName: string,
    public readonly conflictsWith: string[]
  ) {
    super(
      `Per-invocation environment '${environmentName}' declares writable mount ` +
        `'${mountName}', also declared by persistent environment(s) ` +
        `[${conflictsWith.join(', ')}]. A per_invocation box must not share a ` +
        `writable host path with a persistent box (adversarial-write leak). ` +
        `Remove '${mountName}' from one environment, or change a containerSharing value.`
    );
    this.name = 'EnvironmentMountConflictError';
  }
}

type EnvConflict = { environment: string; mountName: string; conflictsWith: string[] };

function persistentMountOwners(registry: EnvironmentRegistry): Map<string, Set<string>> {
  const byName = new Map<string, Set<string>>();
  for (const name of registry.listAvailable()) {
    let parsed: ParsedEnvironment;
    try {
      parsed = registry.parseEnvironment(name);
    } catch {
      continue;
    }
    if (parsed.runtime.containerSharing !== 'persistent') continue;
    for (const mountName of parsed.runtime.mounts) {
      if (RESERVED_MOUNT_NAMES.has(mountName)) continue;
      const set = byName.get(mountName) ?? new Set<string>();
      set.add(name);
      byName.set(mountName, set);
    }
  }
  return byName;
}

/**
 * Scan the environment registry for R6 violations: a per_invocation environment
 * that declares a writable mount also declared by a persistent environment.
 * Mounts the containerMounts registry marks readonly carry no write path so they
 * are not a threat. Mounts absent from the registry default to read-write
 * (conservative). Returns all conflicts (empty if none).
 */
export function findEnvironmentMountConflicts(
  registry: EnvironmentRegistry,
  containerMounts: Readonly<Record<string, MountRegistryEntry>>
): EnvConflict[] {
  const owners = persistentMountOwners(registry);
  const conflicts: EnvConflict[] = [];
  for (const name of registry.listAvailable()) {
    let parsed: ParsedEnvironment;
    try {
      parsed = registry.parseEnvironment(name);
    } catch {
      continue;
    }
    if (parsed.runtime.containerSharing !== 'per_invocation') continue;
    for (const mountName of parsed.runtime.mounts) {
      if (RESERVED_MOUNT_NAMES.has(mountName)) continue;
      if (containerMounts[mountName]?.readonly === true) continue;
      const conflictsWith = owners.get(mountName);
      if (conflictsWith && conflictsWith.size > 0) {
        conflicts.push({ environment: name, mountName, conflictsWith: [...conflictsWith].sort() });
      }
    }
  }
  return conflicts;
}

/** Boot-time: throw on the first environment mount conflict (fail loud at startup). */
export function assertNoEnvironmentMountConflict(
  registry: EnvironmentRegistry,
  containerMounts: Readonly<Record<string, MountRegistryEntry>>
): void {
  const [first] = findEnvironmentMountConflicts(registry, containerMounts);
  if (first) {
    throw new EnvironmentMountConflictError(
      first.environment,
      first.mountName,
      first.conflictsWith
    );
  }
}
