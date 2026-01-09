// ABOUTME: Tests for job_output tool schema validation

import { describe, expect, it } from 'vitest';
import { JobOutputTool } from '../implementations/job_output';

describe('JobOutputTool', () => {
  it('has correct name and schema', () => {
    const tool = new JobOutputTool();

    expect(tool.name).toBe('job_output');

    const result = tool.schema.safeParse({
      jobId: 'job_abc123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts block parameter', () => {
    const tool = new JobOutputTool();

    const result = tool.schema.safeParse({
      jobId: 'job_abc123',
      block: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.block).toBe(false);
    }
  });

  it('defaults block to true', () => {
    const tool = new JobOutputTool();

    const result = tool.schema.safeParse({
      jobId: 'job_abc123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.block).toBe(true);
    }
  });

  it('accepts timeoutMs and cursor parameters', () => {
    const tool = new JobOutputTool();

    const result = tool.schema.safeParse({
      jobId: 'job_abc123',
      timeoutMs: 5000,
      cursor: 100,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeoutMs).toBe(5000);
      expect(result.data.cursor).toBe(100);
    }
  });
});
