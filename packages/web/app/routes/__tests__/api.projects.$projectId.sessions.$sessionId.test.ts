// ABOUTME: Integration tests for project-scoped workspace session API endpoint
// ABOUTME: Uses supervisor-backed workspace sessions (no SQLite session records)

import { describe, it, expect, afterEach } from 'vitest';
import {
  loader as GET,
  action as PATCH_OR_DELETE,
} from '@lace/web/app/routes/api.projects.$projectId.sessions.$sessionId';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { parseResponse } from '@lace/web/lib/serialization';
import { createLoaderArgs, createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import { Project } from '@lace/web/lib/server/projects/project';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';

// ✅ ESSENTIAL MOCK - Server-side module compatibility in test environment
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

interface ErrorResponse {
  error: string;
  details?: unknown;
}

describe('Project workspace session API', () => {
  const context = setupWebTest();

  afterEach(async () => {
    await shutdownSupervisorForTests();
  });

  it('GET returns workspace session when it belongs to project', async () => {
    const project = Project.create('Test Project', context.tempProjectDir);
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);
    await supervisor.updateWorkspaceSession(created.workspaceSessionId, {
      projectId: project.getId(),
      name: 'Test Session',
    });

    const response = await GET(
      createLoaderArgs(
        new Request(
          `http://localhost/api/projects/${project.getId()}/sessions/${created.workspaceSessionId}`
        ),
        {
          projectId: project.getId(),
          sessionId: created.workspaceSessionId,
        }
      )
    );

    const data = await parseResponse<{ id: string; name: string; projectId: string }>(response);

    expect(response.status).toBe(200);
    expect(data.id).toBe(created.workspaceSessionId);
    expect(data.name).toBe('Test Session');
    expect(data.projectId).toBe(project.getId());
  });

  it('GET returns 404 when project does not exist', async () => {
    const request = new Request(
      'http://localhost/api/projects/nonexistent/sessions/ws_00000000-0000-0000-0000-000000000000'
    );
    const response = await GET(
      createLoaderArgs(request, {
        projectId: 'nonexistent',
        sessionId: 'ws_00000000-0000-0000-0000-000000000000',
      })
    );
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Project not found');
  });

  it('GET returns 400 for invalid session ID', async () => {
    const project = Project.create('Test Project', context.tempProjectDir);

    const response = await GET(
      createLoaderArgs(new Request('http://localhost/api/projects/p/sessions/invalid'), {
        projectId: project.getId(),
        sessionId: 'invalid',
      })
    );

    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid session ID');
  });

  it('GET returns 404 when session not found in project', async () => {
    const project = Project.create('Test Project', context.tempProjectDir);

    const id = 'ws_00000000-0000-0000-0000-000000000000';
    const response = await GET(
      createLoaderArgs(
        new Request(`http://localhost/api/projects/${project.getId()}/sessions/${id}`),
        { projectId: project.getId(), sessionId: id }
      )
    );
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Session not found in this project');
  });

  it('PATCH updates workspace session name', async () => {
    const project = Project.create('Test Project', context.tempProjectDir);
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);
    await supervisor.updateWorkspaceSession(created.workspaceSessionId, {
      projectId: project.getId(),
      name: 'Old Name',
    });

    const request = new Request(
      `http://localhost/api/projects/${project.getId()}/sessions/${created.workspaceSessionId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New Name' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response = await PATCH_OR_DELETE(
      createActionArgs(request, {
        projectId: project.getId(),
        sessionId: created.workspaceSessionId,
      })
    );

    const data = await parseResponse<{ id: string; name: string }>(response);

    expect(response.status).toBe(200);
    expect(data.id).toBe(created.workspaceSessionId);
    expect(data.name).toBe('New Name');
  });

  it('DELETE removes workspace session', async () => {
    const project = Project.create('Test Project', context.tempProjectDir);
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);
    await supervisor.updateWorkspaceSession(created.workspaceSessionId, {
      projectId: project.getId(),
      name: 'To Delete',
    });

    const request = new Request(
      `http://localhost/api/projects/${project.getId()}/sessions/${created.workspaceSessionId}`,
      { method: 'DELETE' }
    );

    const response = await PATCH_OR_DELETE(
      createActionArgs(request, {
        projectId: project.getId(),
        sessionId: created.workspaceSessionId,
      })
    );

    const data = await parseResponse<{ success: boolean }>(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(await supervisor.getWorkspaceSession(created.workspaceSessionId)).toBeUndefined();
  });
});
