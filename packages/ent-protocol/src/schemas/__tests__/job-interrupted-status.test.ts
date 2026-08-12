// ABOUTME: ent/job/list and ent/job/output responses accept the derived
// ABOUTME: 'interrupted' status (log-running job orphaned by a process restart).
import { describe, it, expect } from 'vitest';
import { EntJobListResponseSchema, EntJobOutputResponseSchema } from '../methods';

describe('interrupted job status in job RPC responses', () => {
  it('ent/job/list accepts a job with status interrupted', () => {
    const response = {
      jsonrpc: '2.0' as const,
      id: 1,
      result: {
        jobs: [
          {
            jobId: 'job_orphan',
            type: 'delegate' as const,
            status: 'interrupted' as const,
            startTime: '2026-08-12T00:00:00.000Z',
          },
        ],
      },
    };
    expect(() => EntJobListResponseSchema.parse(response)).not.toThrow();
  });

  it('ent/job/output accepts status interrupted', () => {
    const response = {
      jsonrpc: '2.0' as const,
      id: 2,
      result: {
        status: 'interrupted' as const,
        output: '',
        outputMeta: {
          totalBytes: 0,
          returnedOffset: 0,
          returnedBytes: 0,
          truncated: false,
        },
        report: {
          summary: 'Job interrupted by an agent restart; outcome unknown',
        },
      },
    };
    expect(() => EntJobOutputResponseSchema.parse(response)).not.toThrow();
  });
});
