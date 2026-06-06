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
  pathsOverlap,
  assertResultsBaseDisjoint,
} from '../results-tree';
import { createAgentServerState } from '../../server';

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

describe('results-tree disjointness (sweep must never reach a durable mount)', () => {
  let prevWorkDir: string | undefined;
  let base: string;

  beforeEach(() => {
    prevWorkDir = process.env.LACE_WORK_DIR;
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-disjoint-test-'));
    process.env.LACE_WORK_DIR = path.join(base, 'work');
  });

  afterEach(() => {
    if (prevWorkDir === undefined) delete process.env.LACE_WORK_DIR;
    else process.env.LACE_WORK_DIR = prevWorkDir;
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('pathsOverlap: equal, nested either way, and disjoint', () => {
    expect(pathsOverlap('/a/b', '/a/b')).toBe(true);
    expect(pathsOverlap('/a', '/a/b')).toBe(true);
    expect(pathsOverlap('/a/b', '/a')).toBe(true);
    expect(pathsOverlap('/a/b', '/a/c')).toBe(false);
    expect(pathsOverlap('/a/bc', '/a/b')).toBe(false); // prefix but not a path nest
  });

  it('assertResultsBaseDisjoint passes for disjoint mounts and mkdirs the base', () => {
    const mounts = {
      repo: { hostPath: path.join(base, 'durable', 'repo') },
    };
    expect(() => assertResultsBaseDisjoint(mounts)).not.toThrow();
    expect(fs.existsSync(resultsBase())).toBe(true);
  });

  it('assertResultsBaseDisjoint throws when a mount nests the results base', () => {
    process.env.LACE_WORK_DIR = path.join(base, 'durable', 'work');
    const mounts = {
      durable: { hostPath: path.join(base, 'durable') },
    };
    expect(() => assertResultsBaseDisjoint(mounts)).toThrow(/overlaps container mount 'durable'/);
  });

  it('assertResultsBaseDisjoint throws when the results base nests a mount', () => {
    const mounts = {
      inner: { hostPath: path.join(base, 'work', 'inner') },
    };
    expect(() => assertResultsBaseDisjoint(mounts)).toThrow(/overlaps container mount 'inner'/);
  });

  it('createAgentServerState has empty containerMounts at boot (populated by initialize)', () => {
    const state = createAgentServerState();
    expect(state.containerMounts).toEqual({});
  });
});
