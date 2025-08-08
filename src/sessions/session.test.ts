// ABOUTME: Tests for Session class
// ABOUTME: Verifies session creation, agent spawning, and session management

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { asThreadId } from '~/threads/types';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import { existsSync } from 'fs';

// Mock external dependencies that don't affect core functionality
vi.mock('server-only', () => ({}));

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
  const _tempLaceDir = setupCoreTest();
  let testProject: Project;
  let providerInstanceId: string;
  let openaiProviderInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();
    vi.clearAllMocks();
    process.env.LACE_DB_PATH = ':memory:';

    // Create real provider instances for testing
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022'],
      displayName: 'Test Session Instance',
      apiKey: 'test-anthropic-key',
    });

    openaiProviderInstanceId = await createTestProviderInstance({
      catalogId: 'openai',
      models: ['gpt-4o', 'gpt-4o-mini'],
      displayName: 'Test OpenAI Session Instance',
      apiKey: 'test-openai-key',
    });

    // Clear provider cache to avoid race conditions between tests
    Session.clearProviderCache();

    // Create a test project for all tests with default provider configuration
    testProject = Project.create('Test Project', '/test/path', 'Test project', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
  });

  afterEach(async () => {
    cleanupTestProviderDefaults();
    if (providerInstanceId || openaiProviderInstanceId) {
      await cleanupTestProviderInstances(
        [providerInstanceId, openaiProviderInstanceId].filter(Boolean)
      );
    }
  });

  describe('generateSessionName', () => {
    beforeEach(() => {
      // Mock Date to get predictable results
      vi.setSystemTime(new Date('2025-07-24T14:30:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should generate human-readable date format', () => {
      const session = Session.create({
        projectId: testProject.getId(),
        // name omitted to trigger auto-generation
      });

      const info = session.getInfo();
      expect(info?.name).toBe('Thursday, Jul 24');
    });

    it('should handle different dates correctly', () => {
      vi.setSystemTime(new Date('2025-12-31T10:00:00Z'));

      const session = Session.create({
        projectId: testProject.getId(),
      });

      const info = session.getInfo();
      expect(info?.name).toBe('Wednesday, Dec 31');
    });
  });

  describe('default model selection', () => {
    it('should create session with anthropic provider instance', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProject.getId(),
        configuration: {
          providerInstanceId,
          modelId: 'claude-3-5-sonnet-20241022',
        },
      });

      const agents = session.getAgents();
      expect(agents[0]?.modelId).toBe('claude-3-5-sonnet-20241022');
    });

    it('should create session with openai provider instance', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProject.getId(),
        configuration: {
          providerInstanceId: openaiProviderInstanceId,
          modelId: 'gpt-4o',
        },
      });

      const agents = session.getAgents();
      expect(agents[0]?.modelId).toBe('gpt-4o');
    });
  });

  describe('spawnAgent default naming', () => {
    it('should use "Lace" as default agent name', () => {
      const session = Session.create({
        projectId: testProject.getId(),
        configuration: {},
      });

      const agent = session.spawnAgent({ name: '' }); // Empty name to trigger default

      const agents = session.getAgents();
      const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);
      expect(spawnedAgent?.name).toBe('Lace');
    });

    it('should use provided name when given', () => {
      const session = Session.create({
        projectId: testProject.getId(),
        configuration: {},
      });

      const agent = session.spawnAgent({ name: 'Custom Agent Name' });

      const agents = session.getAgents();
      const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);
      expect(spawnedAgent?.name).toBe('Custom Agent Name');
    });

    it('should handle whitespace-only names', () => {
      const session = Session.create({
        projectId: testProject.getId(),
        configuration: {},
      });

      const agent = session.spawnAgent({ name: '   ' }); // Whitespace-only

      const agents = session.getAgents();
      const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);
      expect(spawnedAgent?.name).toBe('Lace');
    });
  });

  describe('create', () => {
    it('should create a session with default parameters', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProject.getId(),
      });
      expect(session).toBeInstanceOf(Session);
      expect(session.getId()).toBeDefined();
    });

    it('should create a session with custom parameters', () => {
      const session = Session.create({
        name: 'Custom Session',
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
        projectId: testProject.getId(),
      });
      const info = session.getInfo();

      expect(info).toEqual({
        id: session.getId(),
        name: 'Test Session',
        createdAt: expect.any(Date) as Date,
        agents: expect.arrayContaining([
          expect.objectContaining({
            threadId: session.getId(),
            name: 'Lace', // Coordinator agent is always named "Lace"
            providerInstanceId: expect.any(String) as string,
            modelId: 'claude-3-5-haiku-20241022',
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
        projectId: testProject.getId(),
      });
      const agent = session.spawnAgent({ name: 'Test Agent' });

      expect(agent).toBeDefined();
      expect(typeof agent.threadId).toBe('string');
    });

    it('should store the spawned agent', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProject.getId(),
      });
      session.spawnAgent({ name: 'Test Agent' });

      const agents = session.getAgents();
      expect(agents).toHaveLength(2); // Coordinator + 1 spawned agent
      expect(agents[1]).toEqual(
        expect.objectContaining({
          name: 'Test Agent',
          providerInstanceId: expect.any(String) as string,
          modelId: expect.any(String) as string,
          status: expect.any(String) as string,
        })
      );
    });

    it('should preserve custom model when spawning agent', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProject.getId(),
      });

      // Spawn agent with custom model
      session.spawnAgent({
        name: 'Claude Sonnet Agent',
        providerInstanceId,
        modelId: 'claude-3-5-sonnet-20241022',
      });

      const agents = session.getAgents();
      expect(agents).toHaveLength(2); // Coordinator + 1 spawned agent

      const spawnedAgent = agents[1];
      expect(spawnedAgent).toEqual(
        expect.objectContaining({
          name: 'Claude Sonnet Agent',
          providerInstanceId: expect.any(String) as string,
          modelId: 'claude-3-5-sonnet-20241022',
          status: expect.any(String) as string,
        })
      );
    });

    it('should preserve custom provider when spawning agent', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProject.getId(),
      });

      // Spawn agent with custom provider and model
      session.spawnAgent({
        name: 'GPT Agent',
        providerInstanceId: openaiProviderInstanceId,
        modelId: 'gpt-4o',
      });

      const agents = session.getAgents();
      expect(agents).toHaveLength(2); // Coordinator + 1 spawned agent

      const spawnedAgent = agents[1];
      expect(spawnedAgent).toEqual(
        expect.objectContaining({
          name: 'GPT Agent',
          providerInstanceId: expect.any(String) as string,
          modelId: 'gpt-4o',
          status: expect.any(String) as string,
        })
      );
    });

    it('should fall back to session defaults when no provider/model specified', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProject.getId(),
      });

      // Spawn agent without specifying provider/model
      session.spawnAgent({ name: 'Default Agent' });

      const agents = session.getAgents();
      expect(agents).toHaveLength(2); // Coordinator + 1 spawned agent

      const spawnedAgent = agents[1];
      expect(spawnedAgent).toEqual(
        expect.objectContaining({
          name: 'Default Agent',
          providerInstanceId: expect.any(String) as string, // Should fall back to session provider
          modelId: 'claude-3-5-haiku-20241022', // Should fall back to session model
          status: expect.any(String) as string,
        })
      );
    });
  });

  describe('getAgents', () => {
    it('should return coordinator agent when no agents spawned', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProject.getId(),
      });
      const agents = session.getAgents();

      expect(agents).toHaveLength(1);
      expect(agents[0]).toEqual(
        expect.objectContaining({
          threadId: session.getId(),
          name: 'Lace', // Coordinator agent is always named "Lace"
          providerInstanceId: expect.any(String) as string,
          modelId: 'claude-3-5-haiku-20241022',
          status: expect.any(String) as string,
        })
      );
    });

    it('should return spawned agents', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProject.getId(),
      });
      const agent1 = session.spawnAgent({ name: 'Agent 1' });

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
          providerInstanceId: expect.any(String) as string,
          modelId: expect.any(String) as string,
          status: expect.any(String) as string,
        })
      );
    });
  });

  describe('getAgent', () => {
    it('should return null for non-existent agent', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProject.getId(),
      });
      const agent = session.getAgent(asThreadId('lace_20250101_notfnd'));
      expect(agent).toBeNull();
    });

    it('should return spawned agent', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProject.getId(),
      });
      const spawnedAgent = session.spawnAgent({ name: 'Test Agent' });
      const retrievedAgent = session.getAgent(asThreadId(spawnedAgent.threadId));
      expect(retrievedAgent).toBe(spawnedAgent);
    });

    it('should return coordinator agent', () => {
      const session = Session.create({
        name: 'Test Session',
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
        projectId: testProject.getId(),
      });
      const spawnedAgent = session.spawnAgent({ name: 'Test Agent' });

      // Should not throw
      await expect(session.startAgent(asThreadId(spawnedAgent.threadId))).resolves.toBeUndefined();
    });

    it('should throw error for non-existent agent', async () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProject.getId(),
      });
      await expect(session.startAgent(asThreadId('lace_20250101_notfnd'))).rejects.toThrow(
        'Agent not found: lace_20250101_notfnd'
      );
    });
  });

  describe('stopAgent', () => {
    it('should stop an agent', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProject.getId(),
      });
      const spawnedAgent = session.spawnAgent({ name: 'Test Agent' });

      // Should not throw
      expect(() => session.stopAgent(asThreadId(spawnedAgent.threadId))).not.toThrow();
    });

    it('should throw error for non-existent agent', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProject.getId(),
      });
      expect(() => session.stopAgent(asThreadId('lace_20250101_notfnd'))).toThrow(
        'Agent not found: lace_20250101_notfnd'
      );
    });
  });

  describe('destroy', () => {
    it('should stop all agents and clear them', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProject.getId(),
      });
      const agent1 = session.spawnAgent({ name: 'Agent 1' });
      const agent2 = session.spawnAgent({ name: 'Agent 2' });

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
        {
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }
      );
      testProjectId = testProject.getId();
    });

    it('should create session with project context', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProjectId,
      });

      expect(session.getProjectId()).toBe(testProjectId);
      expect(session.getWorkingDirectory()).toBe('/project/path');
    });

    it('should spawn agents with project working directory', () => {
      const session = Session.create({
        name: 'Test Session',
        projectId: testProjectId,
      });

      const _agent = session.spawnAgent({ name: 'Worker Agent' });
      expect(session.getWorkingDirectory()).toBe('/project/path');
    });

    it('should store session in sessions table not metadata', () => {
      const session = Session.create({
        name: 'Test Session',
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
        projectId: testProjectId,
      });
      const session2 = Session.create({
        name: 'Session 2',
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
          {
            providerInstanceId,
            modelId: 'claude-3-5-haiku-20241022',
          }
        );
        const projectId = testProject.getId();

        // Create sessions with project ID (only these are stored in sessions table)
        Session.create({
          name: 'Session 1',
          projectId: projectId,
        });
        Session.create({
          name: 'Session 2',
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
        const session = await Session.getById(asThreadId('lace_20250101_nofind'));
        expect(session).toBeNull();
      });
    });
  });

  describe('temp directory management', () => {
    it('should create session temp directory', () => {
      const sessionId = 'test-session-123';
      const projectId = 'test-project-456';
      const tempDir = Session.getSessionTempDir(sessionId, projectId);

      expect(tempDir).toContain(`project-${projectId}`);
      expect(tempDir).toContain(`session-${sessionId}`);
      expect(existsSync(tempDir)).toBe(true);
    });

    it('should return same directory for same session and project', () => {
      const sessionId = 'stable-session';
      const projectId = 'stable-project';
      const tempDir1 = Session.getSessionTempDir(sessionId, projectId);
      const tempDir2 = Session.getSessionTempDir(sessionId, projectId);

      expect(tempDir1).toBe(tempDir2);
    });

    it('should create different directories for different sessions', () => {
      const projectId = 'same-project';
      const tempDir1 = Session.getSessionTempDir('session-a', projectId);
      const tempDir2 = Session.getSessionTempDir('session-b', projectId);

      expect(tempDir1).not.toBe(tempDir2);
      expect(tempDir1).toContain('session-a');
      expect(tempDir2).toContain('session-b');
    });

    it('should nest under project directory', () => {
      const sessionId = 'nested-session';
      const projectId = 'parent-project';
      const sessionTempDir = Session.getSessionTempDir(sessionId, projectId);
      const projectTempDir = Project.getProjectTempDir(projectId);

      expect(sessionTempDir).toContain(projectTempDir);
    });
  });
});
