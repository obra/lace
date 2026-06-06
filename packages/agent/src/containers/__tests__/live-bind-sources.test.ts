// ABOUTME: ContainerManager.liveBindSources — the workspace sweep's live-container set (#5 Part 4)
// ABOUTME: collects bind sources of RUNNING containers only; daemonInspects when list omits mounts

import { describe, it, expect, vi } from 'vitest';
import { ContainerManager } from '../container-manager';
import type { ContainerRuntime, ContainerInfo } from '../types';

function manager(over: Partial<ContainerRuntime>): ContainerManager {
  return new ContainerManager(over as unknown as ContainerRuntime);
}

describe('ContainerManager.liveBindSources', () => {
  it('collects bind sources of running containers, skipping non-running ones', async () => {
    const list = vi.fn(
      async (): Promise<ContainerInfo[]> => [
        { id: 'lace-a', state: 'running', mounts: [{ source: '/work/a', target: '/work' }] },
        { id: 'lace-b', state: 'stopped', mounts: [{ source: '/work/b', target: '/work' }] },
      ]
    );
    const cm = manager({ list });
    const sources = await cm.liveBindSources();
    expect([...sources]).toEqual(['/work/a']);
  });

  it('daemon-inspects a running container when list() omits mounts (post-crash)', async () => {
    const list = vi.fn(async (): Promise<ContainerInfo[]> => [{ id: 'lace-a', state: 'running' }]);
    const daemonInspect = vi.fn(
      async (id: string): Promise<ContainerInfo | null> => ({
        id,
        state: 'running',
        mounts: [
          { source: '/work/p/c', target: '/work' },
          { source: '/work/c', target: '/work/c', readonly: true },
        ],
      })
    );
    const cm = manager({ list, daemonInspect });
    const sources = await cm.liveBindSources();
    expect([...sources].sort()).toEqual(['/work/c', '/work/p/c']);
    expect(daemonInspect).toHaveBeenCalledWith('lace-a');
  });

  it('propagates a list() failure so the sweep skips the pass (never reaps on a stale set)', async () => {
    const list = vi.fn(async (): Promise<ContainerInfo[]> => {
      throw new Error('docker down');
    });
    const cm = manager({ list });
    await expect(cm.liveBindSources()).rejects.toThrow('docker down');
  });
});
