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
import { Session as SessionType } from '@/types/api';

describe('Web UI E2E Tests', () => {
  let sessionService: ReturnType<typeof getSessionService>;

  // Mock environment variables and external dependencies
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ANTHROPIC_KEY: 'test-key',
      LACE_DB_PATH: ':memory:',
    };
    sessionService = getSessionService();
  });

  afterEach(() => {
    process.env = originalEnv;
    // Clear active sessions to ensure test isolation
    sessionService.clearActiveSessions();
    // Clear global singleton
    global.sessionService = undefined;
  });

  describe('Session Management Workflow', () => {
    it('should create a new session and persist it', async () => {
      const session = await sessionService.createSession('Test Session');

      expect(session).toBeDefined();
      expect(session.name).toBe('Test Session');
      expect(session.agents).toHaveLength(1); // Coordinator agent
    });

    it('should list created sessions', async () => {
      await sessionService.createSession('Session 1');
      await sessionService.createSession('Session 2');

      const sessions = await sessionService.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.name)).toContain('Session 1');
      expect(sessions.map((s) => s.name)).toContain('Session 2');
    });

    it('should retrieve a specific session', async () => {
      // Create a session
      const created = await sessionService.createSession('Retrieve Test');

      // Retrieve it
      const retrieved = await sessionService.getSession(created.id as string);

      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('Retrieve Test');
      expect(retrieved!.id).toBe(created.id);
    });
  });

  describe('Agent Management Workflow', () => {
    let session: SessionType;

    beforeEach(async () => {
      session = await sessionService.createSession('Agent Test Session');
    });

    it('should spawn an agent in a session', async () => {
      const agent = await sessionService.spawnAgent(
        session.id as string,
        'Test Agent',
        'anthropic'
      );

      expect(agent).toBeDefined();
      expect(agent.name).toBe('Test Agent');
      expect(agent.threadId).toMatch(new RegExp(`^${session.id}\\.\\d+$`));
    });

    it('should list agents in a session', async () => {
      // Spawn multiple agents
      await sessionService.spawnAgent(session.id as string, 'Agent 1', 'anthropic');
      await sessionService.spawnAgent(session.id as string, 'Agent 2', 'anthropic');

      // Check session includes agents
      const updatedSession = await sessionService.getSession(session.id as string);

      expect(updatedSession).toBeDefined();
      expect(updatedSession!.agents).toHaveLength(3); // Coordinator + 2 agents
      expect(updatedSession!.agents.map((a) => a.name)).toContain('Agent Test Session');
      expect(updatedSession!.agents.map((a) => a.name)).toContain('Agent 1');
      expect(updatedSession!.agents.map((a) => a.name)).toContain('Agent 2');
    });

    it('should generate correct agent thread IDs', async () => {
      const agent1 = await sessionService.spawnAgent(session.id as string, 'Agent 1', 'anthropic');
      const agent2 = await sessionService.spawnAgent(session.id as string, 'Agent 2', 'anthropic');

      expect(agent1.threadId).toBe(`${session.id}.1`);
      expect(agent2.threadId).toBe(`${session.id}.2`);
    });
  });

  describe('Session Persistence', () => {
    it('should persist session data across service instances', async () => {
      // Create session with first service instance
      const session1 = await sessionService.createSession('Persistence Test');
      await sessionService.spawnAgent(session1.id as string, 'Persistent Agent', 'anthropic');

      // Create new service instance (simulating app restart)
      const newSessionService = getSessionService();

      // Should be able to retrieve the session
      const retrievedSession = await newSessionService.getSession(session1.id as string);
      expect(retrievedSession).toBeDefined();
      expect(retrievedSession!.name).toBe('Persistence Test');
      expect(retrievedSession!.agents).toHaveLength(2); // Coordinator + 1 agent
      expect(retrievedSession!.agents.map((a) => a.name)).toContain('Persistence Test');
      expect(retrievedSession!.agents.map((a) => a.name)).toContain('Persistent Agent');
    });

    it('should list persisted sessions after restart', async () => {
      // Create some sessions
      await sessionService.createSession('Session A');
      await sessionService.createSession('Session B');

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
      const invalidSession = await sessionService.getSession('invalid-thread-id');
      expect(invalidSession).toBeNull();
    });

    it('should handle spawning agent in non-existent session', async () => {
      await expect(sessionService.spawnAgent('non-existent-session', 'Test Agent')).rejects.toThrow(
        'Session not found'
      );
    });
  });
});
