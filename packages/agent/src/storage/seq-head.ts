// ABOUTME: Per-session monotonic head file (<sessionDir>/.seq) holding the next-free
// ABOUTME: eventSeq. reserveSeq advances the head BEFORE returning the reserved seq
// (reserve-before-append: a crash burns a gap, never a duplicate). The head reconciles
// to MAX(MAX(JSONL)+1, stored) on open — monotonic, never moving down. The CALLER must
// hold the per-session lock (see session-lock.ts) across reserve + the JSONL append.
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Returns MAX(eventSeq) across this session's JSONL (last-consumed; 0 if empty). */
export type DeriveMaxJsonl = () => number;

function headPath(sessionDir: string): string {
  return path.join(sessionDir, '.seq');
}

/**
 * Read the stored next-free seq, or `undefined` if the head file is absent or
 * its contents are not a valid non-negative integer (a corrupt/torn head reseeds
 * via the caller's reconcile/seed against the JSONL).
 *
 * An empty or whitespace-only file is treated as corrupt: a torn `writeFileSync`
 * truncates the head to 0 bytes first, and `Number('') === 0` would otherwise
 * read that torn state as a VALID head of 0 — handing out seqs from 0 and
 * defeating the torn-head reseed. A negative value is likewise rejected (a head
 * is a next-free seq and is never negative).
 */
export function readHead(sessionDir: string): number | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(headPath(sessionDir), 'utf8');
  } catch {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0) return undefined;
  return n;
}

function writeHead(sessionDir: string, head: number): void {
  fs.writeFileSync(headPath(sessionDir), String(head), { encoding: 'utf8' });
}

/**
 * Seed the head file from MAX(JSONL)+1 ONLY if it is currently absent/corrupt.
 * A present, valid head is left untouched. Caller holds the lock.
 */
export function seedHead(sessionDir: string, deriveMaxJsonl: DeriveMaxJsonl): number {
  const existing = readHead(sessionDir);
  if (existing !== undefined) return existing;
  const head = deriveMaxJsonl() + 1;
  writeHead(sessionDir, head);
  return head;
}

/**
 * Reserve the next eventSeq. Reads (or seeds) the head H, writes H+1 to disk
 * FIRST (so a crash before the JSONL append burns H as a gap, never a dup),
 * then returns H. Caller holds the lock and appends the JSONL line with seq=H.
 */
export function reserveSeq(sessionDir: string, deriveMaxJsonl: DeriveMaxJsonl): number {
  const head = seedHead(sessionDir, deriveMaxJsonl);
  // RESERVE: advance the head BEFORE the caller appends the JSONL line.
  writeHead(sessionDir, head + 1);
  return head;
}

/**
 * Reconcile the head on session open: head = MAX(readHead()|0, MAX(JSONL)+1).
 * Monotonic-merge — it can only move the head UP, so a stale or lost head can
 * never hand out a seq <= an existing JSONL seq. Caller holds the lock.
 */
export function reconcileHead(sessionDir: string, deriveMaxJsonl: DeriveMaxJsonl): number {
  const stored = readHead(sessionDir) ?? 0;
  const floor = deriveMaxJsonl() + 1;
  const head = Math.max(stored, floor);
  writeHead(sessionDir, head);
  return head;
}
