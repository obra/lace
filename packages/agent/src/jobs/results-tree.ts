// ABOUTME: Shared results-tree layout for per_invocation subagent workspaces (#5)
// ABOUTME: <base>/<parentId>/<childId> + the <base>/<parentId>/.owner liveness marker

import * as fs from 'node:fs';
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

/**
 * `<base>/<parentId>` — the dir holding a parent's children + its `.owner`.
 * This is the dir a container parent bind-mounts read-only to read its children.
 */
export function childrenBaseDir(parentId: string): string {
  assertSafeSegment('parentId', parentId);
  return path.join(resultsBase(), parentId);
}

/** `<base>/<parentId>/<childId>` — both segments validated. */
export function childWorkspaceDir(parentId: string, childId: string): string {
  assertSafeSegment('childId', childId);
  return path.join(childrenBaseDir(parentId), childId);
}

/** `<base>/<parentId>/.owner` — the liveness marker, never inside a child mount. */
export function ownerMarkerPath(parentId: string): string {
  return path.join(childrenBaseDir(parentId), '.owner');
}

/** Normalized absolute path: realpath if it exists, else path.resolve (ENOENT). */
function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** True if a and b are equal or one is a path-nested ancestor of the other. */
export function pathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  return a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}

/**
 * Ensure resultsBase() is disjoint from every embedder container mount, so the
 * crash sweep (confined to resultsBase()) can never descend into a durable
 * persona mount. Creates the base first (realpath needs it to exist) and throws
 * on any overlap — the caller (initialize handler) fails initialization.
 */
export function assertResultsBaseDisjoint(mounts: Record<string, { hostPath: string }>): void {
  fs.mkdirSync(resultsBase(), { recursive: true, mode: 0o700 });
  const realBase = realpathOrResolve(resultsBase());
  for (const [name, entry] of Object.entries(mounts)) {
    const realMount = realpathOrResolve(entry.hostPath);
    if (pathsOverlap(realBase, realMount)) {
      throw new Error(
        `results base ${realBase} overlaps container mount '${name}' (${realMount}); ` +
          `set LACE_WORK_DIR to a path disjoint from all persona mounts`
      );
    }
  }
}

/** Owner marker contents: the live process pid + its anti-pid-recycle nonce. */
export interface OwnerMarker {
  pid: number;
  startNonce: string;
}

/**
 * Parse field 22 (kernel start_time) out of a `/proc/<pid>/stat` line. Field 2
 * (comm) is parenthesised and may itself contain spaces and `)`, so we slice
 * after the LAST `)` and index into the post-comm tail: field 3 (state) is at
 * index 0, so field 22 (start_time) is at index 19.
 */
export function parseProcStartTime(statLine: string): string | undefined {
  const close = statLine.lastIndexOf(')');
  if (close < 0) return undefined;
  const rest = statLine.slice(close + 2);
  const startTime = rest.split(' ')[19];
  return startTime;
}

/** Read the start-time nonce for a pid, or undefined if /proc is unreadable. */
export function readProcStartTime(pid: number): string | undefined {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return parseProcStartTime(stat);
  } catch {
    return undefined;
  }
}

/**
 * Atomically write `<base>/<parentId>/.owner` with this process's pid + start
 * nonce. tmp+rename so a concurrent reader never sees a half-written marker.
 * Idempotent: the live process always wins (rename clobbers any prior marker).
 */
export function writeOwnerMarker(parentId: string): void {
  fs.mkdirSync(childrenBaseDir(parentId), { recursive: true, mode: 0o700 });
  const marker: OwnerMarker = {
    pid: process.pid,
    startNonce: readProcStartTime(process.pid) ?? '',
  };
  const finalPath = ownerMarkerPath(parentId);
  const tmpPath = finalPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(marker), { mode: 0o600 });
  fs.renameSync(tmpPath, finalPath);
}

/** Read + parse `<base>/<parentId>/.owner`; null if missing or unparseable. */
export function readOwnerMarker(parentId: string): OwnerMarker | null {
  try {
    const raw = fs.readFileSync(ownerMarkerPath(parentId), 'utf8');
    const parsed = JSON.parse(raw) as Partial<OwnerMarker>;
    if (typeof parsed.pid !== 'number' || typeof parsed.startNonce !== 'string') {
      return null;
    }
    return { pid: parsed.pid, startNonce: parsed.startNonce };
  } catch {
    return null;
  }
}

/**
 * A marker is alive iff it parses AND the pid still exists AND its current
 * start-time nonce matches the recorded one (guarding against pid recycling).
 * A missing/unparseable marker (null) is dead — safe to reclaim.
 */
export function ownerIsAlive(marker: OwnerMarker | null): boolean {
  if (!marker) return false;
  try {
    process.kill(marker.pid, 0);
  } catch {
    return false; // ESRCH (gone) or EPERM (not ours → treat as dead/unknown)
  }
  return readProcStartTime(marker.pid) === marker.startNonce;
}
