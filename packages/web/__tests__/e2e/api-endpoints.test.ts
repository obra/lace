// ABOUTME: E2E tests for web API endpoints
// ABOUTME: Tests full API workflow from session creation to message sending using real services

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock only external dependencies, not core functionality
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
    requestApproval: vi.fn().mockResolvedValue('allow_once'),
  }),
}));

// Import the real API route handlers after mocks
import { POST as createSession, GET as listSessions } from '@/app/api/sessions/route';
import { GET as getSession } from '@/app/api/sessions/[sessionId]/route';
import { POST as spawnAgent } from '@/app/api/sessions/[sessionId]/agents/route';
import { POST as sendMessage } from '@/app/api/threads/[threadId]/message/route';
import { getSessionService } from '@/lib/server/session-service';
import type { Session as SessionType, ThreadId } from '@/types/api';

describe('API Endpoints E2E Tests', () => {
  let sessionService: ReturnType<typeof getSessionService>;

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

  afterEach(() => {
    sessionService.clearActiveSessions();
    // Clear global singleton
    global.sessionService = undefined;
    teardownTestPersistence();
  });

  describe('Session Management API Flow', () => {
    it('should create session via API', async () => {
      const request = new NextRequest('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'API Test Session',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
      });

      const response = await createSession(request);
      expect(response.status).toBe(201);

      const data = (await response.json()) as { session: SessionType };
      expect(data.session.name).toBe('API Test Session');
      expect(data.session.id).toBeDefined();

      // Verify session was actually created in the service
      const sessions = await sessionService.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.name).toBe('API Test Session');
    });

    it('should list sessions via API', async () => {
      // Create a session first using the real service
      await sessionService.createSession('Listable Session');

      // List sessions via API
      const listRequest = new NextRequest('http://localhost/api/sessions', {
        method: 'GET',
      });

      const response = await listSessions(listRequest);
      expect(response.status).toBe(200);

      const data = (await response.json()) as { sessions: SessionType[] };
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0]?.name).toBe('Listable Session');
    });

    it('should get specific session via API', async () => {
      // Create a session using real service
      const session = await sessionService.createSession('Specific Session');
      const sessionId = session.id as ThreadId;

      // Get specific session via API
      const getRequest = new NextRequest(`http://localhost/api/sessions/${sessionId}`, {
        method: 'GET',
      });

      const response = await getSession(getRequest, {
        params: Promise.resolve({ sessionId: sessionId as string }),
      });
      expect(response.status).toBe(200);

      const data = (await response.json()) as { session: SessionType };
      expect(data.session.name).toBe('Specific Session');
      expect(data.session.id).toBe(sessionId);
    });
  });

  describe('Agent Management API Flow', () => {
    let sessionId: string;

    beforeEach(async () => {
      // Create a session for agent tests using real service
      const session = await sessionService.createSession('Agent Test Session');
      sessionId = session.id as string;
    });

    it('should spawn agent via API', async () => {
      const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'API Agent',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
      });

      const response = await spawnAgent(request, { params: Promise.resolve({ sessionId }) });
      expect(response.status).toBe(201);

      const data = (await response.json()) as {
        agent: { name: string; provider: string; model: string; threadId: string };
      };
      expect(data.agent.name).toBe('API Agent');
      expect(data.agent.provider).toBe('anthropic');
      expect(data.agent.threadId).toMatch(new RegExp(`^${sessionId}\\.\\d+$`));

      // Verify agent was actually added to the session
      const updatedSession = await sessionService.getSession(sessionId as ThreadId);
      expect(updatedSession).toBeDefined();
      const agents = updatedSession!.getAgents();
      expect(agents).toHaveLength(2); // Coordinator + spawned agent
      expect(agents.find((a) => a.name === 'API Agent')).toBeDefined();
    });

    it('should reflect spawned agent in session', async () => {
      // Spawn an agent via real service
      const _agent = await sessionService.spawnAgent(
        sessionId as ThreadId,
        'Reflected Agent',
        'anthropic'
      );

      // Get session via API to check agents
      const getRequest = new NextRequest(`http://localhost/api/sessions/${sessionId}`, {
        method: 'GET',
      });

      const response = await getSession(getRequest, {
        params: Promise.resolve({ sessionId: sessionId }),
      });
      const data = (await response.json()) as { session: SessionType };

      expect(data.session.agents).toHaveLength(2); // Coordinator + spawned agent
      expect(data.session.agents.find((a) => a.name === 'Reflected Agent')).toBeDefined();
    });
  });

  describe('Message Sending API Flow', () => {
    let sessionId: string;
    let agentThreadId: string;

    beforeEach(async () => {
      // Create session and agent using real services
      const session = await sessionService.createSession('Message Test Session');
      sessionId = session.id as string;

      const agent = await sessionService.spawnAgent(
        sessionId as ThreadId,
        'Message Agent',
        'anthropic'
      );
      agentThreadId = agent.threadId as string;
    });

    it('should accept message via API', async () => {
      const request = new NextRequest(`http://localhost/api/threads/${agentThreadId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello, agent!' }),
      });

      const response = await sendMessage(request, {
        params: Promise.resolve({ threadId: agentThreadId }),
      });
      expect(response.status).toBe(202);

      const data = (await response.json()) as { status: string; threadId: string };
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
      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON in createSession', async () => {
      const request = new NextRequest('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      const response = await createSession(request);
      expect(response.status).toBe(500); // JSON parsing error is caught by outer try-catch
    });

    it('should handle agent spawning in non-existent session', async () => {
      const request = new NextRequest('http://localhost/api/sessions/non-existent/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Agent',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
      });

      const response = await spawnAgent(request, {
        params: Promise.resolve({ sessionId: 'non-existent' }),
      });
      expect(response.status).toBe(404);
    });
  });
});
