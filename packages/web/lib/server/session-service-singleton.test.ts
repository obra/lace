// ABOUTME: Unit tests for SessionService singleton behavior
// ABOUTME: Tests to reproduce the exact E2E test scenario with global SessionService

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSessionService } from '@/lib/server/session-service';
import { Project } from '@/lib/server/lace-imports';
import type { ThreadId } from '@/lib/server/lace-imports';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock SSE Manager
vi.mock('@/lib/sse-manager', () => ({
  SSEManager: {
    getInstance: () => ({
      broadcast: vi.fn(),
      addConnection: vi.fn(),
      removeConnection: vi.fn(),
    }),
  },
}));

// Mock approval manager
vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: () => ({
    requestApproval: vi.fn().mockResolvedValue('allow_once'),
  }),
}));

describe('SessionService Singleton E2E Reproduction', () => {
  let sessionService: ReturnType<typeof getSessionService>;

  beforeEach(() => {
    setupTestPersistence();

    // Set up environment exactly like E2E test
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    // Get the global SessionService instance
    sessionService = getSessionService();
  });

  afterEach(() => {
    sessionService.clearActiveSessions();
    teardownTestPersistence();
  });

  it('should reproduce the exact E2E test scenario step by step', async () => {
    // Step 1: Create project (same as E2E test)
    const testProject = Project.create(
      'Test Project',
      '/test/path',
      'Test project for API test',
      {}
    );
    const projectId = testProject.getId();

    // Step 2: Create session via SessionService (same as E2E test)
    const session = await sessionService.createSession(
      'Message Test Session',
      'anthropic',
      'claude-3-haiku-20240307',
      projectId
    );
    const sessionId = session.id as string;

    // Step 3: Spawn agent via SessionService (this is where E2E test fails)
    try {
      const session = await sessionService.getSession(sessionId as ThreadId);
      expect(session).toBeDefined();
      const agent = session!.spawnAgent('Message Agent', 'anthropic');

      // Step 4: Verify agent is retrievable from the session
      const _retrievedAgent = session!.getAgent(agent.threadId as ThreadId);
      expect(_retrievedAgent).toBeDefined();
    } catch (error) {
      // Debug: Check if session exists
      const retrievedSession = await sessionService.getSession(sessionId as ThreadId);
      expect(retrievedSession).toBeDefined();

      // Debug: Check session state
      if (retrievedSession) {
        const _agents = retrievedSession.getAgents();
        expect(_agents).toBeDefined();
      }

      throw error;
    }
  });

  it('should test multiple session creation cycles', async () => {
    // Create multiple sessions in sequence to test state pollution
    for (let i = 0; i < 3; i++) {
      const testProject = Project.create(`Test Project ${i}`, '/test/path', 'Test project', {});
      const projectId = testProject.getId();

      const session = await sessionService.createSession(
        `Test Session ${i}`,
        'anthropic',
        'claude-3-haiku-20240307',
        projectId
      );
      const sessionId = session.id as string;

      const sessionForAgent = await sessionService.getSession(sessionId as ThreadId);
      expect(sessionForAgent).toBeDefined();
      const _agent = sessionForAgent!.spawnAgent(`Test Agent ${i}`, 'anthropic');
      expect(_agent).toBeDefined();
    }
  });

  it('should test session service state after clearing', async () => {
    // Create session and agent
    const testProject = Project.create('Test Project', '/test/path', 'Test project', {});
    const projectId = testProject.getId();

    const session = await sessionService.createSession(
      'Test Session',
      'anthropic',
      'claude-3-haiku-20240307',
      projectId
    );
    const sessionId = session.id as string;

    const sessionForAgent = await sessionService.getSession(sessionId as ThreadId);
    expect(sessionForAgent).toBeDefined();
    const _agent = sessionForAgent!.spawnAgent('Test Agent', 'anthropic');

    // Clear active sessions
    sessionService.clearActiveSessions();

    // Try to spawn another agent (should work since session can be reconstructed)
    const sessionForSecondAgent = await sessionService.getSession(sessionId as ThreadId);
    expect(sessionForSecondAgent).toBeDefined();
    const _secondAgent = sessionForSecondAgent!.spawnAgent('Another Agent', 'anthropic');
  });

  it('should test session reconstruction after clearing', async () => {
    // Create session and agent
    const testProject = Project.create('Test Project', '/test/path', 'Test project', {});
    const projectId = testProject.getId();

    const session = await sessionService.createSession(
      'Test Session',
      'anthropic',
      'claude-3-haiku-20240307',
      projectId
    );
    const sessionId = session.id as string;

    const sessionForAgent = await sessionService.getSession(sessionId as ThreadId);
    expect(sessionForAgent).toBeDefined();
    const _agent = sessionForAgent!.spawnAgent('Test Agent', 'anthropic');

    // Clear active sessions
    sessionService.clearActiveSessions();

    // Try to get session (should reconstruct)
    const reconstructedSession = await sessionService.getSession(sessionId as ThreadId);

    if (reconstructedSession) {
      const _agents = reconstructedSession.getAgents();
      expect(_agents).toBeDefined();

      // Try to spawn another agent
      const _newAgent = reconstructedSession.spawnAgent('New Agent', 'anthropic');
      expect(_newAgent).toBeDefined();
    } else {
      expect(reconstructedSession).toBeDefined();
    }
  });
});
