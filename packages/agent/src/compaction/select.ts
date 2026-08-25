// ABOUTME: Resolve the compaction strategy NAME and breakpoints for a session from its persona
import { personaForSessionDir } from '@lace/agent/storage/event-log';
import { personaRegistry } from '@lace/agent/config/persona-registry';
import type { PersonaRegistry } from '@lace/agent/config/persona-registry';
import { logger } from '@lace/agent/utils/logger';
import { basename } from 'node:path';

export type Breakpoint = { at: number; action: 'notify' | 'compact' };

export const DEFAULT_BREAKPOINTS: Breakpoint[] = [
  { at: 0.6, action: 'compact' },
  { at: 0.9, action: 'compact' },
];

/**
 * Resolve a session's persona config, or `null` when the session has no persona.
 *
 * A session that NAMES a persona which then fails to parse is a misconfiguration,
 * not a default: the caller falls back so a live agent keeps running, but the
 * fallback is reported. PRI-2943 — cadence-sen named `core`, the registry could
 * not find it (her instance had no `$LACE_DIR/agent-personas`), and a bare
 * `catch` turned that into 203 consecutive compactions on the wrong strategy
 * with an unbounded renderer. Nothing logged for four weeks.
 */
/**
 * The single method these resolvers need. Narrower than PersonaRegistry so a
 * caller can pass any resolver and tests need not build a whole registry.
 */
export interface PersonaConfigResolver {
  parsePersona: PersonaRegistry['parsePersona'];
}

function personaConfigForSession(
  sessionDir: string,
  what: string,
  registry: PersonaConfigResolver = personaRegistry
): { compaction?: { strategy?: string; breakpoints?: unknown[] } } | null {
  let persona: string | null = null;
  try {
    persona = personaForSessionDir(sessionDir);
  } catch (err) {
    logger.warn('compaction: could not read the persona for this session; using defaults', {
      session: basename(sessionDir),
      sessionDir,
      resolving: what,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  // No persona is a legitimate state, not a failure — stay quiet.
  if (!persona) return null;

  try {
    return registry.parsePersona(persona).config;
  } catch (err) {
    logger.warn(
      'compaction: session names a persona that failed to parse; falling back to defaults',
      {
        persona,
        session: basename(sessionDir),
        sessionDir,
        resolving: what,
        error: err instanceof Error ? err.message : String(err),
      }
    );
    return null;
  }
}

/**
 * `registry` is the session's embedder-controlled resolver — `state.personaRegistry`
 * on the RPC side, `deps.personaRegistry` in the runner. Omit it only where no
 * session context exists; it then falls back to the module singleton, whose user
 * paths come from LACE_DIR (plus LACE_USER_PERSONA_DIRS).
 *
 * Passing it matters: an embedder that keeps personas outside LACE_DIR declares
 * them via `userPersonasPaths` at initialize, and the singleton does not know
 * about that. Resolving against the singleton anyway silently downgraded such a
 * session to the default strategy for four weeks (PRI-2943).
 */
export function compactionStrategyNameForSession(
  sessionDir: string,
  registry?: PersonaConfigResolver
): string {
  return (
    personaConfigForSession(sessionDir, 'strategy', registry)?.compaction?.strategy ?? 'track-based'
  );
}

export function compactionBreakpointsForSession(
  sessionDir: string,
  registry?: PersonaConfigResolver
): Breakpoint[] {
  const bp = personaConfigForSession(sessionDir, 'breakpoints', registry)?.compaction?.breakpoints;
  return bp && bp.length > 0 ? (bp as Breakpoint[]) : DEFAULT_BREAKPOINTS;
}
