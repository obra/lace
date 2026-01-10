// ABOUTME: Tests for ConversationRunner - the agentic loop for executing prompts

import { describe, it, expect, vi } from 'vitest';
import { ConversationRunner } from '../runner';

describe('ConversationRunner', () => {
  it('creates a runner instance with required config', () => {
    const runner = new ConversationRunner({
      sessionDir: '/tmp/test-session',
      cwd: '/tmp/test-cwd',
      onUpdate: vi.fn(),
    });
    expect(runner).toBeDefined();
    expect(runner).toBeInstanceOf(ConversationRunner);
  });

  it('accepts optional config parameters', () => {
    const onUpdate = vi.fn();
    const runner = new ConversationRunner({
      sessionDir: '/tmp/test-session',
      cwd: '/tmp/test-cwd',
      onUpdate,
      connectionId: 'test-connection',
      modelId: 'test-model',
      executionMode: 'plan',
      approvalMode: 'approveReads',
      environment: { NODE_ENV: 'test' },
      maxBudgetUsd: 10.0,
    });
    expect(runner).toBeDefined();
  });

  it('exposes sessionDir from config', () => {
    const runner = new ConversationRunner({
      sessionDir: '/tmp/my-session',
      cwd: '/tmp/test-cwd',
      onUpdate: vi.fn(),
    });
    expect(runner.sessionDir).toBe('/tmp/my-session');
  });
});
