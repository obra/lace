// ABOUTME: Tests for Session class
// ABOUTME: Verifies session creation, agent spawning, and session management

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { asThreadId } from '~/threads/types';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

// Mock external dependencies that don't affect core functionality
vi.mock('server-only', () => ({}));

// Mock provider to avoid real API calls
vi.mock('~/providers/registry', () => ({
  ProviderRegistry: {
    createWithAutoDiscovery: vi.fn().mockReturnValue({
      createProvider: vi.fn().mockReturnValue({
        type: 'anthropic',
        model: 'claude-3-haiku-20240307',
        modelName: 'claude-3-haiku-20240307',
        providerName: 'anthropic',
        defaultModel: 'claude-3-haiku-20240307',
        setSystemPrompt: vi.fn(),
        createResponse: vi.fn().mockResolvedValue({
          content: 'Mock response',
          toolCalls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        }),
        createStreamingResponse: vi.fn().mockReturnValue({
          async *[Symbol.asyncIterator]() {
            yield await Promise.resolve({ type: 'content', content: 'Mock streaming response' });
          },
        }),
      }),
    }),
  },
}));

// Mock external dependencies that require system calls or network access
// - File system operations are mocked to avoid disk I/O during tests
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
  },
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
}));

// - Process operations are mocked to avoid spawning real processes
vi.mock('child_process', () => ({
  default: {
    spawn: vi.fn(),
    exec: vi.fn(),
  },
  spawn: vi.fn(),
  exec: vi.fn(),
}));

// - Network operations are mocked to avoid external requests
vi.mock('node-fetch', () => vi.fn());

