// ABOUTME: createIdleWake builds the IdleWakeHooks that start an internal turn
// ABOUTME: when an immediate inject lands on the active session while it is idle.

import type { AgentServerState } from '../server-types';
import { injectDrainContent } from './inject-drain-content';
import type { IdleWakeHooks } from './inject-notification';

/**
 * The wake is deferred to a `setImmediate` and re-checks `!state.activeTurn`
 * inside it. The internal prompt runner claims `state.activeTurn` synchronously
 * when it starts, so several wakes queued in the same tick start one turn.
 */
export function createIdleWake(
  state: AgentServerState,
  runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null }
): IdleWakeHooks {
  return {
    isActive: (d: string): boolean => d === state.activeSession?.dir,
    hasActiveTurn: (): boolean => !!state.activeTurn,
    triggerInternalTurn: (): void => {
      if (!runPromptInternalRef.current) return;
      setImmediate(() => {
        if (!state.activeTurn && state.activeSession && runPromptInternalRef.current) {
          // Same rule as the turn-exit drain: an empty prompt is only valid
          // while the conversation still ends on a user message.
          void runPromptInternalRef.current(injectDrainContent(state.activeSession.dir));
        }
      });
    },
  };
}
