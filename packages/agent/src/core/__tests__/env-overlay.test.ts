// ABOUTME: Unit tests for the memory-only credential env overlay helpers (PRI-3672):
// ABOUTME: expiry pruning, the live-read projection, and the dangerous-name denylist.

import { describe, it, expect } from 'vitest';
import {
  DANGEROUS_ENV_VAR_NAMES,
  isDangerousEnvVarName,
  pruneExpiredEnvOverlay,
  liveEnvOverlay,
} from '../env-overlay';
import type { AgentServerState } from '../../server-types';

function fakeState(
  envOverlay?: AgentServerState['envOverlay']
): Pick<AgentServerState, 'envOverlay'> {
  return { envOverlay };
}

describe('env-overlay helpers (PRI-3672)', () => {
  describe('liveEnvOverlay', () => {
    it('returns undefined when there is no overlay at all', () => {
      const state = fakeState(undefined) as AgentServerState;
      expect(liveEnvOverlay(state)).toBeUndefined();
    });

    it('returns undefined for an overlay that is present but empty', () => {
      const state = fakeState({}) as AgentServerState;
      expect(liveEnvOverlay(state)).toBeUndefined();
    });

    it('returns a plain value map for live, non-expiring entries', () => {
      const state = fakeState({
        FOO: { value: 'test-placeholder-xyz' },
        BAR: { value: 'test-placeholder-abc' },
      }) as AgentServerState;
      expect(liveEnvOverlay(state)).toEqual({
        FOO: 'test-placeholder-xyz',
        BAR: 'test-placeholder-abc',
      });
    });

    it('omits an entry whose expiresAt is in the past, and drops it from the map (lace drops the key itself)', () => {
      const now = 1_000_000;
      const state = fakeState({
        EXPIRED: { value: 'test-placeholder-xyz', expiresAt: now - 1 },
        LIVE: { value: 'test-placeholder-abc', expiresAt: now + 10_000 },
      }) as AgentServerState;

      expect(liveEnvOverlay(state, now)).toEqual({ LIVE: 'test-placeholder-abc' });
      // Not just filtered on read — actually removed, so it can't reappear
      // via some other code path that reads state.envOverlay directly.
      expect(Object.keys(state.envOverlay ?? {})).toEqual(['LIVE']);
    });

    it('treats expiresAt exactly equal to now as expired (boundary)', () => {
      const now = 1_000_000;
      const state = fakeState({
        BOUNDARY: { value: 'test-placeholder-xyz', expiresAt: now },
      }) as AgentServerState;
      expect(liveEnvOverlay(state, now)).toBeUndefined();
    });

    it('keeps an entry with no expiresAt forever (no timer involved)', () => {
      const state = fakeState({
        STICKY: { value: 'test-placeholder-xyz' },
      }) as AgentServerState;
      expect(liveEnvOverlay(state, Date.now() + 1_000 * 60 * 60 * 24 * 365)).toEqual({
        STICKY: 'test-placeholder-xyz',
      });
    });
  });

  describe('pruneExpiredEnvOverlay', () => {
    it('mutates the map in place, leaving only live entries', () => {
      const now = 5_000;
      const state = fakeState({
        A: { value: 'test-placeholder-a', expiresAt: now - 1 },
        B: { value: 'test-placeholder-b', expiresAt: now + 1 },
        C: { value: 'test-placeholder-c' },
      }) as AgentServerState;

      pruneExpiredEnvOverlay(state, now);
      expect(state.envOverlay).toEqual({
        B: { value: 'test-placeholder-b', expiresAt: now + 1 },
        C: { value: 'test-placeholder-c' },
      });
    });

    it('is a no-op when there is no overlay', () => {
      const state = fakeState(undefined) as AgentServerState;
      expect(() => pruneExpiredEnvOverlay(state)).not.toThrow();
      expect(state.envOverlay).toBeUndefined();
    });
  });

  describe('isDangerousEnvVarName', () => {
    it.each(['PATH', 'NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES'])(
      'refuses %s',
      (name) => {
        expect(isDangerousEnvVarName(name)).toBe(true);
      }
    );

    it('is case-insensitive (env var names are conventionally upper-case but the check should not rely on that)', () => {
      expect(isDangerousEnvVarName('path')).toBe(true);
      expect(isDangerousEnvVarName('Path')).toBe(true);
    });

    it('allows an ordinary credential-shaped name', () => {
      expect(isDangerousEnvVarName('GH_TOKEN')).toBe(false);
      expect(isDangerousEnvVarName('MY_API_KEY')).toBe(false);
    });

    it('matches the exported denylist contents exactly', () => {
      for (const name of DANGEROUS_ENV_VAR_NAMES) {
        expect(isDangerousEnvVarName(name)).toBe(true);
      }
    });
  });
});
