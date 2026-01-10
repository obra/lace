// ABOUTME: Tests for the core Session class
import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../agent';
import { useTempLaceDir } from '@lace/agent/test-utils';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

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
