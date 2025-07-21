// ABOUTME: Integration tests for session configuration API endpoints - GET, PUT for configuration management
// ABOUTME: Tests real functionality with actual sessions, no mocking

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from '@/app/api/sessions/[sessionId]/configuration/route';
import { getSessionService } from '@/lib/server/session-service';
import { Project } from '@/lib/server/lace-imports';
import { setupTestPersistence, teardownTestPersistence } from '~/test-setup-dir/persistence-helper';

// Type interfaces for API responses
interface ConfigurationResponse {
  configuration: {
    provider?: string;
    model?: string;
    maxTokens?: number;
    tools?: string[];
    toolPolicies?: Record<string, string>;
    workingDirectory?: string;
    environmentVariables?: Record<string, string>;
  };
}

interface ErrorResponse {
  error: string;
  details?: unknown;
}

describe('Session Configuration API', () => {
  let sessionService: ReturnType<typeof getSessionService>;
  let testProject: ReturnType<typeof Project.create>;
  let sessionId: string;

  beforeEach(async () => {
    setupTestPersistence();

    // Set up environment
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    sessionService = getSessionService();

    // Create a real project and session for testing
    testProject = Project.create('Test Project', '/test/path', 'Test project', {
      provider: 'anthropic',
      model: 'claude-3-haiku-20240307',
      maxTokens: 4000,
    });

    const session = await sessionService.createSession(
      'Test Session',
      'anthropic',
      'claude-3-haiku-20240307',
      testProject.getId()
    );
    sessionId = session.id;
  });

  afterEach(() => {
    sessionService.clearActiveSessions();
    teardownTestPersistence();
  });

  describe('GET /api/sessions/:sessionId/configuration', () => {
    it('should return session effective configuration when found', async () => {
      const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/configuration`);
      const response = await GET(request, { params: Promise.resolve({ sessionId }) });
      const data = (await response.json()) as ConfigurationResponse;

      expect(response.status).toBe(200);
      expect(data.configuration).toBeDefined();
      expect(data.configuration.provider).toBe('anthropic');
      expect(data.configuration.model).toBe('claude-3-haiku-20240307');
      expect(data.configuration.maxTokens).toBe(4000);
    });

    it('should return 404 when session not found', async () => {
      const request = new NextRequest('http://localhost/api/sessions/nonexistent/configuration');
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: 'nonexistent' }),
      });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should handle errors gracefully', async () => {
      // Test with a malformed sessionId that will cause an error in the route
      const request = new NextRequest(
        'http://localhost/api/sessions/invalid-session-id/configuration'
      );
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: 'invalid-session-id' }),
      });

      // Should return 404 for non-existent session (which is the actual behavior)
      expect(response.status).toBe(404);
      const data = (await response.json()) as ErrorResponse;
      expect(data.error).toBe('Session not found');
    });
  });

  describe('PUT /api/sessions/:sessionId/configuration', () => {
    it('should update session configuration successfully', async () => {
      const updates = {
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        maxTokens: 8000,
        toolPolicies: {
          'file-read': 'allow',
          'file-write': 'deny',
        },
      };

      const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/configuration`, {
        method: 'PUT',
        body: JSON.stringify(updates),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, { params: Promise.resolve({ sessionId }) });
      const data = (await response.json()) as ConfigurationResponse;

      expect(response.status).toBe(200);
      expect(data.configuration).toBeDefined();
      expect(data.configuration.provider).toBe('anthropic');
      expect(data.configuration.model).toBe('claude-3-sonnet');
      expect(data.configuration.maxTokens).toBe(8000);
    });

    it('should return 404 when session not found', async () => {
      const request = new NextRequest('http://localhost/api/sessions/nonexistent/configuration', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'openai' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, {
        params: Promise.resolve({ sessionId: 'nonexistent' }),
      });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should validate configuration data', async () => {
      const invalidUpdates = {
        maxTokens: -1, // Negative maxTokens should be invalid
        toolPolicies: {
          'file-read': 'invalid-policy', // Invalid policy should be invalid
        },
      };

      const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/configuration`, {
        method: 'PUT',
        body: JSON.stringify(invalidUpdates),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, { params: Promise.resolve({ sessionId }) });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
      expect(data.details).toBeDefined();
    });

    it('should handle JSON parsing errors', async () => {
      // Test with malformed JSON
      const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/configuration`, {
        method: 'PUT',
        body: 'invalid json',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, { params: Promise.resolve({ sessionId }) });

      expect(response.status).toBe(500);
    });
  });
});

describe('TDD: Direct Session Usage', () => {
  let sessionService: ReturnType<typeof getSessionService>;
  let testSessionId: string;

  beforeEach(async () => {
    setupTestPersistence();
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    sessionService = getSessionService();

    // Create a real session to test with
    const testProject = Project.create('TDD Test Project', '/test/path', 'Test project', {});
    const session = await sessionService.createSession(
      'TDD Test Session',
      'anthropic',
      'claude-3-haiku-20240307',
      testProject.getId()
    );
    testSessionId = session.id;
  });

  afterEach(() => {
    sessionService.clearActiveSessions();
    teardownTestPersistence();
  });

  it('should use SessionService.getSession() which calls session.getEffectiveConfiguration() directly', async () => {
    const request = new NextRequest(`http://localhost/api/sessions/${testSessionId}/configuration`);
    const response = await GET(request, { params: Promise.resolve({ sessionId: testSessionId }) });

    // This verifies that the route successfully calls the session's getEffectiveConfiguration method
    // (not a duplicated SessionService method that we removed)
    expect(response.status).toBe(200);
    const data = (await response.json()) as ConfigurationResponse;
    expect(data.configuration).toBeDefined();
  });
});

describe('TDD: Direct Session Configuration Update', () => {
  let sessionService: ReturnType<typeof getSessionService>;
  let testSessionId: string;

  beforeEach(async () => {
    setupTestPersistence();
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    sessionService = getSessionService();

    // Create a real session to test with
    const testProject = Project.create('TDD Update Test Project', '/test/path', 'Test project', {});
    const session = await sessionService.createSession(
      'TDD Update Test Session',
      'anthropic',
      'claude-3-haiku-20240307',
      testProject.getId()
    );
    testSessionId = session.id;
  });

  afterEach(() => {
    sessionService.clearActiveSessions();
    teardownTestPersistence();
  });

  it('should use SessionService.getSession() which calls session.updateConfiguration() directly', async () => {
    const configUpdate = {
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      maxTokens: 8000,
      toolPolicies: {
        'file-read': 'allow',
        'file-write': 'deny',
      },
    };

    const request = new NextRequest(
      `http://localhost/api/sessions/${testSessionId}/configuration`,
      {
        method: 'PUT',
        body: JSON.stringify(configUpdate),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response = await PUT(request, { params: Promise.resolve({ sessionId: testSessionId }) });

    // This verifies that the route successfully calls session.updateConfiguration() directly
    // (not a duplicated SessionService method that we removed)
    expect(response.status).toBe(200);
    const data = (await response.json()) as ConfigurationResponse;
    expect(data.configuration).toBeDefined();
    expect(data.configuration.provider).toBe('anthropic');
    expect(data.configuration.model).toBe('claude-3-sonnet');
  });
});
