// ABOUTME: Unit tests for SessionService singleton behavior
// ABOUTME: Tests to reproduce the exact E2E test scenario with global SessionService

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSessionService } from '@/lib/server/session-service';
import { Project, Session } from '@/lib/server/lace-imports';
import type { ThreadId } from '@/types/core';
import { setupWebTest } from '@/test-utils/web-test-setup';
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '@/lib/server/lace-imports';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock approval manager
vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: () => ({
    requestApproval: vi.fn().mockResolvedValue('allow_once'),
  }),
}));

describe('SessionService Singleton E2E Reproduction', () => {
  const _tempLaceDir = setupWebTest();
  let sessionService: ReturnType<typeof getSessionService>;
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();
    Session.clearProviderCache();

    // Set up environment
    process.env.LACE_DB_PATH = ':memory:';

    // Create a real provider instance for testing
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    // Get the global SessionService instance
    sessionService = getSessionService();
  });

  afterEach(async () => {
    sessionService.clearActiveSessions();
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
  });

  it('should reproduce the exact E2E test scenario step by step', async () => {
    // Step 1: Create project with provider instance
    const testProject = Project.create('Test Project', '/test/path', 'Test project for API test', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
    const projectId = testProject.getId();

    // Step 2: Create session using Session.create (inherits provider from project)
    const session = Session.create({
      name: 'Message Test Session',
      projectId,
    });
    const sessionId = session.getId();

    // Step 3: Spawn agent via SessionService (this is where E2E test fails)
    try {
      const session = await sessionService.getSession(sessionId as ThreadId);
      expect(session).toBeDefined();
      const agent = session!.spawnAgent({
        name: 'Message Agent',
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      });

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
      const testProject = Project.create(`Test Project ${i}`, '/test/path', 'Test project', {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      });
      const projectId = testProject.getId();

      const sessionData = Session.create({
        name: `Test Session ${i}`,
        projectId,
      });
      const sessionId = sessionData.getId() as string;

      const sessionForAgent = await sessionService.getSession(sessionId as ThreadId);
      expect(sessionForAgent).toBeDefined();
      const _agent = sessionForAgent!.spawnAgent({
        name: `Test Agent ${i}`,
        providerInstanceId: providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      });
      expect(_agent).toBeDefined();
    }
  });

  it('should test session service state after clearing', async () => {
    // Create session and agent
    const testProject = Project.create('Test Project', '/test/path', 'Test project', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
    const projectId = testProject.getId();

    const sessionData = Session.create({
      name: 'Test Session',
      projectId,
    });
    const sessionId = sessionData.getId() as string;

    const sessionForAgent = await sessionService.getSession(sessionId as ThreadId);
    expect(sessionForAgent).toBeDefined();
    const _agent = sessionForAgent!.spawnAgent({
      name: 'Test Agent',
      providerInstanceId: providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    // Clear active sessions
    sessionService.clearActiveSessions();

    // Try to spawn another agent (should work since session can be reconstructed)
    const sessionForSecondAgent = await sessionService.getSession(sessionId as ThreadId);
    expect(sessionForSecondAgent).toBeDefined();
    const _secondAgent = sessionForSecondAgent!.spawnAgent({
      name: 'Another Agent',
      providerInstanceId: providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
  });

  it('should test session reconstruction after clearing', async () => {
    // Create session and agent
    const testProject = Project.create('Test Project', '/test/path', 'Test project', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
    const projectId = testProject.getId();

    const sessionData = Session.create({
      name: 'Test Session',
      projectId,
    });
    const sessionId = sessionData.getId() as string;

    const sessionForAgent = await sessionService.getSession(sessionId as ThreadId);
    expect(sessionForAgent).toBeDefined();
    const _agent = sessionForAgent!.spawnAgent({
      name: 'Test Agent',
      providerInstanceId: providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    // Clear active sessions
    sessionService.clearActiveSessions();

    // Try to get session (should reconstruct)
    const reconstructedSession = await sessionService.getSession(sessionId as ThreadId);

    if (reconstructedSession) {
      const _agents = reconstructedSession.getAgents();
      expect(_agents).toBeDefined();

      // Try to spawn another agent
      const _newAgent = reconstructedSession.spawnAgent({
        name: 'New Agent',
        providerInstanceId: providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      });
      expect(_newAgent).toBeDefined();
    } else {
      expect(reconstructedSession).toBeDefined();
    }
  });
});
