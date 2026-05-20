import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JsonRpcPeer } from '@lace/ent-protocol';
import {
  ensureSessionFiles,
  getSessionDir,
  readSessionState,
  writeSessionMeta,
  writeSessionState,
} from '../storage/session-store';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import type { RuntimeExecutionBinding } from '../tools/runtime/types';

const registeredHandlers = vi.hoisted(() => ({
  deps: undefined as
    | {
        startShellJob: (options: {
          command: string;
          runtimeBinding?: RuntimeExecutionBinding;
        }) => Promise<{ jobId: string }>;
      }
    | undefined,
}));

vi.mock('../rpc/register-handlers', () => ({
  registerAllHandlers: vi.fn((_peer, _state, deps) => {
    registeredHandlers.deps = deps;
  }),
}));

vi.mock('../jobs/shell-job', () => ({
  createRunShellJobProcess: vi.fn(() => vi.fn()),
}));

describe('server job runtime binding persistence', () => {
  let originalLaceDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-server-job-runtime-'));
    process.env.LACE_DIR = tempDir;
    registeredHandlers.deps = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists runtimeBinding in server-created job_started events', async () => {
    const sessionId = 'sess_550e8400-e29b-41d4-a716-446655440001';
    const sessionDir = getSessionDir(sessionId);
    writeSessionMeta(sessionDir, {
      sessionId,
      workDir: '/repo',
      created: '2026-05-20T00:00:00.000Z',
    });
    writeSessionState(sessionDir, { nextEventSeq: 1, nextStreamSeq: 1 });
    ensureSessionFiles(sessionDir);

    const state = createAgentServerState();
    state.initialized = true;
    state.activeSession = {
      meta: { sessionId, workDir: '/repo', created: '2026-05-20T00:00:00.000Z' },
      dir: sessionDir,
      state: readSessionState(sessionDir),
    };
    registerAgentRpcMethods({ notify: vi.fn() } as unknown as JsonRpcPeer, state);
    expect(registeredHandlers.deps).toBeDefined();

    const runtimeBinding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'rt_server_job' },
      agentPlacement: 'host',
      toolRuntime: { type: 'local', cwd: '/repo' },
    };

    await registeredHandlers.deps!.startShellJob({
      command: 'true',
      runtimeBinding,
    });

    const events = readFileSync(join(sessionDir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(events[0].data.runtimeBinding).toEqual(runtimeBinding);
  });
});
