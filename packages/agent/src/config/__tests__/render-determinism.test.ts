// ABOUTME: Render-determinism guardrails for the system-prompt variable providers.
// ABOUTME: Proves project.tree is byte-stable regardless of fs.readdirSync order
// ABOUTME: and the session date is date-only (stable within a UTC day).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

const mockReaddirSync = vi.fn();
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  };
});

import {
  ProjectVariableProvider,
  SystemVariableProvider,
} from '@lace/agent/config/variable-providers';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

function fakeEntry(name: string, isDir: boolean): fs.Dirent {
  return { name, isDirectory: () => isDir, isFile: () => !isDir } as unknown as fs.Dirent;
}

describe('render determinism: project tree is insensitive to readdir order', () => {
  it('produces byte-identical tree regardless of fs.readdirSync ordering', () => {
    const entries = [
      fakeEntry('zebra.ts', false),
      fakeEntry('alpha', true),
      fakeEntry('mango.ts', false),
    ];

    const render = (order: fs.Dirent[]): string => {
      // Top-level dir returns `order`; any nested dir returns empty so depth
      // recursion terminates without touching the real filesystem.
      let firstCall = true;
      mockReaddirSync.mockImplementation(() => {
        if (firstCall) {
          firstCall = false;
          return order;
        }
        return [];
      });
      // No session/project → provider resolves cwd from process.cwd(), held
      // constant across both renders, so only readdir order varies.
      const provider = new ProjectVariableProvider();
      const vars = provider.getVariables() as { project: { tree: string } };
      return vars.project.tree;
    };

    const forward = render(entries);
    const reversed = render([...entries].reverse());
    expect(forward).toBe(reversed);
  });
});

describe('render determinism: system date is date-only (stable within a UTC day)', () => {
  it('same UTC day, different wall-clock → identical sessionDate', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-18T01:00:00Z'));
    const morning = new SystemVariableProvider().getVariables() as {
      system: { sessionDate: string };
    };
    vi.setSystemTime(new Date('2026-06-18T23:00:00Z'));
    const night = new SystemVariableProvider().getVariables() as {
      system: { sessionDate: string };
    };
    expect(morning.system.sessionDate).toBe(night.system.sessionDate);
    expect(morning.system.sessionDate).toBe('2026-06-18');
  });
});
