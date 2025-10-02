// ABOUTME: Tests for the workspace information API endpoint
// ABOUTME: Validates endpoint behavior for container and local workspace modes

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loader } from '@/app/routes/api.sessions.$sessionId.workspace';
import { Session } from '@/lib/server/lace-imports';
import { Project } from '@/lib/server/lace-imports';
import { setupWebTest } from '@/test-utils/web-test-setup';
import { createLoaderArgs } from '@/test-utils/route-test-helpers';
import { parseResponse } from '@/lib/serialization';
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '@/lib/server/lace-imports';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';

// ✅ ESSENTIAL MOCK - Server-side module compatibility in test environment
vi.mock('server-only', () => ({}));

// Mock URL fetch tool to avoid external HTTP requests
vi.mock('~/tools/implementations/url-fetch', () => ({
  UrlFetchTool: vi.fn(() => ({
    name: 'url-fetch',
    description: 'Fetch content from a URL (mocked)',
    schema: {},
    execute: vi.fn().mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: 'Mocked URL content' }],
    }),
  })),
}));

// Mock bash tool to avoid system command execution
vi.mock('~/tools/implementations/bash', () => ({
  BashTool: vi.fn(() => ({
    name: 'bash',
    description: 'Execute bash commands (mocked)',
    schema: {},
    execute: vi.fn().mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: 'Mocked bash output' }],
    }),
  })),
}));

describe('GET /api/sessions/:sessionId/workspace', () => {
  let anthropicInstanceId: string;

  beforeEach(async () => {
    setupWebTest();
    setupTestProviderDefaults();

    // Create test provider instance
    anthropicInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });
  });

  afterEach(() => {
    Session.clearRegistry();
    cleanupTestProviderInstances();
    cleanupTestProviderDefaults();
  });

  it('returns 400 if session ID is missing', async () => {
    const request = new Request('http://localhost:3005/api/sessions/undefined/workspace');
    const response = await loader(createLoaderArgs(request, {}));
    const data = await parseResponse<{ error: string; code: string }>(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Session ID required');
    expect(data.code).toBe('VALIDATION_FAILED');
  });

  it('returns 404 if session does not exist', async () => {
    const request = new Request('http://localhost:3005/api/sessions/nonexistent/workspace');
    const response = await loader(createLoaderArgs(request, { sessionId: 'nonexistent' }));
    const data = await parseResponse<{ error: string; code: string }>(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Session not found');
    expect(data.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('returns workspace info for local mode session', async () => {
    // Create test project
    const project = Project.create('Test Project', '/test/project', 'Test project', {
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    // Create session with local workspace mode
    const session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
      configuration: {
        workspaceMode: 'local',
      },
    });

    // Wait for workspace initialization
    await session.waitForWorkspace();

    const sessionId = session.getId();
    const request = new Request(`http://localhost:3005/api/sessions/${sessionId}/workspace`);
    const response = await loader(createLoaderArgs(request, { sessionId }));
    const data = await parseResponse<{
      mode: 'container' | 'local';
      info: { sessionId: string; state: string } | null;
    }>(response);

    expect(response.status).toBe(200);
    expect(data.mode).toBe('local');
    expect(data.info).toBeDefined();
    expect(data.info?.sessionId).toBe(session.getId());
    expect(data.info?.state).toBe('running');
  });

  it('returns workspace info for container mode session', async () => {
    // Skip on non-macOS platforms (containers only supported on macOS)
    if (process.platform !== 'darwin') {
      return;
    }

    // Create test project
    const project = Project.create('Test Project', '/test/project', 'Test project', {
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    // Create session with container workspace mode
    const session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
      configuration: {
        workspaceMode: 'container',
      },
    });

    // Wait for workspace initialization
    await session.waitForWorkspace();

    const sessionId = session.getId();
    const request = new Request(`http://localhost:3005/api/sessions/${sessionId}/workspace`);
    const response = await loader(createLoaderArgs(request, { sessionId }));
    const data = await parseResponse<{
      mode: 'container' | 'local';
      info: { containerId: string; branchName?: string; containerMountPath?: string } | null;
    }>(response);

    expect(response.status).toBe(200);
    expect(data.mode).toBe('container');
    expect(data.info).toBeDefined();
    if (data.info) {
      expect(data.info.containerId).toMatch(/^workspace-/);
      expect(data.info.branchName).toBeDefined();
      expect(data.info.containerMountPath).toBe('/workspace');
    }
  });

  it('handles sessions where workspace is not yet initialized', async () => {
    // Create test project
    const project = Project.create('Test Project', '/test/project', 'Test project', {
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    // Create session
    const session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
      configuration: {
        workspaceMode: 'local',
      },
    });

    // Don't wait for workspace initialization - test immediate response

    const sessionId = session.getId();
    const request = new Request(`http://localhost:3005/api/sessions/${sessionId}/workspace`);
    const response = await loader(createLoaderArgs(request, { sessionId }));
    const data = await parseResponse<{
      mode: 'container' | 'local';
      info: unknown;
    }>(response);

    expect(response.status).toBe(200);
    expect(data.mode).toBe('local');
    // Info may be null if not initialized yet
    expect(data.info === null || typeof data.info === 'object').toBe(true);
  });
});
