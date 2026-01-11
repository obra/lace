// ABOUTME: Tests for session validation guards

import { describe, it, expect } from 'vitest';
import { assertActiveSession, assertNotBusy, assertSessionReady } from '../session-guards';
import { AcpErrorCodes } from '@lace/ent-protocol';
import type { AgentServerState } from '@lace/agent/server-types';

describe('session-guards', () => {
  const createMockState = (options: { activeSession?: unknown; activeTurn?: unknown } = {}) =>
    ({
      initialized: true,
      activeSession: options.activeSession,
      activeTurn: options.activeTurn,
    }) as unknown as AgentServerState;

  describe('assertActiveSession', () => {
    it('should not throw when session exists', () => {
      const state = createMockState({ activeSession: { id: 'test-session' } });

      expect(() => assertActiveSession(state)).not.toThrow();
    });

    it('should throw SessionNotFound when no session', () => {
      const state = createMockState({ activeSession: undefined });

      expect(() => assertActiveSession(state)).toThrow(
        expect.objectContaining({
          code: AcpErrorCodes.SessionNotFound,
          message: 'SessionNotFound',
          data: { category: 'session' },
        })
      );
    });

    it('should throw when state is not initialized', () => {
      const state = { initialized: false } as unknown as AgentServerState;

      expect(() => assertActiveSession(state)).toThrow();
    });
  });

  describe('assertNotBusy', () => {
    it('should not throw when no turn is active', () => {
      const state = createMockState({ activeTurn: undefined });

      expect(() => assertNotBusy(state)).not.toThrow();
    });

    it('should throw SessionBusy when turn is active', () => {
      const state = createMockState({ activeTurn: { id: 'test-turn' } });

      expect(() => assertNotBusy(state)).toThrow(
        expect.objectContaining({
          code: AcpErrorCodes.SessionBusy,
          message: 'SessionBusy',
          data: { category: 'session' },
        })
      );
    });
  });

  describe('assertSessionReady', () => {
    it('should not throw when session exists and no turn active', () => {
      const state = createMockState({
        activeSession: { id: 'test-session' },
        activeTurn: undefined,
      });

      expect(() => assertSessionReady(state)).not.toThrow();
    });

    it('should throw SessionNotFound when no session', () => {
      const state = createMockState({ activeSession: undefined });

      expect(() => assertSessionReady(state)).toThrow(
        expect.objectContaining({
          code: AcpErrorCodes.SessionNotFound,
        })
      );
    });

    it('should throw SessionBusy when turn is active', () => {
      const state = createMockState({
        activeSession: { id: 'test-session' },
        activeTurn: { id: 'test-turn' },
      });

      expect(() => assertSessionReady(state)).toThrow(
        expect.objectContaining({
          code: AcpErrorCodes.SessionBusy,
        })
      );
    });
  });
});
