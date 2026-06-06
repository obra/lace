// ABOUTME: Crash-backstop sweep for orphaned per_invocation workspaces (#5 Part 4)
// ABOUTME: doubly gated — skip live-owner subtrees AND any subtree a live container's bind source holds

import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '@lace/agent/utils/logger';
import type { ContainerManager } from '@lace/agent/containers/container-manager';
import { resultsBase, ownerMarkerPath, readOwnerMarker, ownerIsAlive } from './results-tree';
import { safeRemoveWorkspace } from './workspace-reaper';

export const WORKSPACE_SWEEP_INTERVAL_MS_DEFAULT = 15 * 60 * 1000; // 15 minutes

export function readSweepIntervalMs(): number {
  const raw = process.env.LACE_WORKSPACE_SWEEP_INTERVAL_MS;
  if (raw === undefined) return WORKSPACE_SWEEP_INTERVAL_MS_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : WORKSPACE_SWEEP_INTERVAL_MS_DEFAULT;
}

/**
 * One sweep pass over resultsBase(), reclaiming orphaned per_invocation
 * workspaces. Doubly liveness-gated:
 *   - skip a subtree whose `.owner` process is alive (it disposes its own
 *     children);
 *   - skip any dir that is a LIVE container's bind source (its /work, or a
 *     markerless RO read-base during the create-gap) — leave it for a later boot.
 *
 * `liveSources` = host bind-mount sources of all running lace-* containers.
 * Confined to resultsBase() (disjoint from durable mounts, asserted at
 * initialize). Each top-level subtree is wrapped so one bad subtree can't abort
 * the rest or crash the interval.
 */
export function sweepPass(liveSources: Set<string>): void {
  const base = resultsBase();
  let parents: string[];
  try {
    if (!fs.existsSync(base)) return;
    parents = fs.readdirSync(base);
  } catch (e) {
    logger.warn(`workspace-sweep: cannot read base ${base}: ${e}`);
    return;
  }

  for (const parentId of parents) {
    try {
      sweepParentSubtree(base, parentId, liveSources);
    } catch (e) {
      logger.warn(`workspace-sweep: skipping subtree ${parentId}: ${e}`);
    }
  }
}

function sweepParentSubtree(base: string, parentId: string, liveSources: Set<string>): void {
  const parentDir = path.join(base, parentId);
  const st = fs.lstatSync(parentDir);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    fs.unlinkSync(parentDir); // a stray symlink/file at the top level
    return;
  }

  // Live owner → that process disposes its own children (incl. retained ones).
  if (ownerIsAlive(readOwnerMarker(parentId))) return;

  // A live container holds this whole base as a bind source (e.g. an RO
  // children-read base during the create-gap, before its owner wrote a marker).
  if (liveSources.has(parentDir)) return;

  let liveChildRemains = false;
  for (const name of fs.readdirSync(parentDir)) {
    if (name === '.owner') continue;
    const childDir = path.join(parentDir, name);
    if (liveSources.has(childDir)) {
      // An orphaned-but-still-running container holds this /work — leave it for
      // the next boot's startup-reaper (which kills it) + sweep.
      logger.info(`workspace-sweep: retaining live-container workspace ${childDir}`);
      liveChildRemains = true;
      continue;
    }
    safeRemoveWorkspace(childDir, base);
  }

  // Remove the now-(maybe-)empty parent + its .owner only when nothing live
  // remains and no live container holds the base itself.
  if (!liveChildRemains) {
    try {
      fs.rmSync(ownerMarkerPath(parentId), { force: true });
    } catch (e) {
      logger.warn(`workspace-sweep: could not remove ${ownerMarkerPath(parentId)}: ${e}`);
    }
    try {
      fs.rmdirSync(parentDir);
    } catch (e) {
      logger.warn(`workspace-sweep: leaving non-empty ${parentDir}: ${e}`);
    }
  }
}

/**
 * Fetch the live bind-source set from the container manager, then run one pass.
 * Best-effort: a null manager (unsupported platform) sweeps with an empty live
 * set (safe after startup-reaper has killed orphans at boot).
 */
export async function runWorkspaceSweep(containerManager: ContainerManager | null): Promise<void> {
  let liveSources = new Set<string>();
  if (containerManager) {
    try {
      liveSources = await containerManager.liveBindSources();
    } catch (e) {
      logger.warn(`workspace-sweep: liveBindSources failed; skipping pass to stay safe: ${e}`);
      return; // without the live set we can't safely reap — wait for the next pass
    }
  }
  sweepPass(liveSources);
}
