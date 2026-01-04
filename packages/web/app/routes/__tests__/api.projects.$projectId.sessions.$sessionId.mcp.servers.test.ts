// ABOUTME: Integration tests for project session MCP server status API
// ABOUTME: Uses supervisor + ent/agent/status for runtime server status

import { describe, it, expect, afterEach } from 'vitest';
import { loader } from '@lace/web/app/routes/api.projects.$projectId.sessions.$sessionId.mcp.servers';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { parseResponse } from '@lace/web/lib/serialization';
import { createLoaderArgs } from '@lace/web/test-utils/route-test-helpers';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';
import { Project, MCPConfigLoader } from '@lace/web/lib/server/lace-imports';
import path from 'path';

// ✅ ESSENTIAL MOCK - Server-side module compatibility in test environment
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

interface SessionMCPServerListResponse {
  projectId: string;
  sessionId: string;
  servers: Array<{
    id: string;
    command: string;
    args?: string[];
    enabled: boolean;
    tools: Record<string, string>;
    status: 'starting' | 'running' | 'stopped' | 'failed';
    lastError?: string;
    connectedAt?: string;
  }>;
}

interface ErrorResponse {
  error: string;
  details?: unknown;
}

describe('Session MCP Server Status API', () => {
  const context = setupWebTest();

  afterEach(async () => {
    await shutdownSupervisorForTests();
  });

  it('returns configured servers with runtime status', async () => {
    const fixturePath = path.resolve('test-utils/fixtures/mcp-stdio-test-server.cjs');

    MCPConfigLoader.updateServerConfig(
      'test',
      {
        command: process.execPath,
        args: [fixturePath],
        enabled: true,
        tools: { echo: 'allow' },
      },
      context.tempProjectDir
    );

    MCPConfigLoader.updateServerConfig(
      'disabled',
      {
        command: process.execPath,
        args: [fixturePath],
        enabled: false,
        tools: { echo: 'allow' },
      },
      context.tempProjectDir
    );

    const project = Project.create('Test Project', context.tempProjectDir);

    const supervisor = getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);
    supervisor.updateWorkspaceSession(created.workspaceSessionId, { projectId: project.getId() });

    await supervisor
      .getPeer(created.workspaceSessionId, created.sessionId)
      .request('ent/session/configure', {
        mcpServers: Object.entries(project.getMCPServers()).map(([name, config]) => ({
          name,
          command: config.command,
          ...(config.args ? { args: config.args } : {}),
          ...(config.env ? { env: config.env } : {}),
          enabled: config.enabled,
          tools: config.tools,
        })),
      });

    const request = new Request(
      `http://localhost/api/projects/${project.getId()}/sessions/${created.workspaceSessionId}/mcp/servers`
    );

    const response = await loader(
      createLoaderArgs(request, {
        projectId: project.getId(),
        sessionId: created.workspaceSessionId,
      })
    );

    const data = await parseResponse<SessionMCPServerListResponse>(response);

    expect(response.status).toBe(200);
    expect(data.projectId).toBe(project.getId());
    expect(data.sessionId).toBe(created.workspaceSessionId);
    expect(data.servers).toHaveLength(2);

    const running = data.servers.find((s) => s.id === 'test');
    expect(running).toMatchObject({ id: 'test', enabled: true, status: 'running' });

    const stopped = data.servers.find((s) => s.id === 'disabled');
    expect(stopped).toMatchObject({ id: 'disabled', enabled: false, status: 'stopped' });
  });

  it('returns 404 when project not found', async () => {
    const request = new Request(
      'http://localhost/api/projects/nonexistent/sessions/ws_00000000-0000-0000-0000-000000000000/mcp/servers'
    );
    const response = await loader(
      createLoaderArgs(request, {
        projectId: 'nonexistent',
        sessionId: 'ws_00000000-0000-0000-0000-000000000000',
      })
    );
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Project not found');
  });

  it('returns 400 for invalid session ID', async () => {
    const project = Project.create('Test Project', context.tempProjectDir);

    const request = new Request(
      `http://localhost/api/projects/${project.getId()}/sessions/invalid/mcp/servers`
    );
    const response = await loader(
      createLoaderArgs(request, {
        projectId: project.getId(),
        sessionId: 'invalid',
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
      `http://localhost/api/projects/${project.getId()}/sessions/${id}/mcp/servers`
    );
    const response = await loader(
      createLoaderArgs(request, {
        projectId: project.getId(),
        sessionId: id,
      })
    );
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Session not found');
  });
});
