// ABOUTME: Tests for the results-tree layout + owner marker (Part 1 of #5)
// ABOUTME: path layout, ..-escape rejection, realpath-confinement, .owner round-trip + liveness

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  resultsBase,
  childWorkspaceDir,
  ownerMarkerPath,
  parseProcStartTime,
  readProcStartTime,
  writeOwnerMarker,
  readOwnerMarker,
  ownerIsAlive,
} from '../results-tree';

describe('results-tree layout', () => {
  let prevWorkDir: string | undefined;
  let base: string;

  beforeEach(() => {
    prevWorkDir = process.env.LACE_WORK_DIR;
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-results-test-'));
    process.env.LACE_WORK_DIR = base;
  });

  afterEach(() => {
    if (prevWorkDir === undefined) delete process.env.LACE_WORK_DIR;
    else process.env.LACE_WORK_DIR = prevWorkDir;
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('resultsBase honours LACE_WORK_DIR', () => {
    expect(resultsBase()).toBe(base);
  });

  it('resultsBase falls back to os.tmpdir()/lace-work when unset', () => {
    delete process.env.LACE_WORK_DIR;
    expect(resultsBase()).toBe(path.join(os.tmpdir(), 'lace-work'));
  });

  it('childWorkspaceDir lays out <base>/<parentId>/<childId>', () => {
    expect(childWorkspaceDir('parent-1', 'child-1')).toBe(path.join(base, 'parent-1', 'child-1'));
  });

  it('ownerMarkerPath lays out <base>/<parentId>/.owner', () => {
    expect(ownerMarkerPath('parent-1')).toBe(path.join(base, 'parent-1', '.owner'));
  });

  it.each([
    ['parent/escape', 'child'],
    ['parent', 'child/escape'],
    ['..', 'child'],
    ['parent', '..'],
    ['a/../b', 'child'],
    ['', 'child'],
    ['parent', ''],
  ])('rejects ids that could escape the base: (%s, %s)', (parentId, childId) => {
    expect(() => childWorkspaceDir(parentId, childId)).toThrow();
  });

  it('ownerMarkerPath rejects escape ids too', () => {
    expect(() => ownerMarkerPath('../escape')).toThrow();
  });

  it('childWorkspaceDir realpath-confines under resultsBase()', () => {
    const dir = childWorkspaceDir('parent-1', 'child-1');
    fs.mkdirSync(dir, { recursive: true });
    const realBase = fs.realpathSync(resultsBase());
    const realDir = fs.realpathSync(dir);
    expect(realDir === realBase || realDir.startsWith(realBase + path.sep)).toBe(true);
  });
});

// An unused pid: max 32-bit, effectively never live on Linux.
const DEAD_PID = 2147483646;

describe('results-tree owner marker', () => {
  let prevWorkDir: string | undefined;
  let base: string;

  beforeEach(() => {
    prevWorkDir = process.env.LACE_WORK_DIR;
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-owner-test-'));
    process.env.LACE_WORK_DIR = base;
  });

  afterEach(() => {
    if (prevWorkDir === undefined) delete process.env.LACE_WORK_DIR;
    else process.env.LACE_WORK_DIR = prevWorkDir;
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('parseProcStartTime returns field 22 even when comm has spaces and )', () => {
    // pid=1234 comm="weird ) name" state=S then ppid onward. Of the tail after
    // ") ", field 22 (starttime) is index 19 (= state at index 0, ppid at 1, …).
    // We write state explicitly, so this array starts at ppid (field 4): field 22
    // is index 18 here. Sentinel 7777 proves the parser skips the parenthesised comm.
    const afterState = Array.from({ length: 50 }, (_, i) => (i === 18 ? '7777' : '0')).join(' ');
    const statLine = `1234 (weird ) name) S ${afterState}`;
    expect(parseProcStartTime(statLine)).toBe('7777');
  });

  it('readProcStartTime reads the live process start time', () => {
    const nonce = readProcStartTime(process.pid);
    expect(nonce).toBeDefined();
    expect(nonce).toMatch(/^\d+$/);
  });

  it('writeOwnerMarker round-trips {pid, startNonce} and is idempotent', () => {
    writeOwnerMarker('parent-1');
    const first = readOwnerMarker('parent-1');
    expect(first).not.toBeNull();
    expect(first!.pid).toBe(process.pid);
    expect(first!.startNonce).toBe(readProcStartTime(process.pid));

    // idempotent: writing again succeeds and keeps the live pid
    writeOwnerMarker('parent-1');
    const second = readOwnerMarker('parent-1');
    expect(second!.pid).toBe(process.pid);
  });

  it('writeOwnerMarker is atomic — no leftover .owner.tmp', () => {
    writeOwnerMarker('parent-1');
    expect(fs.existsSync(path.join(base, 'parent-1', '.owner.tmp'))).toBe(false);
    expect(fs.existsSync(ownerMarkerPath('parent-1'))).toBe(true);
  });

  it('ownerIsAlive: own freshly written marker is alive', () => {
    writeOwnerMarker('parent-1');
    expect(ownerIsAlive(readOwnerMarker('parent-1'))).toBe(true);
  });

  it('ownerIsAlive: a dead pid is dead', () => {
    expect(ownerIsAlive({ pid: DEAD_PID, startNonce: '1' })).toBe(false);
  });

  it('ownerIsAlive: a live pid with the wrong nonce (recycled) is dead', () => {
    expect(ownerIsAlive({ pid: process.pid, startNonce: 'definitely-wrong' })).toBe(false);
  });

  it('ownerIsAlive: a missing/unparseable marker is dead', () => {
    expect(readOwnerMarker('no-such-parent')).toBeNull();
    expect(ownerIsAlive(null)).toBe(false);
    // unparseable file → null → dead
    fs.mkdirSync(path.join(base, 'corrupt'), { recursive: true });
    fs.writeFileSync(ownerMarkerPath('corrupt'), 'not json');
    expect(readOwnerMarker('corrupt')).toBeNull();
  });
});
