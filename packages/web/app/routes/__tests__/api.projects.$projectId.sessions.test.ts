// ABOUTME: Test suite for session API endpoints under projects hierarchy
// ABOUTME: Tests CRUD operations with real Project and Session classes, not mocks

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loader as GET,
  action as POST,
} from '@lace/web/app/routes/api.projects.$projectId.sessions';
import { parseResponse } from '@lace/web/lib/serialization';
import type { SessionInfo } from '@lace/web/types/core';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { createLoaderArgs, createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import { EventStreamManager } from '@lace/web/lib/event-stream-manager';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Project } from '@lace/web/lib/server/projects/project';
import {
  createEntTestConnection,
  deleteEntTestConnection,
} from '@lace/web/test-utils/ent-test-helpers';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';

// Mock server-only module
vi.mock('server-only', () => ({}));

describe('Session API endpoints under projects', () => {
  const context = setupWebTest();
  let providerInstanceId: string;
  let projectId: string;

  beforeEach(async () => {
    providerInstanceId = (await createEntTestConnection({ providerId: 'openai' })).connectionId;

    // Create a test project
    const testDir = join(context.tempProjectDir, 'sessions-test');
    await fs.mkdir(testDir, { recursive: true });

    const testProject = Project.create('Test Project', testDir, 'A test project', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
    projectId = testProject.getId();
  });

  afterEach(async () => {
    await shutdownSupervisorForTests();
    await deleteEntTestConnection(providerInstanceId);
    vi.clearAllMocks();
  });

  describe('GET /api/projects/:projectId/sessions', () => {
    it('should return sessions for project', async () => {
      // Create workspace sessions via the API so they are visible to the supervisor-backed loader
      await POST(
        createActionArgs(
          new Request(`http://localhost/api/projects/${projectId}/sessions`, {
            method: 'POST',
            body: JSON.stringify({
              name: 'Session 1',
              providerInstanceId,
              modelId: 'claude-3-5-haiku-20241022',
            }),
          }),
          { projectId }
        )
      );

      await POST(
        createActionArgs(
          new Request(`http://localhost/api/projects/${projectId}/sessions`, {
            method: 'POST',
            body: JSON.stringify({
              name: 'Session 2',
              providerInstanceId,
              modelId: 'claude-3-5-haiku-20241022',
            }),
          }),
          { projectId }
        )
      );

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

    it('should return empty array when no workspace sessions exist', async () => {
      const response = await GET(
        createLoaderArgs(new Request(`http://localhost/api/projects/${projectId}/sessions`), {
          projectId,
        })
      );

      const data = await parseResponse<SessionInfo[]>(response);

      expect(response.status).toBe(200);
      expect(data).toHaveLength(0);
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

    it('passes project MCP servers through ACP session creation', async () => {
      const project = Project.getById(projectId);
      expect(project).toBeDefined();
      project!.addMCPServer('project-test', {
        command: process.execPath,
        args: ['--version'],
        enabled: false,
        tools: {},
      });

      const supervisor = await getSupervisor();
      const createSpy = vi.spyOn(supervisor, 'createWorkspaceSession');
      const requestSpy = vi.spyOn(supervisor, 'agentRequest');

      const request = new Request(`http://localhost/api/projects/${projectId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'Project MCP Session',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response = await POST(createActionArgs(request, { projectId }));

      expect(response.status).toBe(201);
      expect(createSpy).toHaveBeenCalledWith(project!.getWorkingDirectory(), {
        mcpServers: [
          {
            name: 'project-test',
            command: process.execPath,
            args: ['--version'],
            enabled: false,
            tools: {},
          },
        ],
      });
      expect(requestSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'ent/session/configure',
          requestParams: expect.not.objectContaining({
            mcpServers: expect.anything(),
          }),
        })
      );
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
