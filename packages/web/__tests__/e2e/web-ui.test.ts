// ABOUTME: E2E tests for web UI functionality
// ABOUTME: Tests session creation, agent spawning, and messaging workflows

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock only essential external dependencies
vi.mock('@/lib/sse-manager', () => ({
  SSEManager: {
    getInstance: () => ({
      broadcast: vi.fn(),
      addConnection: vi.fn(),
      removeConnection: vi.fn(),
    }),
  },
}));

vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: () => ({
    requestApproval: async () => Promise.resolve('allow_once'),
  }),
}));

import { getSessionService } from '@/lib/server/session-service';
import { asThreadId, Project } from '@/lib/server/lace-imports';
import type { Session as SessionType } from '@/types/api';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

describe('Web UI E2E Tests', () => {
  let sessionService: ReturnType<typeof getSessionService>;

  // Mock environment variables and external dependencies
  const originalEnv = process.env;
  beforeEach(() => {
    setupTestPersistence();

    process.env = {
      ...originalEnv,
      ANTHROPIC_KEY: 'test-key',
      LACE_DB_PATH: ':memory:',
    };
    sessionService = getSessionService();
  });

  afterEach(() => {
    process.env = originalEnv;
    teardownTestPersistence();
    // Clear active sessions to ensure test isolation
    sessionService.clearActiveSessions();
    // Clear global singleton
    global.sessionService = undefined;
  });

  describe('Session Management Workflow', () => {
    it('should create a new session and persist it', async () => {
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();
      const session = await sessionService.createSession(
        'Test Session',
        'anthropic',
        'claude-3-haiku-20240307',
        projectId
      );

      expect(session).toBeDefined();
      expect(session.name).toBe('Test Session');
      expect(session.agents).toHaveLength(1); // Coordinator agent
    });

    it('should list created sessions', async () => {
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();
      await sessionService.createSession(
        'Session 1',
        'anthropic',
        'claude-3-haiku-20240307',
        projectId
      );
      await sessionService.createSession(
        'Session 2',
        'anthropic',
        'claude-3-haiku-20240307',
        projectId
      );

      const sessions = await sessionService.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.name)).toContain('Session 1');
      expect(sessions.map((s) => s.name)).toContain('Session 2');
    });

    it('should retrieve a specific session', async () => {
      // Create a session
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();
      const created = await sessionService.createSession(
        'Retrieve Test',
        'anthropic',
        'claude-3-haiku-20240307',
        projectId
      );

      // Retrieve it
      const retrieved = await sessionService.getSession(created.id);

      expect(retrieved).toBeDefined();
      const retrievedInfo = retrieved!.getInfo();
      expect(retrievedInfo?.name).toBe('Retrieve Test');
      expect(retrieved!.getId()).toBe(created.id);
    });
  });

  describe('Agent Management Workflow', () => {
    let session: SessionType;

    beforeEach(async () => {
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();
      session = await sessionService.createSession(
        'Agent Test Session',
        'anthropic',
        'claude-3-haiku-20240307',
        projectId
      );
    });

    it('should spawn an agent in a session', async () => {
      const sessionInstance = await sessionService.getSession(session.id);
      expect(sessionInstance).toBeDefined();

      const agent = sessionInstance!.spawnAgent('Test Agent', 'anthropic');

      expect(agent).toBeDefined();
      expect(agent.threadId).toMatch(new RegExp(`^${session.id}\\.\\d+$`));

      // Verify the agent was added to the session with the correct name
      const agents = sessionInstance!.getAgents();
      const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);
      expect(spawnedAgent).toBeDefined();
      expect(spawnedAgent!.name).toBe('Test Agent');
    });

    it('should list agents in a session', async () => {
      // Get session instance and spawn multiple agents
      const sessionInstance = await sessionService.getSession(session.id);
      expect(sessionInstance).toBeDefined();

      sessionInstance!.spawnAgent('Agent 1', 'anthropic');
      sessionInstance!.spawnAgent('Agent 2', 'anthropic');

      // Check session includes agents
      const updatedSession = await sessionService.getSession(session.id);

      expect(updatedSession).toBeDefined();
      const updatedAgents = updatedSession!.getAgents();
      expect(updatedAgents).toHaveLength(3); // Coordinator + 2 agents
      expect(updatedAgents.map((a) => a.name)).toContain('Agent Test Session');
      expect(updatedAgents.map((a) => a.name)).toContain('Agent 1');
      expect(updatedAgents.map((a) => a.name)).toContain('Agent 2');
    });

    it('should generate correct agent thread IDs', async () => {
      const sessionInstance = await sessionService.getSession(session.id);
      expect(sessionInstance).toBeDefined();

      const agent1 = sessionInstance!.spawnAgent('Agent 1', 'anthropic');
      const agent2 = sessionInstance!.spawnAgent('Agent 2', 'anthropic');

      expect(agent1.threadId).toBe(`${session.id}.1`);
      expect(agent2.threadId).toBe(`${session.id}.2`);
    });
  });

  describe('Session Persistence', () => {
    it('should persist session data across service instances', async () => {
      // Create session with first service instance
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();
      const session1 = await sessionService.createSession(
        'Persistence Test',
        'anthropic',
        'claude-3-haiku-20240307',
        projectId
      );
      const sessionInstance = await sessionService.getSession(session1.id);
      expect(sessionInstance).toBeDefined();
      sessionInstance!.spawnAgent('Persistent Agent', 'anthropic');

      // Create new service instance (simulating app restart)
      const newSessionService = getSessionService();

      // Should be able to retrieve the session
      const retrievedSession = await newSessionService.getSession(session1.id);
      expect(retrievedSession).toBeDefined();
      const retrievedInfo = retrievedSession!.getInfo();
      expect(retrievedInfo?.name).toBe('Persistence Test');
      const retrievedAgents = retrievedSession!.getAgents();
      expect(retrievedAgents).toHaveLength(2); // Coordinator + 1 agent
      expect(retrievedAgents.map((a) => a.name)).toContain('Persistence Test');
      expect(retrievedAgents.map((a) => a.name)).toContain('Persistent Agent');
    });

    it('should list persisted sessions after restart', async () => {
      // Create some sessions
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();
      await sessionService.createSession(
        'Session A',
        'anthropic',
        'claude-3-haiku-20240307',
        projectId
      );
      await sessionService.createSession(
        'Session B',
        'anthropic',
        'claude-3-haiku-20240307',
        projectId
      );

      // Create new service instance
      const newSessionService = getSessionService();

      // Should list all sessions
      const sessions = await newSessionService.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.name)).toContain('Session A');
      expect(sessions.map((s) => s.name)).toContain('Session B');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid session ID gracefully', async () => {
      const invalidSession = await sessionService.getSession(asThreadId('invalid-thread-id'));
      expect(invalidSession).toBeNull();
    });

    it('should handle spawning agent in non-existent session', async () => {
      const nonExistentSession = await sessionService.getSession(
        asThreadId('non-existent-session')
      );
      expect(nonExistentSession).toBeNull();
    });
  });
});
