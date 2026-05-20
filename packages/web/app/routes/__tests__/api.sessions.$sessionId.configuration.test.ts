// ABOUTME: Integration tests for supervisor-backed session configuration API endpoints - GET, PUT
// ABOUTME: Provider connection uses Ent; model and permission mode use ACP config options

import { describe, it, expect, afterEach } from 'vitest';
import {
  loader as GET,
  action as PUT,
} from '@lace/web/app/routes/api.sessions.$sessionId.configuration';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { parseResponse } from '@lace/web/lib/serialization';
import { createLoaderArgs, createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';

// ✅ ESSENTIAL MOCK - Server-side module compatibility in test environment
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

interface ConfigurationResponse {
  configuration: {
    providerInstanceId?: string;
    modelId?: string;
    availableTools?: string[];
    toolPolicies?: Record<string, string>;
  };
}

interface ErrorResponse {
  error: string;
  details?: unknown;
}

describe('Session Configuration API', () => {
  const context = setupWebTest();

  afterEach(async () => {
    await shutdownSupervisorForTests();
  });

  it('GET /api/sessions/:sessionId/configuration returns coordinator config', async () => {
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);
    await supervisor.upsertAgentSessionMeta(created.workspaceSessionId, {
      sessionId: created.sessionId,
      connectionId: 'conn_test',
      modelId: 'model_test',
    });

    const request = new Request(
      `http://localhost/api/sessions/${created.workspaceSessionId}/configuration`
    );
    const response = await GET(
      createLoaderArgs(request, { sessionId: created.workspaceSessionId })
    );
    const data = await parseResponse<ConfigurationResponse>(response);

    expect(response.status).toBe(200);
    expect(data.configuration.providerInstanceId).toBe('conn_test');
    expect(data.configuration.modelId).toBe('model_test');
    expect(data.configuration.availableTools).toContain('bash');
  });

  it('GET /api/sessions/:sessionId/configuration returns 400 for invalid session ID format', async () => {
    const request = new Request('http://localhost/api/sessions/nonexistent/configuration');
    const response = await GET(createLoaderArgs(request, { sessionId: 'nonexistent' }));
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid session ID');
  });

  it('GET /api/sessions/:sessionId/configuration returns 404 when session not found', async () => {
    const id = 'ws_00000000-0000-0000-0000-000000000000';
    const request = new Request(`http://localhost/api/sessions/${id}/configuration`);
    const response = await GET(createLoaderArgs(request, { sessionId: id }));

    expect(response.status).toBe(404);
    const data = await parseResponse<ErrorResponse>(response);
    expect(data.error).toBe('Session not found');
  });

  it('PUT /api/sessions/:sessionId/configuration updates coordinator config', async () => {
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);
    const requestSpy = vi.spyOn(supervisor, 'agentRequest');

    const request = new Request(
      `http://localhost/api/sessions/${created.workspaceSessionId}/configuration`,
      {
        method: 'PUT',
        body: JSON.stringify({
          providerInstanceId: 'conn_updated',
          modelId: 'model_updated',
          runtimeOverrides: { permissionMode: 'yolo' },
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response = await PUT(
      createActionArgs(request, { sessionId: created.workspaceSessionId })
    );
    const data = await parseResponse<ConfigurationResponse>(response);

    expect(response.status).toBe(200);
    expect(data.configuration.providerInstanceId).toBe('conn_updated');
    expect(data.configuration.modelId).toBe('model_updated');
    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'ent/session/configure',
        requestParams: { connectionId: 'conn_updated' },
      })
    );
    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'session/set_config_option',
        requestParams: expect.objectContaining({
          sessionId: created.sessionId,
          configId: 'model',
          value: 'model_updated',
        }),
      })
    );
    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'session/set_config_option',
        requestParams: expect.objectContaining({
          sessionId: created.sessionId,
          configId: 'approvalMode',
          value: 'dangerouslySkipPermissions',
        }),
      })
    );
  });

  it('PUT /api/sessions/:sessionId/configuration returns 400 for invalid session ID format', async () => {
    const request = new Request('http://localhost/api/sessions/nonexistent/configuration', {
      method: 'PUT',
      body: JSON.stringify({
        providerInstanceId: 'conn_test',
        modelId: 'model_test',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PUT(createActionArgs(request, { sessionId: 'nonexistent' }));
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid session ID');
  });

  it('PUT /api/sessions/:sessionId/configuration returns 404 when session not found', async () => {
    const id = 'ws_00000000-0000-0000-0000-000000000000';
    const request = new Request(`http://localhost/api/sessions/${id}/configuration`, {
      method: 'PUT',
      body: JSON.stringify({
        providerInstanceId: 'conn_test',
        modelId: 'model_test',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PUT(createActionArgs(request, { sessionId: id }));
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Session not found');
  });

  it('PUT /api/sessions/:sessionId/configuration validates configuration data', async () => {
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);

    const request = new Request(
      `http://localhost/api/sessions/${created.workspaceSessionId}/configuration`,
      {
        method: 'PUT',
        body: JSON.stringify({
          runtimeOverrides: { permissionMode: 'not-a-mode' },
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response = await PUT(
      createActionArgs(request, { sessionId: created.workspaceSessionId })
    );
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid request data');
    expect(data.details).toBeDefined();
  });
});
