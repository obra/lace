// ABOUTME: Integration tests for project session MCP server control API
// ABOUTME: Validates start/stop/restart via ACP session/resume on supervisor-managed agents

import { describe, it, expect, afterEach } from 'vitest';
import { action } from '@lace/web/app/routes/api.projects.$projectId.sessions.$sessionId.mcp.servers.$serverId.control';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { parseResponse } from '@lace/web/lib/serialization';
import { createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';
import { Project } from '@lace/web/lib/server/projects/project';
import path from 'path';

// ✅ ESSENTIAL MOCK - Server-side module compatibility in test environment
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

interface ServerControlResponse {
  message: string;
  serverId: string;
  status: string;
}

interface ErrorResponse {
  error: string;
  details?: unknown;
}

async function createProjectAndSession(
  workDir: string,
  options: { includeSecretEnv?: boolean } = {}
) {
  const fixturePath = path.resolve('test-utils/fixtures/mcp-stdio-test-server.cjs');

  const project = Project.create('Test Project', workDir);
  project.addMCPServer('test', {
    command: process.execPath,
    args: [fixturePath],
    transport: 'stdio',
    placement: 'host',
    ...(options.includeSecretEnv
      ? { secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } } }
      : {}),
    enabled: false,
    tools: { echo: 'allow' },
  });
  const supervisor = await getSupervisor();
  const created = await supervisor.createWorkspaceSession(workDir);
  await supervisor.updateWorkspaceSession(created.workspaceSessionId, {
    projectId: project.getId(),
  });

  return { fixturePath, project, supervisor, created };
}

