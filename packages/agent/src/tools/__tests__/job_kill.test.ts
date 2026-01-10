// ABOUTME: Tests for job_kill tool schema validation

import { describe, expect, it } from 'vitest';
import { JobKillTool } from '../implementations/job_kill';

describe('JobKillTool', () => {
  it('has correct name', () => {
    const tool = new JobKillTool();
    expect(tool.name).toBe('job_kill');
  });

  it('requires jobId', () => {
    const tool = new JobKillTool();
    const result = tool.schema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts jobId', () => {
    const tool = new JobKillTool();
    const result = tool.schema.safeParse({ jobId: 'job_abc123' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jobId).toBe('job_abc123');
    }
  });
});
