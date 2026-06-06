// ABOUTME: Tests for the results-tree layout (Part 1 of #5)
// ABOUTME: path layout, ..-escape rejection, realpath-confinement

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resultsBase, childWorkspaceDir } from '../results-tree';
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

  it('childWorkspaceDir realpath-confines under resultsBase()', () => {
    const dir = childWorkspaceDir('parent-1', 'child-1');
    fs.mkdirSync(dir, { recursive: true });
    const realBase = fs.realpathSync(resultsBase());
    const realDir = fs.realpathSync(dir);
    expect(realDir === realBase || realDir.startsWith(realBase + path.sep)).toBe(true);
  });

  it('createAgentServerState has empty containerMounts at boot (populated by initialize)', () => {
    const state = createAgentServerState();
    expect(state.containerMounts).toEqual({});
  });
});
