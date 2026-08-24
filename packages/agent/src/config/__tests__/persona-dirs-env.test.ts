// ABOUTME: PRI-2943 — an embedder must be able to declare where user personas live
// ABOUTME: instead of having the location inferred from LACE_DIR.

import { describe, it, expect, afterEach } from 'vitest';
import { userPersonaPaths } from '../persona-registry';

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

// lace infers user personas at `$LACE_DIR/agent-personas`. sen-core keeps them
// under `<instance>/user/agent-personas` — user-authored, git-managed content —
// and points LACE_DIR at `<instance>/state/lace`, which is runtime state. The
// two only ever met through a symlink that one host happened to carry from an
// older layout, and when a host lacked it lace silently saw no persona at all.
// An embedder needs to be able to say where its personas are.

describe('userPersonaPaths (PRI-2943)', () => {
  it('falls back to the LACE_DIR convention when nothing is declared', () => {
    process.env.LACE_DIR = '/srv/lace';
    delete process.env.LACE_USER_PERSONA_DIRS;
    expect(userPersonaPaths()).toEqual(['/srv/lace/agent-personas']);
  });

  it('uses a declared directory', () => {
    process.env.LACE_DIR = '/inst/state/lace';
    process.env.LACE_USER_PERSONA_DIRS = '/inst/user/agent-personas';
    expect(userPersonaPaths()[0]).toBe('/inst/user/agent-personas');
  });

  it('keeps the LACE_DIR convention as a lower-precedence fallback', () => {
    process.env.LACE_DIR = '/inst/state/lace';
    process.env.LACE_USER_PERSONA_DIRS = '/inst/user/agent-personas';
    expect(userPersonaPaths()).toContain('/inst/state/lace/agent-personas');
    expect(userPersonaPaths().indexOf('/inst/user/agent-personas')).toBeLessThan(
      userPersonaPaths().indexOf('/inst/state/lace/agent-personas')
    );
  });

  it('accepts several directories, earlier winning', () => {
    process.env.LACE_DIR = '/srv/lace';
    process.env.LACE_USER_PERSONA_DIRS = '/a/personas:/b/personas';
    const paths = userPersonaPaths();
    expect(paths.slice(0, 2)).toEqual(['/a/personas', '/b/personas']);
  });

  it('ignores empty segments rather than resolving them to cwd', () => {
    process.env.LACE_DIR = '/srv/lace';
    process.env.LACE_USER_PERSONA_DIRS = '/a/personas::  :';
    expect(userPersonaPaths()).toEqual(['/a/personas', '/srv/lace/agent-personas']);
  });
});
