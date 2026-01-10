// ABOUTME: Tests for special tool handlers

import { describe, it, expect } from 'vitest';
import { isSpecialTool, executeSpecialTool } from '../index';
import type { SpecialToolContext } from '../types';

describe('isSpecialTool', () => {
  it('returns true for delegate', () => {
    expect(isSpecialTool('delegate')).toBe(true);
  });

  it('returns true for job_output', () => {
    expect(isSpecialTool('job_output')).toBe(true);
  });

  it('returns true for jobs_list', () => {
    expect(isSpecialTool('jobs_list')).toBe(true);
  });

  it('returns true for job_kill', () => {
    expect(isSpecialTool('job_kill')).toBe(true);
  });

  it('returns false for regular tools', () => {
    expect(isSpecialTool('read')).toBe(false);
    expect(isSpecialTool('write')).toBe(false);
    expect(isSpecialTool('bash')).toBe(false);
  });
});

describe('executeSpecialTool', () => {
  const mockContext: SpecialToolContext = {
    sessionDir: '/tmp/test-session',
    turnId: 'turn_123',
    turnSeq: 1,
    abortSignal: new AbortController().signal,
    getJobs: () => new Map(),
    deriveJobs: () => [],
    startShellJob: async () => ({ jobId: 'job_123' }),
    startSubagentJob: async () => ({ jobId: 'job_456' }),
    finalizeJob: async () => {},
  };

  it('returns error for unknown special tool', async () => {
    const result = await executeSpecialTool('unknown_tool', {}, mockContext);
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('Unknown special tool');
  });

  it('returns error when delegate.prompt is missing', async () => {
    const result = await executeSpecialTool('delegate', {}, mockContext);
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toBe('delegate.prompt is required');
  });

  it('returns error when job_output.jobId is missing', async () => {
    const result = await executeSpecialTool('job_output', {}, mockContext);
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toBe('job_output.jobId is required');
  });

  it('returns error when job_kill.jobId is missing', async () => {
    const result = await executeSpecialTool('job_kill', {}, mockContext);
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toBe('job_kill.jobId is required');
  });

  it('jobs_list returns empty list when no jobs', async () => {
    const result = await executeSpecialTool('jobs_list', {}, mockContext);
    expect(result.status).toBe('completed');
    expect(JSON.parse(result.content[0].text)).toEqual({ jobs: [] });
  });

  it('job_output returns not found for unknown job', async () => {
    const result = await executeSpecialTool('job_output', { jobId: 'unknown' }, mockContext);
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('Job not found');
  });

  it('job_kill returns not running for unknown job', async () => {
    const result = await executeSpecialTool('job_kill', { jobId: 'unknown' }, mockContext);
    expect(result.status).toBe('completed');
    expect(JSON.parse(result.content[0].text)).toEqual({ success: false, reason: 'Job not running' });
  });
});
