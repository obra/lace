// ABOUTME: Resolve the compaction strategy NAME for a session from its persona (default track-based)
import { personaForSessionDir } from '@lace/agent/storage/event-log';
import { personaRegistry } from '@lace/agent/config/persona-registry';

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
