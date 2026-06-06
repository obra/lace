// ABOUTME: WorkspaceReaper — per-process map of per_invocation child workspaces (#5)
// ABOUTME: dispose = destroy the owning container BEFORE rm; safeRemoveWorkspace is symlink-safe + tolerant

import * as fs from 'node:fs';
import { logger } from '@lace/agent/utils/logger';
import type { ContainerManager } from '@lace/agent/containers/container-manager';
import type { PerInvocationReaper } from './per-invocation-reaper';
import { resultsBase } from './results-tree';

/**
 * The container is always destroyed before this runs (no live writer), but the
 * remover stays symlink-safe (statically-planted links), continue-on-error, and
 * MUST never throw past the caller — an ENOTEMPTY after a skip must not crash
 * the sweep interval or abort teardown.
 *
 * Never follow a child-planted symlink out of the results base. Re-lstat every
 * entry immediately before acting (do NOT trust readdir's cached dirent type),
 * and never let one bad entry abort the walk.
 */
export function safeRemoveWorkspace(targetPath: string, base: string): void {
  const realBase = fs.realpathSync(base);
  const top = fs.lstatSync(targetPath); // lstat: do not follow a symlinked top
  if (top.isSymbolicLink() || !top.isDirectory()) {
    fs.unlinkSync(targetPath); // a symlink/file top: unlink, never recurse
    return;
  }
  const real = fs.realpathSync(targetPath);
  if (real !== realBase && !real.startsWith(realBase + '/')) {
    throw new Error(`refusing to reap path outside results base: ${real}`);
  }
  for (const name of fs.readdirSync(real)) {
    // names only — re-lstat each, no cached type
    const p = `${real}/${name}`;
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink() || !st.isDirectory())
        fs.unlinkSync(p); // unlink follows nothing
      else safeRemoveWorkspace(p, realBase); // recurse only REAL dirs
    } catch (e) {
      logger.warn(`workspace-reaper: skipping ${p}: ${e}`); // continue-on-error
    }
  }
  try {
    fs.rmdirSync(real);
  } catch (e) {
    // tolerant: a non-empty dir after a skip
    logger.warn(`workspace-reaper: leaving non-empty ${real}: ${e}`);
  } // → next pass
}

/** A tracked per_invocation child workspace. */
export interface WorkspaceEntry {
  parentId: string;
  path: string;
  containerSpecName?: string;
}

/**
 * In-memory, per-process map of the per_invocation child workspaces THIS process
 * created. No timers. `dispose` is the single safe-remove primitive: it destroys
 * the owning container (the live writer) and cancels its idle-reap BEFORE rm.
 *
 * Runtime refs (containerManager / perInvocationReaper) are late-bound in boot()
 * after the container manager resolves — mirror how perInvocationReaper itself is
 * constructed null and replaced in main.ts.
 */
export class WorkspaceReaper {
  private readonly tracked = new Map<string, WorkspaceEntry>();
  // Per-childId lock tail. Serializes release vs resume for the same child so a
  // resume can't resurrect a workspace mid-dispose. There is no other per-childId
  // lock in the system (per-invocation-reaper holds only timers).
  private readonly locks = new Map<string, Promise<unknown>>();
  // Childs disposed in THIS process — non-resumable. In-memory only (a crash
  // loses it; delegate's empty-workspace gate is the crash backstop).
  private readonly released = new Set<string>();
  private containerManager: ContainerManager | null = null;
  private perInvocationReaper: PerInvocationReaper | null = null;

  bindRuntime(
    containerManager: ContainerManager | null,
    perInvocationReaper: PerInvocationReaper | null
  ): void {
    this.containerManager = containerManager;
    this.perInvocationReaper = perInvocationReaper;
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
   * The single safe-remove primitive. Order is load-bearing:
   *   cancelReap → destroy(container) → rm dir → forget.
   * If destroy rejects we do NOT rm (the container may still hold /work RW); the
   * error propagates so callers' per-entry try/catch leaves the entry tracked.
   * dispose of an unknown id is a no-op (the sweep is the backstop for forgotten
   * entries).
   */
  async dispose(childId: string): Promise<void> {
    const entry = this.tracked.get(childId);
    if (!entry) return;
    this.perInvocationReaper?.cancelReap(childId);
    if (entry.containerSpecName) {
      await this.containerManager?.destroy(entry.containerSpecName);
    }
    safeRemoveWorkspace(entry.path, resultsBase());
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
