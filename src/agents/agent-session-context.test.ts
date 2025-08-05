// ABOUTME: Test Agent session context retrieval for tool security
// ABOUTME: Validates that Agent can reliably get Session objects for tool execution

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/test-utils/test-provider';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import {
  setupTestProviderInstances,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import { asThreadId } from '~/threads/types';

describe('Agent Session Context', () => {
  const tempDirContext = useTempLaceDir();
  let session: Session;
  let agent: Agent;
  let project: Project;
  let createdInstanceIds: string[] = [];

  beforeEach(async () => {
    setupTestPersistence();
    setupTestProviderDefaults();

    // Create test provider instances
    await setupTestProviderInstances();
    createdInstanceIds = ['test-anthropic', 'test-openai'];

    // Create real project
    project = Project.create(
      'Test Project',
      'Project for session context testing',
      tempDirContext.tempDir,
      {}
    );

    // Create real session with provider instance
    session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
    });

    // Get the coordinator agent
    const coordinatorAgent = session.getAgent(session.getId());
    if (!coordinatorAgent) {
      throw new Error('Failed to get coordinator agent');
    }
    agent = coordinatorAgent;
  });

  afterEach(async () => {
    // Clean up provider instances
    await cleanupTestProviderInstances(createdInstanceIds);
    teardownTestPersistence();
    cleanupTestProviderDefaults();
  });

  describe('getFullSession', () => {
    it('should retrieve the session that created the agent', async () => {
      // Test that agent can get its session
      const retrievedSession = await (
        agent as unknown as { getFullSession(): Promise<Session | undefined> }
      ).getFullSession();

      expect(retrievedSession).toBeDefined();
      expect(retrievedSession!.getId()).toBe(session.getId());
    });

    it('should return undefined if thread has no sessionId', async () => {
      // Create agent with thread that has no session
      const toolExecutor = new ToolExecutor();
      const provider = new TestProvider({});

      const orphanAgent = new Agent({
        provider,
        toolExecutor,
        threadManager: session.getAgent(session.getId())!.threadManager,
        threadId: 'orphan-thread-123',
        tools: [],
      });

      const retrievedSession = await (
        orphanAgent as unknown as { getFullSession(): Promise<Session | undefined> }
      ).getFullSession();
      expect(retrievedSession).toBeUndefined();
    });
  });

  describe('Session roundtrip persistence', () => {
    it('should persist sessions properly via Session.create() → Session.getById()', async () => {
      // Create session via Session.create()
      const createdSession = Session.create({
        name: 'Roundtrip Test Session',
        projectId: project.getId(),
      });

      // Retrieve same session via Session.getById()
      const retrievedSession = await Session.getById(createdSession.getId());

      expect(retrievedSession).toBeDefined();
      expect(retrievedSession!.getId()).toBe(createdSession.getId());
    });

    it('should return null for non-existent session IDs', async () => {
      const nonExistentSession = await Session.getById(asThreadId('non-existent-session-123'));
      expect(nonExistentSession).toBeNull();
    });
  });
});
