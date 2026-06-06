// ABOUTME: Tests for WorkspaceReaper + safeRemoveWorkspace (Part 1 of #5)
// ABOUTME: dispose routes teardown to the shim via releasePerInvocation; per-entry resilience

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ContainerManager } from '@lace/agent/containers/container-manager';
import { WorkspaceReaper, safeRemoveWorkspace } from '../workspace-reaper';

function makeFakes() {
  const calls: Array<[string, string, string | undefined]> = [];
  const releasePerInvocation = vi.fn(
    async (parentId: string, childId: string, specName?: string) => {
      calls.push([parentId, childId, specName]);
    }
  );
  const containerManager = { releasePerInvocation } as unknown as ContainerManager;
  return { calls, releasePerInvocation, containerManager };
}

describe('WorkspaceReaper', () => {
  let prevWorkDir: string | undefined;
  let base: string;

  beforeEach(() => {
    prevWorkDir = process.env.LACE_WORK_DIR;
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-reaper-test-'));
    process.env.LACE_WORK_DIR = base;
  });

  afterEach(() => {
    if (prevWorkDir === undefined) delete process.env.LACE_WORK_DIR;
    else process.env.LACE_WORK_DIR = prevWorkDir;
    fs.rmSync(base, { recursive: true, force: true });
  });

  function makeWorkspace(parentId: string, childId: string): string {
    const dir = path.join(base, parentId, childId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'result.txt'), 'output');
    return dir;
  }

  it('dispose forgets the entry (the shim owns container + /work teardown)', async () => {
    const { containerManager } = makeFakes();
    const reaper = new WorkspaceReaper();
    reaper.bindRuntime(containerManager);
    const dir = makeWorkspace('p1', 'c1');
    reaper.track({ childId: 'c1', parentId: 'p1', path: dir, containerSpecName: 'spec-c1' });

    await reaper.dispose('c1');
    expect(reaper.list()).toEqual([]);
    expect(reaper.isReleased('c1')).toBe(true);
  });

  it('dispose routes teardown to the shim via releasePerInvocation; does NOT rm the dir', async () => {
    const { calls, containerManager } = makeFakes();
    const reaper = new WorkspaceReaper();
    reaper.bindRuntime(containerManager);
    const dir = makeWorkspace('p1', 'c1');
    reaper.track({ childId: 'c1', parentId: 'p1', path: dir, containerSpecName: 'spec-c1' });

    await reaper.dispose('c1');

    expect(calls).toEqual([['p1', 'c1', 'spec-c1']]);
    // lace no longer removes the workspace — the shim's release does.
    expect(fs.existsSync(dir)).toBe(true);
    expect(reaper.list()).toEqual([]);
  });

  it('dispose of an unknown id is a no-op (no release, no throw)', async () => {
    const { calls, releasePerInvocation, containerManager } = makeFakes();
    const reaper = new WorkspaceReaper();
    reaper.bindRuntime(containerManager);
    await expect(reaper.dispose('nope')).resolves.toBeUndefined();
    expect(releasePerInvocation).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('releaseAllForParent disposes only that parent and survives a release rejection', async () => {
    const releasePerInvocation = vi.fn(async (_parentId: string, childId: string) => {
      if (childId === 'bad') throw new Error('boom');
    });
    const containerManager = { releasePerInvocation } as unknown as ContainerManager;
    const reaper = new WorkspaceReaper();
    reaper.bindRuntime(containerManager);

    const bad = makeWorkspace('p1', 'bad');
    const good = makeWorkspace('p1', 'good');
    const other = makeWorkspace('p2', 'x');
    reaper.track({ childId: 'bad', parentId: 'p1', path: bad, containerSpecName: 'spec-bad' });
    reaper.track({ childId: 'good', parentId: 'p1', path: good, containerSpecName: 'spec-good' });
    reaper.track({ childId: 'x', parentId: 'p2', path: other, containerSpecName: 'spec-x' });

    await reaper.releaseAllForParent('p1');

    // good released (forgotten); bad retained (release rejected); p2 untouched.
    expect(releasePerInvocation).toHaveBeenCalledWith('p1', 'good', 'spec-good');
    expect(
      reaper
        .list()
        .map((e) => e.childId)
        .sort()
    ).toEqual(['bad', 'x']);
  });

  it('releaseAllTracked disposes everything and survives a release rejection', async () => {
    const releasePerInvocation = vi.fn(async (_parentId: string, childId: string) => {
      if (childId === 'bad') throw new Error('boom');
    });
    const containerManager = { releasePerInvocation } as unknown as ContainerManager;
    const reaper = new WorkspaceReaper();
    reaper.bindRuntime(containerManager);

    const bad = makeWorkspace('p1', 'bad');
    const good = makeWorkspace('p2', 'good');
    reaper.track({ childId: 'bad', parentId: 'p1', path: bad, containerSpecName: 'spec-bad' });
    reaper.track({ childId: 'good', parentId: 'p2', path: good, containerSpecName: 'spec-good' });

    await reaper.releaseAllTracked();

    expect(reaper.list().map((e) => e.childId)).toEqual(['bad']);
  });

  it('dispose tolerates a missing containerSpecName (passes undefined to the shim)', async () => {
    const { calls, containerManager } = makeFakes();
    const reaper = new WorkspaceReaper();
    reaper.bindRuntime(containerManager);
    const dir = makeWorkspace('p1', 'c1');
    reaper.track({ childId: 'c1', parentId: 'p1', path: dir });

    await reaper.dispose('c1');
    expect(calls).toEqual([['p1', 'c1', undefined]]);
    expect(reaper.list()).toEqual([]);
  });

  it('get returns the tracked entry (for ownership checks) or undefined', () => {
    const { containerManager } = makeFakes();
    const reaper = new WorkspaceReaper();
    reaper.bindRuntime(containerManager);
    const dir = makeWorkspace('p1', 'c1');
    reaper.track({ childId: 'c1', parentId: 'p1', path: dir, containerSpecName: 'spec-c1' });

    expect(reaper.get('c1')).toEqual({ parentId: 'p1', path: dir, containerSpecName: 'spec-c1' });
    expect(reaper.get('nope')).toBeUndefined();
  });

  it('countForParent counts only that parent', () => {
    const reaper = new WorkspaceReaper();
    reaper.track({ childId: 'a', parentId: 'p1', path: '/x/a' });
    reaper.track({ childId: 'b', parentId: 'p1', path: '/x/b' });
    reaper.track({ childId: 'c', parentId: 'p2', path: '/x/c' });
    expect(reaper.countForParent('p1')).toBe(2);
    expect(reaper.countForParent('p2')).toBe(1);
    expect(reaper.countForParent('p3')).toBe(0);
  });

  it('runExclusive serializes overlapping critical sections for the same childId', async () => {
    const reaper = new WorkspaceReaper();
    const order: string[] = [];
    const slow = reaper.runExclusive('c1', async () => {
      order.push('A:start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('A:end');
    });
    const fast = reaper.runExclusive('c1', async () => {
      order.push('B:start');
      order.push('B:end');
    });
    await Promise.all([slow, fast]);
    // B must not start until A finished — same childId is serialized.
    expect(order).toEqual(['A:start', 'A:end', 'B:start', 'B:end']);
  });

  it('runExclusive does not block different childIds', async () => {
    const reaper = new WorkspaceReaper();
    const order: string[] = [];
    const a = reaper.runExclusive('c1', async () => {
      order.push('A:start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('A:end');
    });
    const b = reaper.runExclusive('c2', async () => {
      order.push('B:start');
      order.push('B:end');
    });
    await Promise.all([a, b]);
    // Different childIds run concurrently — B finishes before A.
    expect(order.indexOf('B:end')).toBeLessThan(order.indexOf('A:end'));
  });

  it('runExclusive releases the lock even if the critical section throws', async () => {
    const reaper = new WorkspaceReaper();
    await expect(
      reaper.runExclusive('c1', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    // The lock is freed: a subsequent call for the same childId still runs.
    await expect(reaper.runExclusive('c1', async () => 'ok')).resolves.toBe('ok');
  });
});

describe('safeRemoveWorkspace', () => {
  let prevWorkDir: string | undefined;
  let base: string;

  beforeEach(() => {
    prevWorkDir = process.env.LACE_WORK_DIR;
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-remove-test-'));
    process.env.LACE_WORK_DIR = base;
  });

  afterEach(() => {
    if (prevWorkDir === undefined) delete process.env.LACE_WORK_DIR;
    else process.env.LACE_WORK_DIR = prevWorkDir;
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('removes a normal workspace subtree', () => {
    const child = path.join(base, 'p1', 'c1');
    fs.mkdirSync(path.join(child, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(child, 'a.txt'), 'x');
    fs.writeFileSync(path.join(child, 'sub', 'b.txt'), 'y');

    safeRemoveWorkspace(child, base);
    expect(fs.existsSync(child)).toBe(false);
  });

  it('unlinks a child-planted symlink without following it to its target', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-outside-'));
    const outsideFile = path.join(outside, 'precious.txt');
    fs.writeFileSync(outsideFile, 'do not delete');

    const child = path.join(base, 'p1', 'c1');
    fs.mkdirSync(child, { recursive: true });
    fs.symlinkSync(outside, path.join(child, 'escape'));

    safeRemoveWorkspace(child, base);

    expect(fs.existsSync(child)).toBe(false);
    expect(fs.existsSync(outsideFile)).toBe(true);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('unlinks a symlinked top dir without recursing into its target', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-outside-'));
    fs.writeFileSync(path.join(outside, 'precious.txt'), 'keep');
    const parent = path.join(base, 'p1');
    fs.mkdirSync(parent, { recursive: true });
    const linkTop = path.join(parent, 'linktop');
    fs.symlinkSync(outside, linkTop);

    safeRemoveWorkspace(linkTop, base);

    expect(fs.existsSync(linkTop)).toBe(false);
    expect(fs.existsSync(path.join(outside, 'precious.txt'))).toBe(true);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('throws when a real top dir escapes the results base', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-outside-'));
    expect(() => safeRemoveWorkspace(outside, base)).toThrow(/outside results base/);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('skips an un-removable entry and removes the rest; leaves non-empty top without throwing', () => {
    const child = path.join(base, 'p1', 'c1');
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(child, 'removable.txt'), 'x');
    const locked = path.join(child, 'locked');
    fs.mkdirSync(locked);
    fs.writeFileSync(path.join(locked, 'f.txt'), 'y');
    fs.chmodSync(locked, 0o000); // readdir(locked) → EACCES → skip

    try {
      expect(() => safeRemoveWorkspace(child, base)).not.toThrow();
      // removable file gone; locked subtree retained; top left for next pass
      expect(fs.existsSync(path.join(child, 'removable.txt'))).toBe(false);
      expect(fs.existsSync(locked)).toBe(true);
      expect(fs.existsSync(child)).toBe(true);
    } finally {
      fs.chmodSync(locked, 0o700);
    }
  });
});
