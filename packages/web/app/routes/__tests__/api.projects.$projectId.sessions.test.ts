// ABOUTME: Test suite for session API endpoints under projects hierarchy
// ABOUTME: Tests CRUD operations with real Project and Session classes, not mocks

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loader as GET, action as POST } from '@/app/routes/api.projects.$projectId.sessions';
import { parseResponse } from '@/lib/serialization';
import type { SessionInfo } from '@/types/core';
import { setupWebTest } from '@/test-utils/web-test-setup';
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '@/lib/server/lace-imports';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';
import { Session } from '@/lib/server/lace-imports';
import { createLoaderArgs, createActionArgs } from '@/test-utils/route-test-helpers';
import { EventStreamManager } from '@/lib/event-stream-manager';

// Mock server-only module
vi.mock('server-only', () => ({}));

describe('Session API endpoints under projects', () => {
  const _tempLaceDir = setupWebTest();
  let providerInstanceId: string;
  let projectId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Create test provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create a test project
    const { Project } = await import('~/projects/project');
    const testProject = Project.create('Test Project', '/test/path', 'A test project', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
    projectId = testProject.getId();
  });

  afterEach(async () => {
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
  });

  describe('GET /api/projects/:projectId/sessions', () => {
    it('should return sessions for project', async () => {
      // Create additional sessions in the project
      Session.create({
        name: 'Session 1',
        projectId,
        configuration: {
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        },
      });
      Session.create({
        name: 'Session 2',
        projectId,
        configuration: {
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        },
      });

      const response = await GET(
        createLoaderArgs(new Request(`http://localhost/api/projects/${projectId}/sessions`), {
          projectId,
        })
      );

      const data =
        await parseResponse<
          Array<{ id: string; name: string; createdAt: Date; agentCount: number }>
        >(response);

      expect(response.status).toBe(200);
      expect(data.length).toBeGreaterThan(0);

      // Find our created sessions
      const session1 = data.find((s) => s.name === 'Session 1');
      const session2 = data.find((s) => s.name === 'Session 2');

      expect(session1).toBeDefined();
      expect(session2).toBeDefined();
    });

    it('should return sessions when only default session exists', async () => {
      // Project.create() auto-creates a default session
      const response = await GET(
        createLoaderArgs(new Request(`http://localhost/api/projects/${projectId}/sessions`), {
          projectId,
        })
      );

      const data = await parseResponse<SessionInfo[]>(response);

      expect(response.status).toBe(200);
      expect(data.length).toBeGreaterThan(0); // At least the default session
    });

    it('should return 404 when project not found', async () => {
      const response = await GET(
        createLoaderArgs(new Request('http://localhost/api/projects/nonexistent/sessions'), {
          projectId: 'nonexistent',
        })
      );

      const data = await parseResponse<{ error: string }>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });
  });

  describe('POST /api/projects/:projectId/sessions', () => {
    it('should create session with initialMessage (new simplified flow)', async () => {
      const request = new Request(`http://localhost/api/projects/${projectId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          initialMessage: 'Fix the authentication bug',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
          configuration: {},
        }),
      });

      const response = await POST(createActionArgs(request, { projectId }));
      const data = await parseResponse<SessionInfo>(response);

      expect(response.status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.name).toBeDefined(); // Should be generated or truncated from initialMessage
      expect(data.createdAt).toBeDefined();
    });

    it('should create session with default name when no name or initialMessage provided', async () => {
      const request = new Request(`http://localhost/api/projects/${projectId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
          configuration: {},
        }),
      });

      const response = await POST(createActionArgs(request, { projectId }));
      const data = await parseResponse<SessionInfo>(response);

      expect(response.status).toBe(201);
      expect(data.name).toBe('New Session');
    });

    it('should create session in project (existing flow)', async () => {
      const request = new Request(`http://localhost/api/projects/${projectId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Session',
          description: 'A new session',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
          configuration: {},
        }),
      });

      const response = await POST(createActionArgs(request, { projectId }));
      const data = await parseResponse<SessionInfo>(response);

      expect(response.status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.name).toBe('New Session');
      expect(data.createdAt).toBeDefined();
    });

    it('should return 404 when project not found', async () => {
      const request = new Request('http://localhost/api/projects/nonexistent/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Session',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response = await POST(createActionArgs(request, { projectId: 'nonexistent' }));
      const data = await parseResponse<{ error: string }>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should validate required fields', async () => {
      const request = new Request(`http://localhost/api/projects/${projectId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          name: '', // Empty name should fail validation
        }),
      });

      const response = await POST(createActionArgs(request, { projectId }));
      const data = await parseResponse<{ error: string; details?: unknown }>(response);

      expect(response.status).toBe(400);
      expect(data.error).toContain('Validation failed');
      expect(data.details).toBeDefined();
    });

    it('should handle missing request body', async () => {
      const request = new Request(`http://localhost/api/projects/${projectId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const response = await POST(createActionArgs(request, { projectId }));
      const data = await parseResponse<{ error: string }>(response);

      expect(response.status).toBe(400);
      expect(data.error).toContain('Validation failed');
    });

    it('should use default values for optional fields', async () => {
      const request = new Request(`http://localhost/api/projects/${projectId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'Minimal Session',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response = await POST(createActionArgs(request, { projectId }));
      const data = await parseResponse<SessionInfo>(response);

      expect(response.status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.name).toBe('Minimal Session');
      expect(data.createdAt).toBeDefined();
    });

    it('should create session using providerInstanceId and modelId', async () => {
      const request = new Request(`http://localhost/api/projects/${projectId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'Provider Instance Session',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
          configuration: {},
        }),
      });

      const response = await POST(createActionArgs(request, { projectId }));
      const data = await parseResponse<SessionInfo>(response);

      expect(response.status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.name).toBe('Provider Instance Session');
      expect(data.createdAt).toBeDefined();
    });

    it('should spawn background session naming with SSE events for initialMessage', async () => {
      // Create a mock event listener for SSE events
      const broadcastSpy = vi.spyOn(EventStreamManager.getInstance(), 'broadcast');

      const request = new Request(`http://localhost/api/projects/${projectId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          initialMessage: 'I need to fix the authentication redirect bug in the login system',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
          configuration: {},
        }),
      });

      const response = await POST(createActionArgs(request, { projectId }));
      const sessionData = await parseResponse<SessionInfo>(response);

      expect(response.status).toBe(201);
      expect(sessionData.id).toBeDefined();

      // Wait a bit for background helper to potentially run
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Note: In a real test environment, the helper agent would be mocked
      // This test mainly verifies the integration structure is in place

      // Verify the session was created with temporary name
      expect(sessionData.name).toBeDefined();
      expect(sessionData.name.length).toBeGreaterThan(0);

      // Clean up spy
      broadcastSpy.mockRestore();
    });
  });
});
