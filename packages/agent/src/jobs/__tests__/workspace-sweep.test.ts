// ABOUTME: Crash-sweep tests (#5 Part 4) — owner-pid + container-liveness gated reclamation
// ABOUTME: live-owner retained; dead-owner reaped; live-container skipped; confined to resultsBase

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sweepPass } from '../workspace-sweep';
import {
  childWorkspaceDir,
  childrenBaseDir,
  ownerMarkerPath,
  writeOwnerMarker,
} from '../results-tree';

const DEAD_PID = 2147483646;

function writeDeadOwner(parentId: string): void {
  fs.mkdirSync(childrenBaseDir(parentId), { recursive: true });
  fs.writeFileSync(ownerMarkerPath(parentId), JSON.stringify({ pid: DEAD_PID, startNonce: '1' }));
}

function makeChild(parentId: string, childId: string): string {
  const dir = childWorkspaceDir(parentId, childId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'out.txt'), 'result');
  return dir;
}

describe('sweepPass', () => {
  let prevWorkDir: string | undefined;
  let base: string;

  beforeEach(() => {
    prevWorkDir = process.env.LACE_WORK_DIR;
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-sweep-test-'));
    process.env.LACE_WORK_DIR = base;
  });

  afterEach(() => {
    if (prevWorkDir === undefined) delete process.env.LACE_WORK_DIR;
    else process.env.LACE_WORK_DIR = prevWorkDir;
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('retains a live-owner subtree (this process owns it)', () => {
    writeOwnerMarker('p_live'); // our own pid → alive
    const child = makeChild('p_live', 'c1');
    sweepPass(new Set());
    expect(fs.existsSync(child)).toBe(true);
    expect(fs.existsSync(ownerMarkerPath('p_live'))).toBe(true);
  });

  it('reaps a dead-owner subtree with no live container', () => {
    writeDeadOwner('p_dead');
    const child = makeChild('p_dead', 'c1');
    sweepPass(new Set());
    expect(fs.existsSync(child)).toBe(false);
    expect(fs.existsSync(childrenBaseDir('p_dead'))).toBe(false);
  });

  it('reaps a missing/recycled-owner subtree (no .owner) when no live container', () => {
    // No .owner written at all → treated as dead.
    const child = makeChild('p_nomarker', 'c1');
    sweepPass(new Set());
    expect(fs.existsSync(child)).toBe(false);
  });

  it('skips a dead-owner child whose /work is a live container bind source', () => {
    writeDeadOwner('p_dead');
    const live = makeChild('p_dead', 'c_live');
    const gone = makeChild('p_dead', 'c_gone');
    sweepPass(new Set([live]));
    expect(fs.existsSync(live)).toBe(true); // live container holds it → skip+log
    expect(fs.existsSync(gone)).toBe(false); // no live container → reaped
    // The parent dir + .owner stay because a live child remains.
    expect(fs.existsSync(ownerMarkerPath('p_dead'))).toBe(true);
  });

  it("skips a markerless base that is itself a live container's bind source (create-gap)", () => {
    // <base>/<childId> created at spawn for the RO read mount, before the child
    // first delegates → markerless. A live container holds it → must not reap.
    const ownBase = childrenBaseDir('c_spawned');
    fs.mkdirSync(ownBase, { recursive: true });
    sweepPass(new Set([ownBase]));
    expect(fs.existsSync(ownBase)).toBe(true);
  });

  it('never descends outside resultsBase (durable mounts are out of scope)', () => {
    const durable = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-durable-'));
    fs.writeFileSync(path.join(durable, 'keep.txt'), 'persist');
    writeDeadOwner('p_dead');
    makeChild('p_dead', 'c1');
    sweepPass(new Set());
    expect(fs.existsSync(path.join(durable, 'keep.txt'))).toBe(true);
    fs.rmSync(durable, { recursive: true, force: true });
  });

  it('one bad subtree does not abort the rest', () => {
    // A subtree we cannot read (chmod 000) sits beside a normal dead-owner one.
    const bad = childrenBaseDir('p_bad');
    fs.mkdirSync(bad, { recursive: true });
    fs.mkdirSync(path.join(bad, 'c'), { recursive: true });
    fs.chmodSync(bad, 0o000);

    writeDeadOwner('p_ok');
    const okChild = makeChild('p_ok', 'c1');

    try {
      expect(() => sweepPass(new Set())).not.toThrow();
      expect(fs.existsSync(okChild)).toBe(false); // the healthy subtree still reaped
    } finally {
      fs.chmodSync(bad, 0o700);
    }
  });
});
