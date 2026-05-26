// ABOUTME: R6 invariant — per_invocation personas must not share mount-registry
// ABOUTME: names with persistent personas. PRI-1796.

import type { PersonaRegistry, ParsedPersona } from './persona-registry';
import type { MountRegistryEntry } from '@lace/agent/server-types';
import { logger } from '@lace/agent/utils/logger';

// `scratch` is Lace-managed for per_invocation personas and does not count as
// an author-chosen overlap. Other names are ordinary persona-declared mounts.
const RESERVED_MOUNT_NAMES = new Set(['scratch']);

export class PersonaSharingViolationError extends Error {
  constructor(
    public readonly personaName: string,
    public readonly mountName: string,
    public readonly conflictsWith: string[]
  ) {
    super(
      `Per-invocation persona '${personaName}' declares mount '${mountName}', ` +
        `but the same mount name is also declared by persistent persona(s) ` +
        `[${conflictsWith.join(', ')}]. Per_invocation adversarial-content ` +
        `personas must not share host paths with persistent personas. Remove ` +
        `'${mountName}' from '${personaName}', or change one persona's ` +
        `containerSharing value.`
    );
    this.name = 'PersonaSharingViolationError';
  }
}

type Conflict = { persona: string; mountName: string; conflictsWith: string[] };

/**
 * Inspect a parsed persona's mount declarations against a precomputed map of
 * mount names → set of persistent personas declaring them.
 * Skips mounts that the containerMounts registry marks as readonly: the R6
 * threat is adversarial WRITES from per_invocation leaking into persistent
 * state; a readonly mount has no write path so it is not a threat.
 * Mounts absent from the registry are treated conservatively as read-write.
 * Returns the conflicts (empty array if none).
 */
function findConflictsForPersona(
  personaName: string,
  parsed: ParsedPersona,
  persistentByName: ReadonlyMap<string, ReadonlySet<string>>,
  containerMounts: Readonly<Record<string, MountRegistryEntry>>
): Conflict[] {
  const runtime = parsed.config.runtime;
  if (runtime.type !== 'container' || runtime.containerSharing !== 'per_invocation') {
    return [];
  }
  const declared = Object.keys(runtime.mounts);
  const conflicts: Conflict[] = [];
  for (const mountName of declared) {
    if (RESERVED_MOUNT_NAMES.has(mountName)) continue;
    // If the registry says this mount is readonly, the per_invocation persona
    // cannot write through it — not a threat. Skip.
    const registryEntry = containerMounts[mountName];
    if (registryEntry?.readonly === true) continue;
    const owners = persistentByName.get(mountName);
    if (owners && owners.size > 0) {
      conflicts.push({
        persona: personaName,
        mountName,
        conflictsWith: [...owners].sort(),
      });
    }
  }
  return conflicts;
}

function buildPersistentByNameMap(registry: PersonaRegistry): Map<string, Set<string>> {
  const persistentByName = new Map<string, Set<string>>();
  for (const info of registry.listAvailablePersonas()) {
    let parsed: ParsedPersona;
    try {
      parsed = registry.parsePersona(info.name);
    } catch (err) {
      logger.debug('persona_mount_conflict.parse_skipped', {
        personaName: info.name,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const runtime = parsed.config.runtime;
    if (runtime.type !== 'container' || runtime.containerSharing !== 'persistent') continue;
    for (const mountName of Object.keys(runtime.mounts)) {
      if (RESERVED_MOUNT_NAMES.has(mountName)) continue;
      const set = persistentByName.get(mountName) ?? new Set<string>();
      set.add(info.name);
      persistentByName.set(mountName, set);
    }
  }
  return persistentByName;
}

/**
 * Spawn-time hook. Throws PersonaSharingViolationError if the given per_invocation
 * persona's declared mounts overlap with any persistent persona's mounts.
 * Lace-managed mounts are filtered out. Mounts that the containerMounts registry
 * marks as readonly are also excluded: they carry no write path so they are not
 * an R6 threat. Mounts absent from the registry default to read-write (conservative).
 */
export function assertNoMountConflict(
  personaName: string,
  parsed: ParsedPersona,
  registry: PersonaRegistry,
  containerMounts: Readonly<Record<string, MountRegistryEntry>>
): void {
  const persistentByName = buildPersistentByNameMap(registry);
  const conflicts = findConflictsForPersona(personaName, parsed, persistentByName, containerMounts);
  if (conflicts.length === 0) return;
  // Surface only the first conflict in the thrown error (a single delegate call
  // can't fix more than one at a time).
  const first = conflicts[0];
  throw new PersonaSharingViolationError(first.persona, first.mountName, first.conflictsWith);
}

/**
 * Boot-time hook. Logs a WARN for each conflict found by scanning every
 * per_invocation persona against every persistent persona. Readonly mounts
 * are excluded (same logic as assertNoMountConflict). Never throws.
 */
export function warnMountConflicts(
  registry: PersonaRegistry,
  containerMounts: Readonly<Record<string, MountRegistryEntry>>
): void {
  const persistentByName = buildPersistentByNameMap(registry);
  for (const info of registry.listAvailablePersonas()) {
    let parsed: ParsedPersona;
    try {
      parsed = registry.parsePersona(info.name);
    } catch (err) {
      logger.debug('persona_mount_conflict.parse_skipped', {
        personaName: info.name,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const runtime = parsed.config.runtime;
    if (runtime.type !== 'container' || runtime.containerSharing !== 'per_invocation') continue;
    const conflicts = findConflictsForPersona(info.name, parsed, persistentByName, containerMounts);
    for (const c of conflicts) {
      logger.warn('persona_mount_conflict', {
        persona: c.persona,
        mountName: c.mountName,
        conflictsWith: c.conflictsWith,
      });
    }
  }
}
