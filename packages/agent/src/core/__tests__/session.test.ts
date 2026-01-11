// ABOUTME: Tests for the core Session class and session utilities
import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../agent';
import { getEffectiveConfig } from '../session';
import { useTempLaceDir } from '@lace/agent/test-utils';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

describe('getEffectiveConfig', () => {
  it('merges server config with session config', () => {
    const serverConfig = {
      executionMode: 'execute' as const,
      approvalMode: 'auto' as const,
      connectionId: 'server-conn',
      modelId: 'server-model',
    };
    const sessionConfig = {
      approvalMode: 'ask' as const, // override
      maxBudgetUsd: 10,
    };

    const result = getEffectiveConfig(serverConfig, sessionConfig);

    expect(result).toEqual({
      executionMode: 'execute',
      approvalMode: 'ask', // session wins
      connectionId: 'server-conn',
      modelId: 'server-model',
      maxBudgetUsd: 10,
    });
  });

  it('uses server config when session config is undefined', () => {
    const serverConfig = {
      executionMode: 'plan' as const,
      approvalMode: 'ask' as const,
    };

    const result = getEffectiveConfig(serverConfig, undefined);

    expect(result).toEqual(serverConfig);
  });

  it('uses server config when session config is empty object', () => {
    const serverConfig = {
      executionMode: 'execute' as const,
      approvalMode: 'deny' as const,
      connectionId: 'conn-123',
    };

    const result = getEffectiveConfig(serverConfig, {});

    expect(result).toEqual(serverConfig);
  });

  it('session config overrides all matching server config fields', () => {
    const serverConfig = {
      executionMode: 'plan' as const,
      approvalMode: 'ask' as const,
      connectionId: 'server-conn',
      modelId: 'server-model',
      maxBudgetUsd: 100,
      maxThinkingTokens: 1000,
      environment: { FOO: 'server' },
    };
    const sessionConfig = {
      executionMode: 'execute' as const,
      approvalMode: 'deny' as const,
      connectionId: 'session-conn',
      modelId: 'session-model',
      maxBudgetUsd: 50,
      maxThinkingTokens: 500,
      environment: { FOO: 'session', BAR: 'new' },
    };

    const result = getEffectiveConfig(serverConfig, sessionConfig);

    expect(result).toEqual(sessionConfig);
  });

  it('preserves server fields not present in session config', () => {
    const serverConfig = {
      executionMode: 'execute' as const,
      approvalMode: 'ask' as const,
      connectionId: 'server-conn',
      modelId: 'server-model',
      maxBudgetUsd: 100,
    };
    const sessionConfig = {
      modelId: 'session-model',
    };

    const result = getEffectiveConfig(serverConfig, sessionConfig);

    expect(result.executionMode).toBe('execute');
    expect(result.approvalMode).toBe('ask');
    expect(result.connectionId).toBe('server-conn');
    expect(result.modelId).toBe('session-model');
    expect(result.maxBudgetUsd).toBe(100);
  });
});

describe('Session', () => {
  const laceDir = useTempLaceDir();
  let workDir: string;
  let agent: Agent;

  beforeEach(async () => {
    workDir = join(laceDir.tempDir, 'test-project');
    mkdirSync(workDir, { recursive: true });
    agent = new Agent({ laceDir: laceDir.tempDir });
    await agent.initialize();
  });

  it('creates a new session', async () => {
    const session = await agent.createSession({ cwd: workDir });
    expect(session).toBeDefined();
    expect(session.sessionId).toMatch(/^sess_[0-9a-f-]+$/);
  });

  it('loads an existing session', async () => {
    const session1 = await agent.createSession({ cwd: workDir });
    const session2 = await agent.loadSession(session1.sessionId);
    expect(session2.sessionId).toBe(session1.sessionId);
  });

  it('lists available sessions', async () => {
    await agent.createSession({ cwd: workDir });
    const sessions = await agent.listSessions();
    expect(sessions.length).toBeGreaterThan(0);
  });
});
