// ABOUTME: Tests ShimContainerRuntime — create() emits the closed `spawn` verb, start() is a no-op, jobId is synthesized when absent.
// ABOUTME: Uses a fake shim binary (tmp script that records argv + prints a name) so no real shim/docker is needed.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShimContainerRuntime } from './shim-container-runtime';
import type { ContainerConfig } from './types';

describe('ShimContainerRuntime', () => {
  let dir: string;
  let shimBin: string;
  let argsFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shim-rt-'));
    argsFile = join(dir, 'args.txt');
    shimBin = join(dir, 'fake-shim');
    // Records its argv to argsFile, prints a fixed container name on stdout.
    writeFileSync(shimBin, `#!/bin/sh\necho "$@" >> "${argsFile}"\necho lace-test-box\n`);
    chmodSync(shimBin, 0o755);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const cfg = (extra: Partial<ContainerConfig>): ContainerConfig => ({
    image: 'img',
    workingDirectory: '/work',
    mounts: [],
    ...extra,
  });

  it('create() emits the closed spawn verb + returns the shim-printed name', async () => {
    const rt = new ShimContainerRuntime(shimBin);
    const name = await rt.create(
      cfg({
        persona: 'ephemeral-shell',
        parentSession: 'sess_p',
        childSession: 'sess_c',
        jobId: 'job_x',
      })
    );
    expect(name).toBe('lace-test-box');
    expect(readFileSync(argsFile, 'utf8').trim()).toBe('spawn ephemeral-shell sess_p sess_c job_x');
  });

  it('synthesizes a deterministic jobId from the child session when absent', async () => {
    const rt = new ShimContainerRuntime(shimBin);
    await rt.create(
      cfg({ persona: 'ephemeral-shell', parentSession: 'sess_p', childSession: 'sess_abc' })
    );
    expect(readFileSync(argsFile, 'utf8').trim()).toBe(
      'spawn ephemeral-shell sess_p sess_abc job_abc'
    );
  });

  it('rejects create() without a persona selector', async () => {
    const rt = new ShimContainerRuntime(shimBin);
    await expect(rt.create(cfg({ parentSession: 'sess_p' }))).rejects.toThrow(/persona/);
  });

  it('start() is a no-op — it does not invoke the shim again', async () => {
    const rt = new ShimContainerRuntime(shimBin);
    const name = await rt.create(
      cfg({
        persona: 'ephemeral-shell',
        parentSession: 'sess_p',
        childSession: 'sess_c',
        jobId: 'job_x',
      })
    );
    const before = readFileSync(argsFile, 'utf8');
    await rt.start(name);
    expect(readFileSync(argsFile, 'utf8')).toBe(before);
  });

  it('surfaces a shim spawn failure as a ContainerError', async () => {
    const failBin = join(dir, 'fail-shim');
    writeFileSync(failBin, `#!/bin/sh\necho "error: denied" >&2\nexit 125\n`);
    chmodSync(failBin, 0o755);
    const rt = new ShimContainerRuntime(failBin);
    await expect(
      rt.create(
        cfg({
          persona: 'ephemeral-shell',
          parentSession: 'sess_p',
          childSession: 'sess_c',
          jobId: 'job_x',
        })
      )
    ).rejects.toThrow(/shim spawn failed/);
  });
});
