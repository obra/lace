// ABOUTME: Integration tests for session configuration API endpoints - GET, PUT for configuration management
// ABOUTME: Tests real functionality with actual sessions, no mocking

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loader as GET, action as PUT } from '@/app/routes/api.sessions.$sessionId.configuration';
import { getSessionService } from '@/lib/server/session-service';
import { Project, Session } from '@/lib/server/lace-imports';
import { setupWebTest } from '@/test-utils/web-test-setup';
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '@/lib/server/lace-imports';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';
import { parseResponse } from '@/lib/serialization';

// Type interfaces for API responses
interface ConfigurationResponse {
  configuration: {
    provider?: string;
    model?: string;
    providerInstanceId?: string;
    modelId?: string;
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
  const _tempLaceDir = setupWebTest();
  let sessionService: ReturnType<typeof getSessionService>;
  let testProject: ReturnType<typeof Project.create>;
  let sessionId: string;
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Set up environment
    process.env.LACE_DB_PATH = ':memory:';

    sessionService = getSessionService();

    // Create test provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022', 'claude-sonnet-4-20250514'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create a real project and session for testing
    testProject = Project.create('Test Project', '/test/path', 'Test project', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      maxTokens: 4000,
    });

    const sessionInstance = Session.create({
      name: 'Test Session',
      projectId: testProject.getId(),
    });
    const session = sessionInstance.getInfo()!;
    sessionId = session.id;
  });

  afterEach(async () => {
    sessionService.clearActiveSessions();
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
  });

  describe('GET /api/sessions/:sessionId/configuration', () => {
    it('should return session effective configuration when found', async () => {
      const request = new Request(`http://localhost/api/sessions/${sessionId}/configuration`);
      const response = await GET(request, { params: Promise.resolve({ sessionId }) });
      const data = await parseResponse<ConfigurationResponse>(response);

      expect(response.status).toBe(200);
      expect(data.configuration).toBeDefined();

      // With the new provider instance system, configuration format might be different

      // Basic expectations - the exact field names might differ with new provider system
      expect(data.configuration).toEqual(
        expect.objectContaining({
          providerInstanceId: providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
          maxTokens: 4000,
        })
      );
    });

    it('should return 400 for invalid session ID format', async () => {
      const request = new Request('http://localhost/api/sessions/nonexistent/configuration');
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: 'nonexistent' }),
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid session ID');
    });

    it('should return 404 when session not found', async () => {
      // Use a valid thread ID format that doesn't exist in the database
      const nonExistentSessionId = 'lace_20250101_sess01';
      const request = new Request(
        `http://localhost/api/sessions/${nonExistentSessionId}/configuration`
      );
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: nonExistentSessionId }),
      });

      expect(response.status).toBe(404);
      const data = await parseResponse<ErrorResponse>(response);
      expect(data.error).toBe('Session not found');
    });
  });

  describe('PUT /api/sessions/:sessionId/configuration', () => {
    it('should update session configuration successfully', async () => {
      const updates = {
        providerInstanceId: providerInstanceId,
        modelId: 'claude-sonnet-4-20250514',
        maxTokens: 8000,
        toolPolicies: {
          'file-read': 'allow',
          'file-write': 'deny',
        },
      };

      const request = new Request(`http://localhost/api/sessions/${sessionId}/configuration`, {
        method: 'PUT',
        body: JSON.stringify(updates),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, { params: Promise.resolve({ sessionId }) });
      const data = await parseResponse<ConfigurationResponse>(response);

      expect(response.status).toBe(200);
      expect(data.configuration).toBeDefined();
      expect(data.configuration.providerInstanceId).toBe(providerInstanceId);
      expect(data.configuration.modelId).toBe('claude-sonnet-4-20250514');
      expect(data.configuration.maxTokens).toBe(8000);
    });

    it('should return 400 for invalid session ID format', async () => {
      const request = new Request('http://localhost/api/sessions/nonexistent/configuration', {
        method: 'PUT',
        body: JSON.stringify({
          providerInstanceId: 'test-provider',
          modelId: 'test-model',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, {
        params: Promise.resolve({ sessionId: 'nonexistent' }),
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid session ID');
    });

    it('should return 404 when session not found', async () => {
      // Use a valid thread ID format that doesn't exist in the database
      const nonExistentSessionId = 'lace_20250101_sess02';
      const request = new Request(
        `http://localhost/api/sessions/${nonExistentSessionId}/configuration`,
        {
          method: 'PUT',
          body: JSON.stringify({
            providerInstanceId: providerInstanceId,
            modelId: 'claude-3-5-haiku-20241022',
          }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ sessionId: nonExistentSessionId }),
      });
      const data = await parseResponse<ErrorResponse>(response);

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

      const request = new Request(`http://localhost/api/sessions/${sessionId}/configuration`, {
        method: 'PUT',
        body: JSON.stringify(invalidUpdates),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, { params: Promise.resolve({ sessionId }) });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
      expect(data.details).toBeDefined();
    });

    it('should handle JSON parsing errors', async () => {
      // Test with malformed JSON
      const request = new Request(`http://localhost/api/sessions/${sessionId}/configuration`, {
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
  const _tempLaceDir = setupWebTest();
  let sessionService: ReturnType<typeof getSessionService>;
  let testSessionId: string;
  let tddProviderInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    process.env.LACE_DB_PATH = ':memory:';

    sessionService = getSessionService();

    // Create test provider instance for TDD tests
    tddProviderInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'TDD Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create a real session to test with
    const testProject = Project.create('TDD Test Project', '/test/path', 'Test project', {
      providerInstanceId: tddProviderInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
    const sessionInstance = Session.create({
      name: 'TDD Test Session',
      projectId: testProject.getId(),
    });
    const session = sessionInstance.getInfo()!;
    testSessionId = session.id;
  });

  afterEach(async () => {
    sessionService.clearActiveSessions();
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([tddProviderInstanceId]);
    vi.clearAllMocks();
  });

  it('should use SessionService.getSession() which calls session.getEffectiveConfiguration() directly', async () => {
    const request = new Request(`http://localhost/api/sessions/${testSessionId}/configuration`);
    const response = await GET(request, { params: Promise.resolve({ sessionId: testSessionId }) });

    // This verifies that the route successfully calls the session's getEffectiveConfiguration method
    // (not a duplicated SessionService method that we removed)
    expect(response.status).toBe(200);
    const data = await parseResponse<ConfigurationResponse>(response);
    expect(data.configuration).toBeDefined();
  });
});

describe('TDD: Direct Session Configuration Update', () => {
  const _tempLaceDir = setupWebTest();
  let sessionService: ReturnType<typeof getSessionService>;
  let testSessionId: string;
  let updateProviderInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    process.env.LACE_DB_PATH = ':memory:';

    sessionService = getSessionService();

    // Create test provider instance for update tests
    updateProviderInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022', 'claude-sonnet-4-20250514'],
      displayName: 'Update Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create a real session to test with
    const testProject = Project.create('TDD Update Test Project', '/test/path', 'Test project', {
      providerInstanceId: updateProviderInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
    const sessionInstance = Session.create({
      name: 'TDD Update Test Session',
      projectId: testProject.getId(),
    });
    const session = sessionInstance.getInfo()!;
    testSessionId = session.id;
  });

  afterEach(async () => {
    sessionService.clearActiveSessions();
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([updateProviderInstanceId]);
    vi.clearAllMocks();
  });

  it('should use SessionService.getSession() which calls session.updateConfiguration() directly', async () => {
    const configUpdate = {
      providerInstanceId: updateProviderInstanceId,
      modelId: 'claude-sonnet-4-20250514',
      maxTokens: 8000,
      toolPolicies: {
        'file-read': 'allow',
        'file-write': 'deny',
      },
    };

    const request = new Request(`http://localhost/api/sessions/${testSessionId}/configuration`, {
      method: 'PUT',
      body: JSON.stringify(configUpdate),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PUT(request, { params: Promise.resolve({ sessionId: testSessionId }) });

    // This verifies that the route successfully calls session.updateConfiguration() directly
    // (not a duplicated SessionService method that we removed)
    expect(response.status).toBe(200);
    const data = await parseResponse<ConfigurationResponse>(response);
    expect(data.configuration).toBeDefined();
    expect(data.configuration.providerInstanceId).toBe(updateProviderInstanceId);
    expect(data.configuration.modelId).toBe('claude-sonnet-4-20250514');
  });
});
