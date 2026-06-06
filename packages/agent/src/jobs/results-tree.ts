// ABOUTME: Shared results-tree layout for per_invocation subagent workspaces (#5)
// ABOUTME: <base>/<parentId>/<childId> — the shim owns reaping and liveness

import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Root of the shared results tree. Matches delegate.ts's historical
 * `scratchBase` so existing LACE_WORK_DIR deployments keep the same root.
 */
export function resultsBase(): string {
  return process.env.LACE_WORK_DIR ?? path.join(os.tmpdir(), 'lace-work');
}

/**
 * Reject any id that could escape its parent dir. parentId/childId become single
 * path segments under resultsBase(); a `/`, `\`, `..`, NUL, or empty id would
 * let a caller (or a forged session id) climb out of the base. This is the
 * static guard behind the realpath-confinement invariant.
 */
function assertSafeSegment(label: string, id: string): void {
  if (
    id.length === 0 ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('\0') ||
    id.includes('..')
  ) {
    throw new Error(`results-tree: unsafe ${label} segment: ${JSON.stringify(id)}`);
  }
}

/** `<base>/<parentId>` — the dir holding a parent's children. */
export function childrenBaseDir(parentId: string): string {
  assertSafeSegment('parentId', parentId);
  return path.join(resultsBase(), parentId);
}

/** `<base>/<parentId>/<childId>` — both segments validated. */
export function childWorkspaceDir(parentId: string, childId: string): string {
  assertSafeSegment('childId', childId);
  return path.join(childrenBaseDir(parentId), childId);
}
