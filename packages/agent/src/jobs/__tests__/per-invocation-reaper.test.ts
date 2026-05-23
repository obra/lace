// ABOUTME: Tests for PerInvocationReaper — idle TTL teardown for per_invocation containers
// ABOUTME: PRI-1796 Chunk E: verifies schedule/cancel/dispose lifecycle with fake timers

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ContainerManager } from '@lace/agent/containers/container-manager';
import { PerInvocationReaper, PER_INVOCATION_IDLE_TTL_MS_DEFAULT } from '../per-invocation-reaper';

// Minimal ContainerManager mock — only destroy matters for the reaper.
function makeContainerManager(): {
  instance: Pick<ContainerManager, 'destroy'>;
  destroy: ReturnType<typeof vi.fn>;
} {
  const destroy = vi.fn().mockResolvedValue(undefined);
  const instance = { destroy } as unknown as Pick<ContainerManager, 'destroy'>;
  return { instance, destroy };
}

describe('PerInvocationReaper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires destroy after TTL elapses', async () => {
    const { instance, destroy } = makeContainerManager();
    const ttlMs = 1000;
    const reaper = new PerInvocationReaper(instance as ContainerManager, { ttlMs });

    reaper.scheduleReap('sess_abc', 'spec-xyz');

    // Just before TTL — should NOT have fired yet
    await vi.advanceTimersByTimeAsync(ttlMs - 1);
    expect(destroy).not.toHaveBeenCalled();

    // At TTL — should fire
    await vi.advanceTimersByTimeAsync(1);
    expect(destroy).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledWith('spec-xyz');
  });

  it('replaces an existing timer when scheduling the same childSessionId twice', async () => {
    const { instance, destroy } = makeContainerManager();
    const ttlMs = 1000;
    const reaper = new PerInvocationReaper(instance as ContainerManager, { ttlMs });

    reaper.scheduleReap('sess_abc', 'spec-first');
    reaper.scheduleReap('sess_abc', 'spec-second');

    await vi.advanceTimersByTimeAsync(ttlMs + 100);

    // Only the second specName's destroy should fire — never the first
    expect(destroy).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledWith('spec-second');
    expect(destroy).not.toHaveBeenCalledWith('spec-first');
  });

  it('cancelReap stops a pending reap', async () => {
    const { instance, destroy } = makeContainerManager();
    const ttlMs = 1000;
    const reaper = new PerInvocationReaper(instance as ContainerManager, { ttlMs });

    reaper.scheduleReap('sess_abc', 'spec-xyz');
    reaper.cancelReap('sess_abc');

    await vi.advanceTimersByTimeAsync(ttlMs + 100);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('cancelReap is a no-op when no pending reap exists for the session', () => {
    const { instance } = makeContainerManager();
    const reaper = new PerInvocationReaper(instance as ContainerManager, { ttlMs: 1000 });

    // Should not throw
    expect(() => reaper.cancelReap('nonexistent-session')).not.toThrow();
  });

  it('dispose clears all pending timers and no destroys fire', async () => {
    const { instance, destroy } = makeContainerManager();
    const ttlMs = 1000;
    const reaper = new PerInvocationReaper(instance as ContainerManager, { ttlMs });

    reaper.scheduleReap('sess_1', 'spec-1');
    reaper.scheduleReap('sess_2', 'spec-2');
    reaper.scheduleReap('sess_3', 'spec-3');

    reaper.dispose();

    await vi.advanceTimersByTimeAsync(ttlMs + 100);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('scheduleReap does not throw synchronously even if destroy rejects', () => {
    const { instance, destroy } = makeContainerManager();
    destroy.mockRejectedValue(new Error('container gone'));

    const reaper = new PerInvocationReaper(instance as ContainerManager, { ttlMs: 100 });

    // scheduleReap itself must not throw
    expect(() => reaper.scheduleReap('sess_abc', 'spec-xyz')).not.toThrow();
  });

  it('destroy rejection is logged and does not crash when timer fires', async () => {
    const { instance, destroy } = makeContainerManager();
    destroy.mockRejectedValue(new Error('container gone'));

    const reaper = new PerInvocationReaper(instance as ContainerManager, { ttlMs: 100 });
    reaper.scheduleReap('sess_abc', 'spec-xyz');

    // Advance past TTL — the promise rejection must be swallowed (no unhandled rejection)
    await expect(vi.advanceTimersByTimeAsync(200)).resolves.not.toThrow();
  });

  it('hasPendingReap returns true when a reap is scheduled', () => {
    const { instance } = makeContainerManager();
    const reaper = new PerInvocationReaper(instance as ContainerManager, { ttlMs: 1000 });

    expect(reaper.hasPendingReap('sess_abc')).toBe(false);
    reaper.scheduleReap('sess_abc', 'spec-xyz');
    expect(reaper.hasPendingReap('sess_abc')).toBe(true);
  });

  it('hasPendingReap returns false after cancelReap', () => {
    const { instance } = makeContainerManager();
    const reaper = new PerInvocationReaper(instance as ContainerManager, { ttlMs: 1000 });

    reaper.scheduleReap('sess_abc', 'spec-xyz');
    reaper.cancelReap('sess_abc');
    expect(reaper.hasPendingReap('sess_abc')).toBe(false);
  });

  it('hasPendingReap returns false after timer fires', async () => {
    const { instance } = makeContainerManager();
    const ttlMs = 500;
    const reaper = new PerInvocationReaper(instance as ContainerManager, { ttlMs });

    reaper.scheduleReap('sess_abc', 'spec-xyz');
    expect(reaper.hasPendingReap('sess_abc')).toBe(true);

    await vi.advanceTimersByTimeAsync(ttlMs + 1);
    expect(reaper.hasPendingReap('sess_abc')).toBe(false);
  });

  it('uses the default TTL from the constant when no ttlMs option is provided', () => {
    const { instance } = makeContainerManager();
    const reaper = new PerInvocationReaper(instance as ContainerManager);

    expect(reaper.ttlMs).toBe(PER_INVOCATION_IDLE_TTL_MS_DEFAULT);
  });

  it('reads TTL from LACE_PER_INVOCATION_IDLE_TTL_MS environment variable', () => {
    const { instance } = makeContainerManager();
    const originalEnv = process.env.LACE_PER_INVOCATION_IDLE_TTL_MS;
    try {
      process.env.LACE_PER_INVOCATION_IDLE_TTL_MS = '12345';
      const reaper = new PerInvocationReaper(instance as ContainerManager);
      expect(reaper.ttlMs).toBe(12345);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.LACE_PER_INVOCATION_IDLE_TTL_MS;
      } else {
        process.env.LACE_PER_INVOCATION_IDLE_TTL_MS = originalEnv;
      }
    }
  });

  it('falls back to default TTL when LACE_PER_INVOCATION_IDLE_TTL_MS is invalid', () => {
    const { instance } = makeContainerManager();
    const originalEnv = process.env.LACE_PER_INVOCATION_IDLE_TTL_MS;
    try {
      process.env.LACE_PER_INVOCATION_IDLE_TTL_MS = 'not-a-number';
      const reaper = new PerInvocationReaper(instance as ContainerManager);
      expect(reaper.ttlMs).toBe(PER_INVOCATION_IDLE_TTL_MS_DEFAULT);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.LACE_PER_INVOCATION_IDLE_TTL_MS;
      } else {
        process.env.LACE_PER_INVOCATION_IDLE_TTL_MS = originalEnv;
      }
    }
  });
});
