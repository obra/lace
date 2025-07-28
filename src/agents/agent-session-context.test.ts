// ABOUTME: Test Agent session context retrieval for tool security
// ABOUTME: Validates that Agent can reliably get Session objects for tool execution

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/test-utils/test-provider';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import { asThreadId } from '~/threads/types';

describe('Agent Session Context', () => {
  const tempDirContext = useTempLaceDir();
  let session: Session;
  let agent: Agent;
  let project: Project;

  beforeEach(async () => {
    setupTestPersistence();
    
    // Create real project
    project = Project.create(
      'Test Project',
      'Project for session context testing',
      tempDirContext.path,
      {}
    );

    // Create real session
    session = Session.create({
      name: 'Test Session',
      provider: 'anthropic',
      model: 'claude-3-haiku-20240307',
      projectId: project.getId(),
    });

    // Get the coordinator agent
    const coordinatorAgent = session.getAgent(session.getId());
    if (!coordinatorAgent) {
      throw new Error('Failed to get coordinator agent');
    }
    agent = coordinatorAgent;
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  describe('_getFullSession', () => {
    it('should retrieve the session that created the agent', async () => {
      // Test that agent can get its session
      const retrievedSession = await (agent as any)._getFullSession();
      
      expect(retrievedSession).toBeDefined();
      expect(retrievedSession.getId()).toBe(session.getId());
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

      const retrievedSession = await (orphanAgent as any)._getFullSession();
      expect(retrievedSession).toBeUndefined();
    });
  });
});