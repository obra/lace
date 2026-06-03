// ABOUTME: PerInvocationReaper — schedules container teardown after idle TTL
// ABOUTME: Per_invocation containers survive child exit so resume works,
// ABOUTME: then are destroyed after an idle window if no resume arrives.

import type { ContainerManager } from '@lace/agent/containers/container-manager';
import { logger } from '@lace/agent/utils/logger';

export const PER_INVOCATION_IDLE_TTL_MS_DEFAULT = 30 * 60 * 1000; // 30 minutes

function readTtlMsFromEnv(): number {
  const raw = process.env.LACE_PER_INVOCATION_IDLE_TTL_MS;
  if (raw === undefined) return PER_INVOCATION_IDLE_TTL_MS_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : PER_INVOCATION_IDLE_TTL_MS_DEFAULT;
}

type PendingReap = { specName: string; timer: ReturnType<typeof setTimeout> };

export class PerInvocationReaper {
  private readonly pending = new Map<string, PendingReap>();

  readonly ttlMs: number;

  constructor(
    // null is accepted for unsupported platforms (no container runtime).
    // scheduleReap becomes a no-op when null so callers never need to guard.
    private readonly containerManager: ContainerManager | null,
    opts?: {
      ttlMs?: number;
    }
  ) {
    this.ttlMs = opts?.ttlMs ?? readTtlMsFromEnv();
  }

  scheduleReap(childSessionId: string, specName: string): void {
    // Replace any existing timer for this session.
    this.cancelReap(childSessionId);
    const timer = setTimeout(() => {
      this.pending.delete(childSessionId);
      if (!this.containerManager) return;
      void this.containerManager.destroy(specName).catch((err: unknown) => {
        logger.warn('per_invocation_reaper.destroy_failed', {
          childSessionId,
          specName,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.ttlMs);
    this.pending.set(childSessionId, { specName, timer });
  }

  cancelReap(childSessionId: string): void {
    const entry = this.pending.get(childSessionId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(childSessionId);
  }

  dispose(): void {
    for (const { timer } of this.pending.values()) {
      clearTimeout(timer);
    }
    this.pending.clear();
  }

  /** Test helper: check whether a reap is pending for the given childSessionId. */
  hasPendingReap(childSessionId: string): boolean {
    return this.pending.has(childSessionId);
  }
}
