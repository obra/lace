// ABOUTME: Unit tests for native subagent process environment wiring

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

function createFakeChildProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    exitCode: number | null;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.exitCode = null;
  proc.kill = vi.fn();
  return proc;
}

describe('spawnSubagent native process env', () => {
  it('passes execution env to native subagent processes', async () => {
    spawnMock.mockReturnValueOnce(createFakeChildProcess());

    const { spawnSubagent } = await import('@lace/agent/jobs/subagent-spawn');
    const originalEnv = process.env.SEN_AGENT_TOKEN;
    delete process.env.SEN_AGENT_TOKEN;

    try {
      await spawnSubagent({
        parentSessionId: 'sess1',
        personaName: 'box-shell',
        containerManager: null,
        containerMounts: {},
        executionEnv: { SEN_AGENT_TOKEN: 'token' },
      });
    } finally {
      if (originalEnv === undefined) {
        delete process.env.SEN_AGENT_TOKEN;
      } else {
        process.env.SEN_AGENT_TOKEN = originalEnv;
      }
    }

    expect(spawnMock).toHaveBeenCalledOnce();
    expect(spawnMock.mock.calls[0][2]).toMatchObject({
      env: expect.objectContaining({ SEN_AGENT_TOKEN: 'token' }),
    });
  });
});
