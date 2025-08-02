// ABOUTME: E2E tests for web API endpoints
// ABOUTME: Tests full API workflow from session creation to message sending using real services

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock only external dependencies, not core functionality

vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: () => ({
    requestApproval: vi.fn().mockResolvedValue('allow_once'),
  }),
}));

// Import the real API route handlers after mocks
import { GET as listSessions } from '@/app/api/sessions/route';
import { GET as getSession } from '@/app/api/sessions/[sessionId]/route';
import { POST as spawnAgent } from '@/app/api/sessions/[sessionId]/agents/route';
import { POST as sendMessage } from '@/app/api/threads/[threadId]/message/route';
import { POST as createProjectSession } from '@/app/api/projects/[projectId]/sessions/route';
import { getSessionService, SessionService } from '@/lib/server/session-service';
import { Project } from '@/lib/server/lace-imports';
import type { ApiSession as SessionType } from '@/types/api';
import type { ThreadId } from '@/types/core';
import { asThreadId } from '@/lib/server/core-types';

describe('API Endpoints E2E Tests', () => {
  let sessionService: SessionService;

  beforeEach(() => {
    setupTestPersistence();

    // Set up environment for session service
    process.env = {
      ...process.env,
      ANTHROPIC_KEY: 'test-key',
      LACE_DB_PATH: ':memory:',
    };

    sessionService = getSessionService();
  });

  afterEach(async () => {
    // CRITICAL: Stop agents BEFORE closing database in teardownTestPersistence
    if (sessionService) {
      await sessionService.stopAllAgents();
      sessionService.clearActiveSessions();
    }
    // Clear persistence to reset database state
    teardownTestPersistence();
  });

  afterAll(async () => {
    // No need to stop agents again - they were already stopped in afterEach
    global.sessionService = undefined;
  });

  describe('Session Management API Flow', () => {
    it('should create session via API', async () => {
      // First create a project
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();

      const request = new NextRequest(`http://localhost/api/projects/${projectId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'API Test Session',
          description: 'Test session description',
          configuration: {
            provider: 'anthropic',
            model: 'claude-3-5-haiku-20241022',
          },
        }),
      });

      const response = await createProjectSession(request, {
        params: Promise.resolve({ projectId }),
      });
      expect(response.status).toBe(201);

      const responseData: unknown = await response.json();
      const data = responseData as { session: SessionType };
      expect(data.session.name).toBe('API Test Session');
      expect(data.session.id).toBeDefined();

      // Verify session was actually created in the service
      const sessions = await sessionService.listSessions();
      expect(sessions).toHaveLength(2); // 1 auto-created + 1 explicitly created
      expect(sessions.find((s) => s.name === 'API Test Session')).toBeDefined();
    });

    it('should list sessions via API', async () => {
      // Create a project and session first
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();
      await sessionService.createSession(
        'Listable Session',
        'anthropic',
        'claude-3-5-haiku-20241022',
        projectId
      );

      // List sessions via API
      const listRequest = new NextRequest('http://localhost/api/sessions', {
        method: 'GET',
      });

      const response = await listSessions(listRequest);
      expect(response.status).toBe(200);

      const responseData: unknown = await response.json();
      const data = responseData as { sessions: SessionType[] };
      expect(data.sessions).toHaveLength(2); // 1 auto-created + 1 explicitly created
      expect(data.sessions.find((s) => s.name === 'Listable Session')).toBeDefined();
    });

    it('should get specific session via API', async () => {
      // Create a project and session first
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();
      const session = await sessionService.createSession(
        'Specific Session',
        'anthropic',
        'claude-3-5-haiku-20241022',
        projectId
      );
      const sessionId = session.id as string;

      // Get specific session via API
      const getRequest = new NextRequest(`http://localhost/api/sessions/${sessionId}`, {
        method: 'GET',
      });

      const response = await getSession(getRequest, {
        params: Promise.resolve({ sessionId }),
      });
      expect(response.status).toBe(200);

      const responseData: unknown = await response.json();
      const data = responseData as { session: SessionType };
      expect(data.session.name).toBe('Specific Session');
      expect(data.session.id).toBe(sessionId);
    });
  });

  describe('Agent Management API Flow', () => {
    let sessionId: string;

    beforeEach(async () => {
      // Create a session for agent tests using real service
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();
      const session = await sessionService.createSession(
        'Agent Test Session',
        'anthropic',
        'claude-3-5-haiku-20241022',
        projectId
      );
      sessionId = session.id as string;
    });

    it('should spawn agent via API', async () => {
      const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'API Agent',
          provider: 'anthropic',
          model: 'claude-3-5-haiku-20241022',
        }),
      });

      const response = await spawnAgent(request, { params: Promise.resolve({ sessionId }) });
      expect(response.status).toBe(201);

      const responseData: unknown = await response.json();
      const data = responseData as {
        agent: { name: string; provider: string; model: string; threadId: string };
      };
      expect(data.agent.name).toBe('API Agent');
      expect(data.agent.provider).toBe('anthropic');
      expect(data.agent.threadId).toMatch(new RegExp(`^${sessionId}\\.\\d+$`));

      // Verify agent was actually added to the session
      const threadId: ThreadId = sessionId as ThreadId;
      const updatedSession = await sessionService.getSession(threadId);
      expect(updatedSession).toBeDefined();
      const agents = updatedSession!.getAgents();
      expect(agents).toHaveLength(2); // Coordinator + spawned agent
      expect(agents.find((a) => a.name === 'API Agent')).toBeDefined();
    });

    it('should reflect spawned agent in session', async () => {
      // Spawn an agent via real service
      const threadId: ThreadId = sessionId as ThreadId;
      const session = await sessionService.getSession(threadId);
      expect(session).toBeDefined();
      const _agent = session!.spawnAgent('Reflected Agent', 'anthropic');

      // Get session via API to check agents
      const getRequest = new NextRequest(`http://localhost/api/sessions/${sessionId}`, {
        method: 'GET',
      });

      const response = await getSession(getRequest, {
        params: Promise.resolve({ sessionId: sessionId }),
      });
      const responseData: unknown = await response.json();
      const data = responseData as { session: SessionType };

      expect(data.session.agents || []).toHaveLength(2); // Coordinator + spawned agent
      expect(data.session.agents?.find((a) => a.name === 'Reflected Agent')).toBeDefined();
    });
  });

  describe('Message Sending API Flow', () => {
    let sessionId: string;
    let agentThreadId: string;

    beforeEach(async () => {
      // Create session and agent fresh for each test to avoid state pollution
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();
      const session = await sessionService.createSession(
        'Message Test Session',
        'anthropic',
        'claude-3-5-haiku-20241022',
        projectId
      );
      sessionId = session.id as string;

      const threadId: ThreadId = sessionId as ThreadId;
      const sessionInstance = await sessionService.getSession(threadId);
      expect(sessionInstance).toBeDefined();
      const agent = sessionInstance!.spawnAgent('Message Agent', 'anthropic');
      agentThreadId = agent.threadId as string;
    });

    it('should accept message via API', async () => {
      // Debug the session and agent state

      // Check if session exists and get agent through session
      const threadId: ThreadId = sessionId as ThreadId;
      const session = await sessionService.getSession(threadId);
      if (!session) {
        throw new Error(`Session not found for sessionId: ${sessionId}`);
      }

      // Ensure the agent is properly available
      const agent = session.getAgent(asThreadId(agentThreadId));
      if (!agent) {
        throw new Error(
          `Agent not found for threadId: ${agentThreadId}. Cannot proceed with message test.`
        );
      }

      const request = new NextRequest(`http://localhost/api/threads/${agentThreadId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello, agent!' }),
      });

      const response = await sendMessage(request, {
        params: Promise.resolve({ threadId: agentThreadId }),
      });

      if (response.status !== 202) {
        const errorResponseData: unknown = await response.json();
        const _errorData = errorResponseData as { error: string };
      }
      expect(response.status).toBe(202);

      const responseData: unknown = await response.json();
      const data = responseData as { status: string; threadId: string };
      expect(data.status).toBe('accepted');
      expect(data.threadId).toBe(agentThreadId);
    });

    it('should handle invalid thread ID', async () => {
      const request = new NextRequest(`http://localhost/api/threads/invalid-thread-id/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello, agent!' }),
      });

      const response = await sendMessage(request, {
        params: Promise.resolve({ threadId: 'invalid-thread-id' }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid session ID in getSession', async () => {
      const request = new NextRequest('http://localhost/api/sessions/invalid-id', {
        method: 'GET',
      });

      const response = await getSession(request, {
        params: Promise.resolve({ sessionId: 'invalid-id' }),
      });
      expect(response.status).toBe(400); // Invalid format returns validation error
    });

    it('should handle malformed JSON in createSession', async () => {
      // Test the project-based session creation with malformed JSON
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();

      const request = new NextRequest(`http://localhost/api/projects/${projectId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      const response = await createProjectSession(request, {
        params: Promise.resolve({ projectId }),
      });
      expect(response.status).toBe(500); // JSON parsing error is caught by outer try-catch
    });

    it('should handle agent spawning in non-existent session', async () => {
      const request = new NextRequest('http://localhost/api/sessions/non-existent/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Agent',
          provider: 'anthropic',
          model: 'claude-3-5-haiku-20241022',
        }),
      });

      const response = await spawnAgent(request, {
        params: Promise.resolve({ sessionId: 'non-existent' }),
      });
      expect(response.status).toBe(400); // Invalid format returns validation error
    });
  });
});
