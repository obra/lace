// ABOUTME: ent/job/list carries interruptedByLatestRestart out over the wire.
// ABOUTME: The flag exists so a client can tell a job the restart that just
// ABOUTME: happened killed from residue left by every earlier restart; dropping
// ABOUTME: it in the handler would silently restore the old, unreadable list.

import { describe, it, expect, vi } from 'vitest';
import { registerJobHandlers } from '../jobs';
import type { JsonRpcPeer } from '@lace/ent-protocol';
import type { AgentServerState } from '../../../server-types';
import type { JobRecord } from '../../../jobs/job-manager';

const records: JobRecord[] = [
  {
    jobId: 'job_residue',
    type: 'delegate',
    status: 'interrupted',
    startTime: '2026-05-29T00:00:00.000Z',
    interruptedByLatestRestart: false,
  },
  {
    jobId: 'job_fresh',
    type: 'delegate',
    status: 'interrupted',
    startTime: '2026-08-17T00:00:00.000Z',
    interruptedByLatestRestart: true,
  },
  {
    jobId: 'job_done',
    type: 'bash',
    status: 'completed',
    startTime: '2026-08-17T00:01:00.000Z',
  },
];

async function listJobsOverRpc(): Promise<Array<Record<string, unknown>>> {
  const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
  const peer = {
    onRequest: (method: string, handler: (params: unknown) => Promise<unknown>) => {
      handlers.set(method, handler);
    },
  } as unknown as JsonRpcPeer;

  const state = {
    initialized: true,
    activeSession: { sessionId: 'sess_1', dir: '/tmp/sess' },
    jobManager: { listJobs: vi.fn().mockReturnValue(records) },
  } as unknown as AgentServerState;

  registerJobHandlers(peer, state);
  const result = (await handlers.get('ent/job/list')!({})) as {
    jobs: Array<Record<string, unknown>>;
  };
  return result.jobs;
}

describe('ent/job/list interrupted recency', () => {
  it('reports which interrupted jobs the latest restart killed', async () => {
    const byId = new Map((await listJobsOverRpc()).map((j) => [j.jobId as string, j]));

    expect(byId.get('job_fresh')?.interruptedByLatestRestart).toBe(true);
    expect(byId.get('job_residue')?.interruptedByLatestRestart).toBe(false);
  });

  it('omits the flag for jobs that were never interrupted', async () => {
    const byId = new Map((await listJobsOverRpc()).map((j) => [j.jobId as string, j]));

    expect(byId.get('job_done')).not.toHaveProperty('interruptedByLatestRestart');
  });
});
