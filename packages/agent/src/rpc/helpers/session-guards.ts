// ABOUTME: Session validation guards for RPC handlers
// ABOUTME: Consolidates repeated session/turn validation patterns

import { AcpErrorCodes } from '@lace/ent-protocol';
import type { AgentServerState } from '@lace/agent/server-types';
import { assertInitialized } from '@lace/agent/rpc/utils';

/**
 * Asserts that an active session exists.
 * Throws SessionNotFound error if no session is active.
 */
export function assertActiveSession(state: AgentServerState): void {
  assertInitialized(state);
  if (!state.activeSession) {
    throw {
      code: AcpErrorCodes.SessionNotFound,
      message: 'SessionNotFound',
      data: { category: 'session' },
    };
  }
}

/**
 * Asserts that no turn is currently active.
 * Throws SessionBusy error if a turn is in progress.
 */
export function assertNotBusy(state: AgentServerState): void {
  if (state.activeTurn) {
    throw {
      code: AcpErrorCodes.SessionBusy,
      message: 'SessionBusy',
      data: { category: 'session' },
    };
  }
}

/**
 * Asserts that an active session exists and no turn is in progress.
 * Combines assertActiveSession and assertNotBusy.
 * Use this for operations that require an idle session.
 */
export function assertSessionReady(state: AgentServerState): void {
  assertActiveSession(state);
  assertNotBusy(state);
}
