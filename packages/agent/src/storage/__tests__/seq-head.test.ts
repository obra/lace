// ABOUTME: Tests for the per-session monotonic head file (<sessionDir>/.seq).
// ABOUTME: Head stores the next-free seq; reserve/seed/reconcile semantics.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHead, reserveSeq, reconcileHead, seedHead } from '../seq-head';

describe('seq-head', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lace-seqhead-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function writeHead(d: string, n: number): void {
    writeFileSync(join(d, '.seq'), String(n), { encoding: 'utf8' });
  }

  it('readHead returns undefined when the head file is missing', () => {
    expect(readHead(dir)).toBeUndefined();
  });

  it('seeds from MAX(JSONL)+1 when the head is missing', () => {
    // .seq absent; JSONL max = 10 → first reserved seq is 11, head advances to 12.
    expect(reserveSeq(dir, () => 10)).toBe(11);
    expect(readHead(dir)).toBe(12);
  });

  it('reserve is strictly increasing', () => {
    const a = reserveSeq(dir, () => 10);
    const b = reserveSeq(dir, () => 10);
    expect(b).toBe(a + 1);
  });

  it('reserveSeq writes head H+1 BEFORE returning H (reserve-before-append)', () => {
    // After reserveSeq returns H, the head file already holds H+1, so a crash
    // immediately after the call (before the JSONL append) burns H — a gap.
    const h = reserveSeq(dir, () => 0); // empty JSONL → seed head = 1, reserve 1
    expect(h).toBe(1);
    expect(readHead(dir)).toBe(h + 1);
  });

  it('seeds head=1 when JSONL is empty (MAX=0 → head=1, first seq=1)', () => {
    expect(reserveSeq(dir, () => 0)).toBe(1);
    expect(readHead(dir)).toBe(2);
  });

  it('reconcile never lowers the head and floors at MAX(JSONL)+1', () => {
    writeHead(dir, 5); // stale head below JSONL max 10
    reconcileHead(dir, () => 10); // MAX(JSONL)=10 → head must become 11
    expect(readHead(dir)).toBe(11);
    reconcileHead(dir, () => 3); // lower — must not move down
    expect(readHead(dir)).toBe(11);
  });

  it('reconcile keeps a head already above MAX(JSONL)+1 (monotonic up)', () => {
    writeHead(dir, 20);
    reconcileHead(dir, () => 10); // MAX+1 = 11 < 20 → stays 20
    expect(readHead(dir)).toBe(20);
  });

  it('reconcile seeds the head when missing', () => {
    expect(readHead(dir)).toBeUndefined();
    reconcileHead(dir, () => 7); // MAX(JSONL)=7 → head=8
    expect(readHead(dir)).toBe(8);
  });

  it('seedHead writes MAX(JSONL)+1 only when the head is absent', () => {
    seedHead(dir, () => 4);
    expect(readHead(dir)).toBe(5);
    // Present head is not clobbered by seedHead.
    seedHead(dir, () => 99);
    expect(readHead(dir)).toBe(5);
  });

  it('ignores a corrupt head file (non-integer) and reseeds', () => {
    writeFileSync(join(dir, '.seq'), 'not-a-number', { encoding: 'utf8' });
    expect(readHead(dir)).toBeUndefined();
    expect(reserveSeq(dir, () => 10)).toBe(11);
  });

  it('treats an empty head file (torn write truncation) as corrupt → undefined', () => {
    // A torn writeFileSync truncates to 0 bytes first; Number('') === 0 would
    // otherwise read as a VALID 0, defeating the torn-head reseed.
    writeFileSync(join(dir, '.seq'), '', { encoding: 'utf8' });
    expect(readHead(dir)).toBeUndefined();
    // Reseed against JSONL max=10 → first reserved seq is 11, not 0.
    expect(reserveSeq(dir, () => 10)).toBe(11);
  });

  it('treats a whitespace-only head file as corrupt → undefined', () => {
    writeFileSync(join(dir, '.seq'), '   \n', { encoding: 'utf8' });
    expect(readHead(dir)).toBeUndefined();
  });

  it('treats a negative head value as corrupt → undefined', () => {
    writeFileSync(join(dir, '.seq'), '-5', { encoding: 'utf8' });
    expect(readHead(dir)).toBeUndefined();
  });

  it('still parses a valid non-negative integer head', () => {
    writeFileSync(join(dir, '.seq'), '0', { encoding: 'utf8' });
    expect(readHead(dir)).toBe(0);
    writeFileSync(join(dir, '.seq'), '42', { encoding: 'utf8' });
    expect(readHead(dir)).toBe(42);
  });

  it('persists the head file on disk as a single integer string', () => {
    reserveSeq(dir, () => 0);
    expect(existsSync(join(dir, '.seq'))).toBe(true);
    expect(readFileSync(join(dir, '.seq'), 'utf8').trim()).toBe('2');
  });
});