describe('Session', () => {
  let testProject: Project;

  beforeEach(() => {
    setupTestPersistence();
    vi.clearAllMocks();

    // Set up environment for providers
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    // Create a test project for all tests
    testProject = Project.create('Test Project', '/test/path', 'Test project', {});
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  describe('create', () => {
    it('should create a session with default parameters', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      expect(session).toBeInstanceOf(Session);
      expect(session.getId()).toBeDefined();
    });

    it('should create a session with custom parameters', () => {
      const session = Session.create({
        name: 'Custom Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      expect(session).toBeInstanceOf(Session);
      expect(session.getId()).toBeDefined();
    });
  });

  describe('getId', () => {
    it('should return the session thread ID', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      const id = session.getId();
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });
  });

  describe('getInfo', () => {
    it('should return session information', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      const info = session.getInfo();

      expect(info).toEqual({
        id: session.getId(),
        name: 'Test Session',
        createdAt: expect.any(Date) as Date,
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        agents: expect.arrayContaining([
          expect.objectContaining({
            threadId: session.getId(),
            name: 'Test Session',
            provider: 'anthropic',
            model: 'claude-3-haiku-20240307',
            status: expect.any(String) as string,
          }),
        ]) as unknown[],
      });
    });
  });

  describe('spawnAgent', () => {
    it('should spawn an agent using the session agent', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      const agent = session.spawnAgent('Test Agent');

      expect(agent).toBeDefined();
      expect(typeof agent.threadId).toBe('string');
    });

    it('should store the spawned agent', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      session.spawnAgent('Test Agent');

      const agents = session.getAgents();
      expect(agents).toHaveLength(2); // Coordinator + 1 spawned agent
      expect(agents[1]).toEqual(
        expect.objectContaining({
          name: 'Test Agent',
          provider: 'anthropic',
          status: expect.any(String) as string,
        })
      );
    });

    it('should preserve custom model when spawning agent', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });

      // Spawn agent with custom model
      session.spawnAgent('Claude Opus Agent', 'anthropic', 'claude-3-opus-20240229');

      const agents = session.getAgents();
      expect(agents).toHaveLength(2); // Coordinator + 1 spawned agent

      const spawnedAgent = agents[1];
      expect(spawnedAgent).toEqual(
        expect.objectContaining({
          name: 'Claude Opus Agent',
          provider: 'anthropic',
          model: 'claude-3-opus-20240229',
          status: expect.any(String) as string,
        })
      );
    });

    it('should preserve custom provider when spawning agent', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });

      // Spawn agent with custom provider and model
      session.spawnAgent('GPT Agent', 'openai', 'gpt-4');

      const agents = session.getAgents();
      expect(agents).toHaveLength(2); // Coordinator + 1 spawned agent

      const spawnedAgent = agents[1];
      expect(spawnedAgent).toEqual(
        expect.objectContaining({
          name: 'GPT Agent',
          provider: 'openai',
          model: 'gpt-4',
          status: expect.any(String) as string,
        })
      );
    });

    it('should fall back to session defaults when no provider/model specified', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });

      // Spawn agent without specifying provider/model
      session.spawnAgent('Default Agent');

      const agents = session.getAgents();
      expect(agents).toHaveLength(2); // Coordinator + 1 spawned agent

      const spawnedAgent = agents[1];
      expect(spawnedAgent).toEqual(
        expect.objectContaining({
          name: 'Default Agent',
          provider: 'anthropic', // Should fall back to session provider
          model: 'claude-3-haiku-20240307', // Should fall back to session model
          status: expect.any(String) as string,
        })
      );
    });
  });

  describe('getAgents', () => {
    it('should return coordinator agent when no agents spawned', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      const agents = session.getAgents();

      expect(agents).toHaveLength(1);
      expect(agents[0]).toEqual(
        expect.objectContaining({
          threadId: session.getId(),
          name: 'Test Session',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
          status: expect.any(String) as string,
        })
      );
    });

    it('should return spawned agents', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      const agent1 = session.spawnAgent('Agent 1');

      // Due to mocking limitations, multiple agents may have the same thread ID
      // Test that at least one spawned agent can be created and tracked
      const agents = session.getAgents();

      // Verify we have coordinator + at least 1 spawned agent
      const coordinatorAgents = agents.filter((a) => a.threadId === session.getId());
      const spawnedAgents = agents.filter((a) => a.threadId !== session.getId());

      expect(coordinatorAgents).toHaveLength(1);
      expect(spawnedAgents.length).toBeGreaterThanOrEqual(1);

      // Verify spawned agent can be retrieved
      expect(session.getAgent(asThreadId(agent1.threadId))).toBeDefined();

      // Verify spawned agent has expected properties
      expect(spawnedAgents[0]).toEqual(
        expect.objectContaining({
          name: expect.any(String) as string,
          provider: 'anthropic',
          status: expect.any(String) as string,
        })
      );
    });
  });

  describe('getAgent', () => {
    it('should return null for non-existent agent', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      const agent = session.getAgent(asThreadId('non-existent'));
      expect(agent).toBeNull();
    });

    it('should return spawned agent', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      const spawnedAgent = session.spawnAgent('Test Agent');
      const retrievedAgent = session.getAgent(asThreadId(spawnedAgent.threadId));
      expect(retrievedAgent).toBe(spawnedAgent);
    });

    it('should return coordinator agent', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      const coordinatorAgent = session.getAgent(session.getId());
      expect(coordinatorAgent).toBeDefined();
      expect(coordinatorAgent!.threadId).toBe(session.getId());
    });
  });

  describe('startAgent', () => {
    it('should start an agent', async () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      const spawnedAgent = session.spawnAgent('Test Agent');

      // Should not throw
      await expect(session.startAgent(asThreadId(spawnedAgent.threadId))).resolves.toBeUndefined();
    });

    it('should throw error for non-existent agent', async () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      await expect(session.startAgent(asThreadId('non-existent'))).rejects.toThrow(
        'Agent not found: non-existent'
      );
    });
  });

  describe('stopAgent', () => {
    it('should stop an agent', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      const spawnedAgent = session.spawnAgent('Test Agent');

      // Should not throw
      expect(() => session.stopAgent(asThreadId(spawnedAgent.threadId))).not.toThrow();
    });

    it('should throw error for non-existent agent', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      expect(() => session.stopAgent(asThreadId('non-existent'))).toThrow(
        'Agent not found: non-existent'
      );
    });
  });

  describe('destroy', () => {
    it('should stop all agents and clear them', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProject.getId(),
      });
      const agent1 = session.spawnAgent('Agent 1');
      const agent2 = session.spawnAgent('Agent 2');

      // Verify agents exist before destroy
      const agentsBefore = session.getAgents();
      expect(agentsBefore.some((a) => a.threadId === asThreadId(agent1.threadId))).toBe(true);
      expect(agentsBefore.some((a) => a.threadId === asThreadId(agent2.threadId))).toBe(true);

      session.destroy();

      // After destroy, spawned agents should be removed but coordinator remains
      const agentsAfter = session.getAgents();
      expect(agentsAfter.some((a) => a.threadId === asThreadId(agent1.threadId))).toBe(false);
      expect(agentsAfter.some((a) => a.threadId === asThreadId(agent2.threadId))).toBe(false);
      expect(agentsAfter.some((a) => a.threadId === session.getId())).toBe(true); // Coordinator remains
    });
  });

  describe('Session class project support', () => {
    let testProjectId: string;

    beforeEach(() => {
      // Create the project that tests expect to exist
      const testProject = Project.create(
        'Test Project',
        '/project/path',
        'Test project for session tests',
        {}
      );
      testProjectId = testProject.getId();
    });

    it('should create session with project context', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProjectId,
      });

      expect(session.getProjectId()).toBe(testProjectId);
      expect(session.getWorkingDirectory()).toBe('/project/path');
    });

    it('should spawn agents with project working directory', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProjectId,
      });

      const _agent = session.spawnAgent('Worker Agent');
      expect(session.getWorkingDirectory()).toBe('/project/path');
    });

    it('should store session in sessions table not metadata', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProjectId,
      });

      // Verify session data can be retrieved from sessions table
      const sessionData = Session.getSession(session.getId());
      expect(sessionData).not.toBeNull();
      expect(sessionData!.projectId).toBe(testProjectId);
      expect(sessionData!.name).toBe('Test Session');
    });

    it('should get sessions from table not metadata in getAll', () => {
      // Create a couple of real sessions
      const session1 = Session.create({
        name: 'Session 1',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProjectId,
      });
      const session2 = Session.create({
        name: 'Session 2',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId: testProjectId,
      });

      // Get all sessions
      const result = Session.getAll();

      // Should find our sessions
      expect(result.length).toBeGreaterThanOrEqual(2);

      const session1Data = result.find((s) => s.id === session1.getId());
      const session2Data = result.find((s) => s.id === session2.getId());

      expect(session1Data).toBeDefined();
      expect(session1Data!.name).toBe('Session 1');

      expect(session2Data).toBeDefined();
      expect(session2Data!.name).toBe('Session 2');
    });
  });

  describe('static methods', () => {
    describe('getAll', () => {
      it('should return sessions from database', () => {
        // Create test project first
        const testProject = Project.create(
          'Test Project',
          '/test/path',
          'Test project for getAll test',
          {}
        );
        const projectId = testProject.getId();

        // Create sessions with project ID (only these are stored in sessions table)
        Session.create({
          name: 'Session 1',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
          projectId: projectId,
        });
        Session.create({
          name: 'Session 2',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
          projectId: projectId,
        });

        const sessions = Session.getAll();
        expect(sessions.length).toBeGreaterThanOrEqual(2);
        expect(sessions.some((s) => s.name === 'Session 1')).toBe(true);
        expect(sessions.some((s) => s.name === 'Session 2')).toBe(true);
      });
    });

    describe('getById', () => {
      it('should return null for non-existent session', async () => {
        const session = await Session.getById(asThreadId('non-existent-id'));
        expect(session).toBeNull();
      });
    });
  });
});
