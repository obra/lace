// ABOUTME: Tests for jobs_list tool schema validation

import { describe, expect, it } from 'vitest';
import { JobsListTool } from '../implementations/jobs_list';

describe('JobsListTool', () => {
  it('has correct name', () => {
    const tool = new JobsListTool();
    expect(tool.name).toBe('jobs_list');
  });

  it('accepts no parameters', () => {
    const tool = new JobsListTool();

    const result = tool.schema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts status filter', () => {
    const tool = new JobsListTool();

    const result = tool.schema.safeParse({
      status: ['running', 'completed'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toEqual(['running', 'completed']);
    }
  });

  it('accepts type filter', () => {
    const tool = new JobsListTool();

    const result = tool.schema.safeParse({
      type: ['bash'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toEqual(['bash']);
    }
  });

  it('accepts limit parameter with default', () => {
    const tool = new JobsListTool();

    // Default limit
    const resultDefault = tool.schema.safeParse({});
    expect(resultDefault.success).toBe(true);
    if (resultDefault.success) {
      expect(resultDefault.data.limit).toBe(50);
    }

    // Custom limit
    const resultCustom = tool.schema.safeParse({ limit: 10 });
    expect(resultCustom.success).toBe(true);
    if (resultCustom.success) {
      expect(resultCustom.data.limit).toBe(10);
    }
  });

  it('rejects invalid status values', () => {
    const tool = new JobsListTool();

    const result = tool.schema.safeParse({
      status: ['invalid_status'],
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid type values', () => {
    const tool = new JobsListTool();

    const result = tool.schema.safeParse({
      type: ['invalid_type'],
    });

    expect(result.success).toBe(false);
  });

  it('rejects limit outside valid range', () => {
    const tool = new JobsListTool();

    const resultTooLow = tool.schema.safeParse({ limit: 0 });
    expect(resultTooLow.success).toBe(false);

    const resultTooHigh = tool.schema.safeParse({ limit: 101 });
    expect(resultTooHigh.success).toBe(false);
  });
});
