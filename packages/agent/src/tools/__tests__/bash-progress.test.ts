// ABOUTME: Tests for progressIntervalMs parameter in bash and delegate tools

import { describe, expect, it } from 'vitest';
import { BashTool } from '../implementations/bash';
import { DelegateTool } from '../implementations/delegate';

describe('BashTool progressIntervalMs schema', () => {
  const tool = new BashTool();

  it('accepts valid progressIntervalMs values', () => {
    const result = tool.schema.safeParse({
      command: 'echo test',
      background: true,
      progressIntervalMs: 60000,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.progressIntervalMs).toBe(60000);
    }
  });

  it('accepts minimum progressIntervalMs (5000ms)', () => {
    const result = tool.schema.safeParse({
      command: 'sleep 10',
      background: true,
      progressIntervalMs: 5000,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.progressIntervalMs).toBe(5000);
    }
  });

  it('accepts maximum progressIntervalMs (600000ms)', () => {
    const result = tool.schema.safeParse({
      command: 'sleep 600',
      background: true,
      progressIntervalMs: 600000,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.progressIntervalMs).toBe(600000);
    }
  });

  it('rejects progressIntervalMs below minimum (< 5000)', () => {
    const result = tool.schema.safeParse({
      command: 'echo test',
      background: true,
      progressIntervalMs: 4999,
    });

    expect(result.success).toBe(false);
  });

  it('rejects progressIntervalMs above maximum (> 600000)', () => {
    const result = tool.schema.safeParse({
      command: 'echo test',
      background: true,
      progressIntervalMs: 600001,
    });

    expect(result.success).toBe(false);
  });

  it('rejects non-integer progressIntervalMs', () => {
    const result = tool.schema.safeParse({
      command: 'echo test',
      background: true,
      progressIntervalMs: 5000.5,
    });

    expect(result.success).toBe(false);
  });

  it('allows omitting progressIntervalMs', () => {
    const result = tool.schema.safeParse({
      command: 'echo test',
      background: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.progressIntervalMs).toBeUndefined();
    }
  });
});

describe('DelegateTool progressIntervalMs schema', () => {
  const tool = new DelegateTool();

  it('accepts valid progressIntervalMs values', () => {
    const result = tool.schema.safeParse({
      prompt: 'Do something',
      background: true,
      progressIntervalMs: 60000,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.progressIntervalMs).toBe(60000);
    }
  });

  it('accepts minimum progressIntervalMs (5000ms)', () => {
    const result = tool.schema.safeParse({
      prompt: 'Do something',
      background: true,
      progressIntervalMs: 5000,
    });

    expect(result.success).toBe(true);
  });

  it('accepts maximum progressIntervalMs (600000ms)', () => {
    const result = tool.schema.safeParse({
      prompt: 'Do something',
      background: true,
      progressIntervalMs: 600000,
    });

    expect(result.success).toBe(true);
  });

  it('rejects progressIntervalMs below minimum', () => {
    const result = tool.schema.safeParse({
      prompt: 'Do something',
      background: true,
      progressIntervalMs: 4999,
    });

    expect(result.success).toBe(false);
  });

  it('rejects progressIntervalMs above maximum', () => {
    const result = tool.schema.safeParse({
      prompt: 'Do something',
      background: true,
      progressIntervalMs: 600001,
    });

    expect(result.success).toBe(false);
  });

  it('allows omitting progressIntervalMs', () => {
    const result = tool.schema.safeParse({
      prompt: 'Do something',
      background: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.progressIntervalMs).toBeUndefined();
    }
  });
});

describe('DelegateTool connectionId/modelId schema', () => {
  const tool = new DelegateTool();

  it('accepts connectionId parameter', () => {
    const result = tool.schema.safeParse({
      prompt: 'Do something',
      connectionId: 'conn_12345',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.connectionId).toBe('conn_12345');
    }
  });

  it('accepts modelId parameter', () => {
    const result = tool.schema.safeParse({
      prompt: 'Do something',
      modelId: 'claude-3-sonnet',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modelId).toBe('claude-3-sonnet');
    }
  });

  it('accepts both connectionId and modelId together', () => {
    const result = tool.schema.safeParse({
      prompt: 'Do something',
      connectionId: 'conn_12345',
      modelId: 'claude-3-sonnet',
      background: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.connectionId).toBe('conn_12345');
      expect(result.data.modelId).toBe('claude-3-sonnet');
    }
  });

  it('allows omitting connectionId and modelId', () => {
    const result = tool.schema.safeParse({
      prompt: 'Do something',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.connectionId).toBeUndefined();
      expect(result.data.modelId).toBeUndefined();
    }
  });

  it('accepts empty string connectionId (will be undefined after processing)', () => {
    // Schema accepts empty strings - they're filtered by toNonEmptyString in server
    const result = tool.schema.safeParse({
      prompt: 'Do something',
      connectionId: '',
    });

    expect(result.success).toBe(true);
  });
});
