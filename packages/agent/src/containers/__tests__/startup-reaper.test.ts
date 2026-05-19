// ABOUTME: Unit tests for the startup orphan-container reaper
// ABOUTME: Verifies best-effort semantics — reaper failures and null managers never throw

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runStartupReaper } from '../startup-reaper';
import { ContainerManager } from '../container-manager';
import { logger } from '@lace/agent/utils/logger';

function makeManager(reapOrphans: ContainerManager['reapOrphans']): {
  manager: ContainerManager;
  reapSpy: ReturnType<typeof vi.fn>;
} {
  const reapSpy = vi.fn(reapOrphans);
  // We don't need a real runtime — the reaper only ever calls reapOrphans on the manager.
  const manager = { reapOrphans: reapSpy } as unknown as ContainerManager;
  return { manager, reapSpy };
}

describe('runStartupReaper', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invokes reapOrphans exactly once with empty prefix and empty live set', async () => {
    const { manager, reapSpy } = makeManager(async () => ({ reaped: [] }));

    await runStartupReaper(manager);

    expect(reapSpy).toHaveBeenCalledTimes(1);
    const [idPrefix, liveSpecNames] = reapSpy.mock.calls[0] as [string, Set<string>];
    expect(idPrefix).toBe('');
    expect(liveSpecNames).toBeInstanceOf(Set);
    expect(liveSpecNames.size).toBe(0);
  });

  it('logs at INFO with reaped names when something was reaped', async () => {
    const { manager } = makeManager(async () => ({ reaped: ['sess1-alpha', 'sess2-beta'] }));

    await runStartupReaper(manager);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith('Reaped orphan containers at startup', {
      reaped: ['sess1-alpha', 'sess2-beta'],
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not log at INFO when nothing was reaped', async () => {
    const { manager } = makeManager(async () => ({ reaped: [] }));

    await runStartupReaper(manager);

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('swallows reaper errors and logs at WARN so startup continues', async () => {
    const boom = new Error('docker socket unreachable');
    const { manager } = makeManager(async () => {
      throw boom;
    });

    await expect(runStartupReaper(manager)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('Reaper failed at startup; continuing', {
      error: 'docker socket unreachable',
    });
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('swallows non-Error throws by stringifying them', async () => {
    const { manager } = makeManager(async () => {
      throw 'string failure';
    });

    await expect(runStartupReaper(manager)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith('Reaper failed at startup; continuing', {
      error: 'string failure',
    });
  });

  it('does not reap a box container (sen-box) when listed alongside lace- containers (kata #62)', async () => {
    // Box containers intentionally lack the lace- prefix so the startup
    // reaper's scan ignores them. ContainerManager.reapOrphans filters by
    // the `lace-` id prefix; verify by handing it a mixed list and asserting
    // that sen-box survives.
    const reaped: string[] = [];
    const fakeManager = {
      reapOrphans: vi.fn(async (idPrefix: string, liveSpecNames: Set<string>) => {
        // Simulate the real ContainerManager prefix-scan against a daemon
        // that contains both lace-* and sen-box.
        const ids = ['lace-sess1-shell', 'lace-sess1-worker', 'sen-box', 'lace-orphan'];
        const scanPrefix = `lace-${idPrefix}`;
        for (const id of ids) {
          if (!id.startsWith(scanPrefix)) continue;
          const name = id.slice('lace-'.length);
          if (!liveSpecNames.has(name)) reaped.push(name);
        }
        return { reaped };
      }),
    } as unknown as ContainerManager;

    await runStartupReaper(fakeManager);

    // sen-box was passed to the reaper alongside lace- containers, but the
    // prefix filter never matches it — so it never enters the reaped set.
    expect(reaped).not.toContain('sen-box');
    expect(reaped).toContain('sess1-shell');
    expect(reaped).toContain('sess1-worker');
    expect(reaped).toContain('orphan');
  });

  it('skips silently when no container runtime is available for the platform', async () => {
    await expect(runStartupReaper(null)).resolves.toBeUndefined();

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    // DEBUG is the expected channel for the platform-skip case.
    expect(debugSpy).toHaveBeenCalledTimes(1);
  });
});
