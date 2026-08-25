// ABOUTME: Resolve the compaction strategy NAME and breakpoints for a session from its persona
import type { PersonaRegistry } from '@lace/agent/config/persona-registry';
import { logger } from '@lace/agent/utils/logger';
import { basename } from 'node:path';

export type Breakpoint = { at: number; action: 'notify' | 'compact' };

export const DEFAULT_BREAKPOINTS: Breakpoint[] = [
  { at: 0.6, action: 'compact' },
  { at: 0.9, action: 'compact' },
];

/**
 * The single method these resolvers need. Narrower than PersonaRegistry so a
 * caller can pass any resolver and tests need not build a whole registry.
 */
export interface PersonaConfigResolver {
  parsePersona: PersonaRegistry['parsePersona'];
}

/** Identifies the session in log output. Never affects resolution. */
export interface PersonaLogContext {
  sessionDir?: string;
}

/**
 * A session that NAMES a persona which then fails to parse is a
 * misconfiguration, not a default: the caller falls back so a live agent keeps
 * running, but the fallback is REPORTED. PRI-2943 — cadence-sen named `core`,
 * the registry could not resolve it, and a bare `catch` turned that into 203
 * consecutive compactions on the wrong strategy with an unbounded renderer.
 * Nothing logged for four weeks.
 */
function compactionConfigFor(
  persona: string | null,
  registry: PersonaConfigResolver,
  what: string,
  context?: PersonaLogContext
): { strategy?: string; breakpoints?: unknown[] } | undefined {
  // No persona is a legitimate state, not a failure — stay quiet.
  if (!persona) return undefined;
  try {
    return registry.parsePersona(persona).config.compaction;
  } catch (err) {
    logger.warn(
      'compaction: session names a persona that failed to parse; falling back to defaults',
      {
        persona,
        ...(context?.sessionDir
          ? { session: basename(context.sessionDir), sessionDir: context.sessionDir }
          : {}),
        resolving: what,
        error: err instanceof Error ? err.message : String(err),
      }
    );
    return undefined;
  }
}

/**
 * Both arguments are REQUIRED, deliberately.
 *
 * `persona` is the session's persona name. The runner already holds it as
 * `config.persona`; a caller holding only a directory gets it from
 * `personaForSessionDir`. Taking the name rather than the directory removes a
 * second source of truth — the runner used to check its own `config.persona`
 * and then call a resolver that re-derived the name from `meta.json`, so the
 * guard and the lookup could disagree.
 *
 * `registry` is the session's embedder-controlled resolver —
 * `state.personaRegistry` on the RPC side, `deps.personaRegistry` in the
 * runner. It has NO DEFAULT on purpose. Defaulting it to the module singleton
 * is what caused PRI-2943: an embedder that keeps personas outside LACE_DIR
 * declares them via `userPersonasPaths` at initialize, the singleton knows
 * nothing about that, and a coworker silently ran the wrong compaction strategy
 * for four weeks. A required argument turns a forgotten call site into a
 * compile error instead of a silent downgrade. Pass the exported
 * `personaRegistry` explicitly when the singleton really is what you want.
 *
 * `context` affects log messages only; omitting it costs operator detail in a
 * warning, never correctness.
 */
export function compactionStrategyNameForPersona(
  persona: string | null,
  registry: PersonaConfigResolver,
  context?: PersonaLogContext
): string {
  return compactionConfigFor(persona, registry, 'strategy', context)?.strategy ?? 'track-based';
}

export function compactionBreakpointsForPersona(
  persona: string | null,
  registry: PersonaConfigResolver,
  context?: PersonaLogContext
): Breakpoint[] {
  const bp = compactionConfigFor(persona, registry, 'breakpoints', context)?.breakpoints;
  return bp && bp.length > 0 ? (bp as Breakpoint[]) : DEFAULT_BREAKPOINTS;
}
