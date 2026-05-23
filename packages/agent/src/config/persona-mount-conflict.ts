// ABOUTME: R6 invariant — per_invocation personas must not share mount-registry
// ABOUTME: names with persistent personas. PRI-1796.

import type { PersonaRegistry, ParsedPersona } from './persona-registry';
import { logger } from '@lace/agent/utils/logger';

// Reserved mount names are lace-managed and don't count as author-chosen
// overlaps. Mirrors the names rejected in resolvePersonaMountsAndEnv.
const RESERVED_MOUNT_NAMES = new Set(['persona', 'lace-data', 'credentials', 'lace', 'scratch']);

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
 * Returns the conflicts (empty array if none).
 */
function findConflictsForPersona(
  personaName: string,
  parsed: ParsedPersona,
  persistentByName: ReadonlyMap<string, ReadonlySet<string>>
): Conflict[] {
  const runtime = parsed.config.runtime;
  if (runtime.type !== 'container' || runtime.containerSharing !== 'per_invocation') {
    return [];
  }
  const declared = Object.keys(runtime.mounts);
  const conflicts: Conflict[] = [];
  for (const mountName of declared) {
    if (RESERVED_MOUNT_NAMES.has(mountName)) continue;
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
 * Reserved/auto-injected mounts are filtered out.
 */
export function assertNoMountConflict(
  personaName: string,
  parsed: ParsedPersona,
  registry: PersonaRegistry
): void {
  const persistentByName = buildPersistentByNameMap(registry);
  const conflicts = findConflictsForPersona(personaName, parsed, persistentByName);
  if (conflicts.length === 0) return;
  // Surface only the first conflict in the thrown error (a single delegate call
  // can't fix more than one at a time).
  const first = conflicts[0];
  throw new PersonaSharingViolationError(first.persona, first.mountName, first.conflictsWith);
}

/**
 * Boot-time hook. Logs a WARN for each conflict found by scanning every
 * per_invocation persona against every persistent persona. Never throws.
 */
export function warnMountConflicts(registry: PersonaRegistry): void {
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
    const conflicts = findConflictsForPersona(info.name, parsed, persistentByName);
    for (const c of conflicts) {
      logger.warn('persona_mount_conflict', {
        persona: c.persona,
        mountName: c.mountName,
        conflictsWith: c.conflictsWith,
      });
    }
  }
}
