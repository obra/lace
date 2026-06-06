// ABOUTME: Mount-scoping isolation for per_invocation child workspaces (#5 Part 2)
// ABOUTME: a child container mounts ONLY its own <base>/<parentId>/<childId> at /work — never the base or a sibling

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildPersonaContainerSpec,
  type PersonaContainerRuntime,
} from '@lace/agent/jobs/persona-container-spec';
import { childWorkspaceDir, childrenBaseDir, resultsBase } from '../results-tree';

const perInvocationRuntime: PersonaContainerRuntime = {
  type: 'container',
  containerSharing: 'per_invocation',
  image: 'devcontainer:latest',
  workingDirectory: '/workspace',
  mounts: [],
};

describe('per_invocation child workspace mount-scoping', () => {
  let prevWorkDir: string | undefined;
  let base: string;

  beforeEach(() => {
    prevWorkDir = process.env.LACE_WORK_DIR;
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-scoping-test-'));
    process.env.LACE_WORK_DIR = base;
  });

  afterEach(() => {
    if (prevWorkDir === undefined) delete process.env.LACE_WORK_DIR;
    else process.env.LACE_WORK_DIR = prevWorkDir;
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("mounts only the child's own subdir at /work — not the base or a sibling", () => {
    const parentId = 'sess_pppppppp00000000';
    const childA = 'sess_aaaaaaaa00000000';
    const childB = 'sess_bbbbbbbb00000000';

    const aDir = childWorkspaceDir(parentId, childA);
    const bDir = childWorkspaceDir(parentId, childB);
    const parentBase = childrenBaseDir(parentId); // <base>/<parentId>

    // Build child A's resolved container spec exactly as delegate would: /work =
    // A's own workspace dir, and nothing else from the shared results tree.
    const specA = buildPersonaContainerSpec({
      parentSessionId: parentId,
      personaName: 'shell',
      childSessionId: childA,
      scratchDirHostPath: aDir,
      runtime: perInvocationRuntime,
      containerMounts: {},
    });

    // The spec→docker mount chain is 1:1, so this spec assertion is the boundary.
    const workMounts = specA.mounts.filter((m) => m.target === '/work');
    expect(workMounts).toHaveLength(1);
    expect(workMounts[0]!.source).toBe(aDir);
    expect(workMounts[0]!.readonly).toBe(false);

    // /work is the only mount — no read-base, no sibling, no shared parent base.
    expect(specA.mounts).toHaveLength(1);

    // No mount points at a sibling's workspace or at the shared PARENT base
    // (which would expose A's siblings). A only ever sees its own subtree.
    const sources = specA.mounts.map((m) => m.source);
    expect(sources).not.toContain(bDir);
    expect(sources).not.toContain(parentBase);
    expect(sources).not.toContain(resultsBase());
  });
});
