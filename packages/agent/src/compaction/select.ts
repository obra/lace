// ABOUTME: Resolve the compaction strategy NAME and breakpoints for a session from its persona
import { personaForSessionDir } from '@lace/agent/storage/event-log';
import { personaRegistry } from '@lace/agent/config/persona-registry';
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
function personaConfigForSession(
  sessionDir: string,
  what: string
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
    return personaRegistry.parsePersona(persona).config;
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

export function compactionStrategyNameForSession(sessionDir: string): string {
  return personaConfigForSession(sessionDir, 'strategy')?.compaction?.strategy ?? 'track-based';
}

export function compactionBreakpointsForSession(sessionDir: string): Breakpoint[] {
  const bp = personaConfigForSession(sessionDir, 'breakpoints')?.compaction?.breakpoints;
  return bp && bp.length > 0 ? (bp as Breakpoint[]) : DEFAULT_BREAKPOINTS;
}
