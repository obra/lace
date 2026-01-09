// ABOUTME: Tests for DelegateTool schema validation, including run_async support

import { describe, expect, it } from 'vitest';
import { DelegateTool } from '../implementations/delegate';

describe('DelegateTool schema', () => {
  it('accepts run_async parameter', () => {
    const tool = new DelegateTool();
    const schema = tool.schema;

    const result = schema.safeParse({
      prompt: 'find all typescript files',
      run_async: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.run_async).toBe(true);
    }
  });

  it('defaults run_async to false', () => {
    const tool = new DelegateTool();
    const schema = tool.schema;

    const result = schema.safeParse({
      prompt: 'search the codebase',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.run_async).toBe(false);
    }
  });

  it('accepts description parameter', () => {
    const tool = new DelegateTool();
    const schema = tool.schema;

    const result = schema.safeParse({
      prompt: 'explore the API',
      description: 'API exploration',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('API exploration');
    }
  });

  it('accepts resume parameter', () => {
    const tool = new DelegateTool();
    const result = tool.schema.safeParse({
      prompt: 'continue previous work',
      resume: 'job_abc123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resume).toBe('job_abc123');
    }
  });
});