describe('Session MCP Server Control API', () => {
  const context = setupWebTest();

  afterEach(async () => {
    await shutdownSupervisorForTests();
  });

  it('starts an MCP server', async () => {
    const { project, supervisor, created } = await createProjectAndSession(context.tempProjectDir);
    const requestSpy = vi.spyOn(supervisor, 'agentRequest');

    const request = new Request(
      `http://localhost/api/projects/${project.getId()}/sessions/${created.workspaceSessionId}/mcp/servers/test/control`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      }
    );

    const response = await action(
      createActionArgs(request, {
        projectId: project.getId(),
        sessionId: created.workspaceSessionId,
        serverId: 'test',
      })
    );

    const data = await parseResponse<ServerControlResponse>(response);

    expect(response.status).toBe(200);
    expect(data.serverId).toBe('test');
    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceSessionId: created.workspaceSessionId,
        sessionId: created.sessionId,
        method: 'session/resume',
        requestParams: expect.objectContaining({
          sessionId: created.sessionId,
          cwd: context.tempProjectDir,
          mcpServers: [
            expect.objectContaining({
              name: 'test',
              transport: 'stdio',
              placement: 'host',
              enabled: true,
            }),
          ],
        }),
      })
    );

    const status = (await supervisor.agentRequest({
      workspaceSessionId: created.workspaceSessionId,
      method: 'ent/agent/status',
      requestParams: {},
    })) as {
      mcpServers?: Array<{ name: string; status: string }>;
    };
    expect(status.mcpServers?.find((s) => s.name === 'test')?.status).toBe('connected');
  });

  it('does not leak unresolved secret references when starting an MCP server', async () => {
    const { project, created } = await createProjectAndSession(context.tempProjectDir, {
      includeSecretEnv: true,
    });

    const request = new Request(
      `http://localhost/api/projects/${project.getId()}/sessions/${created.workspaceSessionId}/mcp/servers/test/control`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      }
    );

    const response = await action(
      createActionArgs(request, {
        projectId: project.getId(),
        sessionId: created.workspaceSessionId,
        serverId: 'test',
      })
    );

    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(500);
    expect(data.error).toBe('Server control operation failed');
    expect(JSON.stringify(data)).not.toContain('api-key');
  });

  it('stops an MCP server', async () => {
    const { project, supervisor, created, fixturePath } = await createProjectAndSession(
      context.tempProjectDir
    );

    await supervisor.agentRequest({
      workspaceSessionId: created.workspaceSessionId,
      sessionId: created.sessionId,
      method: 'session/resume',
      requestParams: {
        sessionId: created.sessionId,
        cwd: context.tempProjectDir,
        mcpServers: [
          {
            name: 'test',
            command: process.execPath,
            args: [fixturePath],
            enabled: true,
            tools: { echo: 'allow' },
          },
        ],
      },
    });

    const request = new Request(
      `http://localhost/api/projects/${project.getId()}/sessions/${created.workspaceSessionId}/mcp/servers/test/control`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      }
    );

    const response = await action(
      createActionArgs(request, {
        projectId: project.getId(),
        sessionId: created.workspaceSessionId,
        serverId: 'test',
      })
    );

    const data = await parseResponse<ServerControlResponse>(response);

    expect(response.status).toBe(200);
    expect(data.serverId).toBe('test');

    const status = (await supervisor.agentRequest({
      workspaceSessionId: created.workspaceSessionId,
      method: 'ent/agent/status',
      requestParams: {},
    })) as {
      mcpServers?: Array<{ name: string; status: string }>;
    };
    expect(status.mcpServers?.find((s) => s.name === 'test')?.status).toBe('disconnected');
  });

  it('restarts an MCP server', async () => {
    const { project, supervisor, created, fixturePath } = await createProjectAndSession(
      context.tempProjectDir
    );

    await supervisor.agentRequest({
      workspaceSessionId: created.workspaceSessionId,
      sessionId: created.sessionId,
      method: 'session/resume',
      requestParams: {
        sessionId: created.sessionId,
        cwd: context.tempProjectDir,
        mcpServers: [
          {
            name: 'test',
            command: process.execPath,
            args: [fixturePath],
            enabled: true,
            tools: { echo: 'allow' },
          },
        ],
      },
    });

    const request = new Request(
      `http://localhost/api/projects/${project.getId()}/sessions/${created.workspaceSessionId}/mcp/servers/test/control`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restart' }),
      }
    );

    const response = await action(
      createActionArgs(request, {
        projectId: project.getId(),
        sessionId: created.workspaceSessionId,
        serverId: 'test',
      })
    );

    const data = await parseResponse<ServerControlResponse>(response);

    expect(response.status).toBe(200);
    expect(data.serverId).toBe('test');

    const status = (await supervisor.agentRequest({
      workspaceSessionId: created.workspaceSessionId,
      method: 'ent/agent/status',
      requestParams: {},
    })) as {
      mcpServers?: Array<{ name: string; status: string }>;
    };
    expect(status.mcpServers?.find((s) => s.name === 'test')?.status).toBe('connected');
  });

  it('returns 404 when project not found', async () => {
    const request = new Request(
      'http://localhost/api/projects/nonexistent/sessions/ws_00000000-0000-0000-0000-000000000000/mcp/servers/test/control',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      }
    );

    const response = await action(
      createActionArgs(request, {
        projectId: 'nonexistent',
        sessionId: 'ws_00000000-0000-0000-0000-000000000000',
        serverId: 'test',
      })
    );

    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Project not found');
  });

  it('returns 400 for invalid session ID', async () => {
    const project = Project.create('Test Project', context.tempProjectDir);

    const request = new Request(
      `http://localhost/api/projects/${project.getId()}/sessions/invalid/mcp/servers/test/control`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      }
    );

    const response = await action(
      createActionArgs(request, {
        projectId: project.getId(),
        sessionId: 'invalid',
        serverId: 'test',
      })
    );

    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid session ID');
  });

  it('returns 404 when session not found', async () => {
    const project = Project.create('Test Project', context.tempProjectDir);
    const id = 'ws_00000000-0000-0000-0000-000000000000';

    const request = new Request(
      `http://localhost/api/projects/${project.getId()}/sessions/${id}/mcp/servers/test/control`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      }
    );

    const response = await action(
      createActionArgs(request, {
        projectId: project.getId(),
        sessionId: id,
        serverId: 'test',
      })
    );

    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Session not found');
  });

  it('returns 404 when server config not found', async () => {
    const project = Project.create('Test Project', context.tempProjectDir);
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);
    await supervisor.updateWorkspaceSession(created.workspaceSessionId, {
      projectId: project.getId(),
    });

    const request = new Request(
      `http://localhost/api/projects/${project.getId()}/sessions/${created.workspaceSessionId}/mcp/servers/nope/control`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      }
    );

    const response = await action(
      createActionArgs(request, {
        projectId: project.getId(),
        sessionId: created.workspaceSessionId,
        serverId: 'nope',
      })
    );

    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(404);
    expect(data.error).toContain("MCP server 'nope' not found");
  });
});
