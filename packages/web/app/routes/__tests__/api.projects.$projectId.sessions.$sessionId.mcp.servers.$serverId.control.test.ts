// ABOUTME: Integration tests for project session MCP server control API
// ABOUTME: Validates start/stop/restart via ent/session/configure on supervisor-managed agents

import { describe, it, expect, afterEach } from 'vitest';
import { action } from '@lace/web/app/routes/api.projects.$projectId.sessions.$sessionId.mcp.servers.$serverId.control';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { parseResponse } from '@lace/web/lib/serialization';
import { createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';
import { Project, MCPConfigLoader } from '@lace/web/lib/server/lace-imports';
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

async function createProjectAndSession(workDir: string) {
  const fixturePath = path.resolve('test-utils/fixtures/mcp-stdio-test-server.cjs');

  MCPConfigLoader.updateServerConfig(
    'test',
    {
      command: process.execPath,
      args: [fixturePath],
      enabled: false,
      tools: { echo: 'allow' },
    },
    workDir
  );

  const project = Project.create('Test Project', workDir);
  const supervisor = getSupervisor();
  const created = await supervisor.createWorkspaceSession(workDir);
  supervisor.updateWorkspaceSession(created.workspaceSessionId, { projectId: project.getId() });

  return { fixturePath, project, supervisor, created };
}

describe('Session MCP Server Control API', () => {
  const context = setupWebTest();

  afterEach(async () => {
    await shutdownSupervisorForTests();
  });

  it('starts an MCP server', async () => {
    const { project, supervisor, created } = await createProjectAndSession(context.tempProjectDir);

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

    const status = (await supervisor
      .getPeer(created.workspaceSessionId)
      .request('ent/agent/status')) as {
      mcpServers?: Array<{ name: string; status: string }>;
    };
    expect(status.mcpServers?.find((s) => s.name === 'test')?.status).toBe('connected');
  });

  it('stops an MCP server', async () => {
    const { project, supervisor, created, fixturePath } = await createProjectAndSession(
      context.tempProjectDir
    );

    await supervisor
      .getPeer(created.workspaceSessionId, created.sessionId)
      .request('ent/session/configure', {
        mcpServers: [
          {
            name: 'test',
            command: process.execPath,
            args: [fixturePath],
            enabled: true,
            tools: { echo: 'allow' },
          },
        ],
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

    const status = (await supervisor
      .getPeer(created.workspaceSessionId)
      .request('ent/agent/status')) as {
      mcpServers?: Array<{ name: string; status: string }>;
    };
    expect(status.mcpServers?.find((s) => s.name === 'test')?.status).toBe('disconnected');
  });

  it('restarts an MCP server', async () => {
    const { project, supervisor, created, fixturePath } = await createProjectAndSession(
      context.tempProjectDir
    );

    await supervisor
      .getPeer(created.workspaceSessionId, created.sessionId)
      .request('ent/session/configure', {
        mcpServers: [
          {
            name: 'test',
            command: process.execPath,
            args: [fixturePath],
            enabled: true,
            tools: { echo: 'allow' },
          },
        ],
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

    const status = (await supervisor
      .getPeer(created.workspaceSessionId)
      .request('ent/agent/status')) as {
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
    const supervisor = getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);
    supervisor.updateWorkspaceSession(created.workspaceSessionId, { projectId: project.getId() });

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
