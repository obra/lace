// ABOUTME: Resolve the compaction strategy NAME and breakpoints for a session from its persona
import { personaForSessionDir } from '@lace/agent/storage/event-log';
import { personaRegistry } from '@lace/agent/config/persona-registry';

export type Breakpoint = { at: number; action: 'notify' | 'compact' };

const DEFAULT_BREAKPOINTS: Breakpoint[] = [
  { at: 0.6, action: 'compact' },
  { at: 0.9, action: 'compact' },
];

export function compactionStrategyNameForSession(sessionDir: string): string {
  try {
    const persona = personaForSessionDir(sessionDir);
    if (persona) {
      return personaRegistry.parsePersona(persona).config.compaction?.strategy ?? 'track-based';
    }
  } catch {
    /* default */
  }
  return 'track-based';
}

export function compactionBreakpointsForSession(sessionDir: string): Breakpoint[] {
  try {
    const persona = personaForSessionDir(sessionDir);
    if (persona) {
      const bp = personaRegistry.parsePersona(persona).config.compaction?.breakpoints;
      if (bp && bp.length > 0) {
        return bp as Breakpoint[];
      }
    }
  } catch {
    /* default */
  }
  return DEFAULT_BREAKPOINTS;
}
