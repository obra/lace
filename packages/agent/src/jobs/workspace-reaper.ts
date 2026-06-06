// ABOUTME: WorkspaceReaper — per-process tracker of per_invocation child workspaces (#5)
// ABOUTME: dispose routes teardown to the shim via ContainerManager.releasePerInvocation

import { logger } from '@lace/agent/utils/logger';
import type { ContainerManager } from '@lace/agent/containers/container-manager';

/** A tracked per_invocation child workspace. */
export interface WorkspaceEntry {
  parentId: string;
  path: string;
  containerSpecName?: string;
}

/**
 * In-memory, per-process tracker of the per_invocation child workspaces THIS
 * process created. No timers. `dispose` routes teardown to the shim via
 * ContainerManager.releasePerInvocation — the shim destroys the container AND
 * removes its `/work` (and owns the idle TTL). lace no longer reaps workspaces.
 *
 * The containerManager ref is late-bound in boot() after the container manager
 * resolves.
 */
export class WorkspaceReaper {
  private readonly tracked = new Map<string, WorkspaceEntry>();
  // Per-childId lock tail. Serializes release vs resume for the same child so a
  // resume can't resurrect a workspace mid-dispose.
  private readonly locks = new Map<string, Promise<unknown>>();
  // Childs disposed in THIS process — non-resumable. In-memory only (a crash
  // loses it; delegate's empty-workspace gate is the crash backstop).
  private readonly released = new Set<string>();
  private containerManager: ContainerManager | null = null;

  bindRuntime(containerManager: ContainerManager | null): void {
    this.containerManager = containerManager;
  }

  track(entry: { childId: string } & WorkspaceEntry): void {
    const { childId, parentId, path, containerSpecName } = entry;
    this.tracked.set(childId, {
      parentId,
      path,
      ...(containerSpecName ? { containerSpecName } : {}),
    });
  }

  /** The tracked entry for a child (for ownership checks), or undefined. */
  get(childId: string): WorkspaceEntry | undefined {
    return this.tracked.get(childId);
  }

  /**
   * Run `fn` with exclusive access to `childId` — serializes release vs resume
   * for the same child. Different childIds never block each other. The lock is
   * released even if `fn` throws.
   */
  async runExclusive<T>(childId: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(childId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Our tail resolves after prior's section AND after we release() — so the
    // next caller queues behind us. gate never rejects, so the chain is robust.
    const tail = prior.then(() => gate);
    this.locks.set(childId, tail);
    await prior; // wait our turn (prior tails never reject)
    try {
      return await fn();
    } finally {
      release();
      // Drop the entry only if nobody queued behind us, to bound the map.
      if (this.locks.get(childId) === tail) this.locks.delete(childId);
    }
  }

  /** Number of workspaces retained for a parent — O(1)-ish, no fs/du. */
  countForParent(parentId: string): number {
    let n = 0;
    for (const entry of this.tracked.values()) if (entry.parentId === parentId) n++;
    return n;
  }

  /**
   * Route teardown of a per_invocation child through the shim: the shim owns
   * destroying the container AND removing its `/work` workspace (and the idle
   * TTL). lace no longer reaps the workspace itself. If releasePerInvocation
   * rejects the error propagates so callers' per-entry try/catch leaves the
   * entry tracked. dispose of an unknown id is a no-op (the shim's idle reaper
   * is the backstop for forgotten entries).
   */
  async dispose(childId: string): Promise<void> {
    const entry = this.tracked.get(childId);
    if (!entry) return;
    await this.containerManager?.releasePerInvocation(
      entry.parentId,
      childId,
      entry.containerSpecName
    );
    this.tracked.delete(childId);
    // Close the resume window: a disposed child is non-resumable in this process.
    this.released.add(childId);
  }

  /** True once this child has been disposed in this process (non-resumable). */
  isReleased(childId: string): boolean {
    return this.released.has(childId);
  }

  /** dispose every entry for a parent; per-entry try/catch (one fail ≠ strand rest). */
  async releaseAllForParent(parentId: string): Promise<void> {
    for (const [childId, entry] of [...this.tracked]) {
      if (entry.parentId !== parentId) continue;
      try {
        await this.dispose(childId);
      } catch (e) {
        logger.warn(`workspace-reaper: dispose of ${childId} failed: ${e}`);
      }
    }
  }

  /** dispose every tracked entry (per-process teardown); per-entry try/catch. */
  async releaseAllTracked(): Promise<void> {
    for (const childId of [...this.tracked.keys()]) {
      try {
        await this.dispose(childId);
      } catch (e) {
        logger.warn(`workspace-reaper: dispose of ${childId} failed: ${e}`);
      }
    }
  }

  list(): Array<{ childId: string } & WorkspaceEntry> {
    return [...this.tracked].map(([childId, entry]) => ({ childId, ...entry }));
  }
}
