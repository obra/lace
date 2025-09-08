// ABOUTME: Tests for session MCP server status API showing runtime server status
// ABOUTME: Validates session MCP server status retrieval and error handling for session context

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loader } from '@/app/routes/api.projects.$projectId.sessions.$sessionId.mcp.servers';
import { parseResponse } from '@/lib/serialization';
import { createLoaderArgs } from '@/test-utils/route-test-helpers';

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

// Mock project instance
const mockProject = {
  getId: vi.fn().mockReturnValue('test-project'),
  getMCPServers: vi.fn().mockReturnValue({
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      enabled: true,
      tools: { read_file: 'allow' },
    },
    git: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-git'],
      enabled: false,
      tools: { git_status: 'ask' },
    },
  }),
};

// Mock session instance
const mockSession = {
  id: 'test-session',
  projectId: 'test-project',
  getMCPServerManager: vi.fn(),
};

// Mock MCP server manager
const mockMCPServerManager = {
  getAllServers: vi.fn().mockReturnValue([
    {
      id: 'filesystem',
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        enabled: true,
        tools: { read_file: 'allow' },
      },
      status: 'running',
      connectedAt: '2023-01-01T00:00:00Z',
    },
    {
      id: 'git',
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-git'],
        enabled: false,
        tools: { git_status: 'ask' },
      },
      status: 'failed',
      lastError: 'Connection timeout',
    },
  ]),
};

// Mock session service
const mockSessionService = {
  getSession: vi.fn(),
  setupAgentEventHandlers: vi.fn(),
  updateSession: vi.fn(),
  clearActiveSessions: vi.fn(),
};

vi.mock('@/lib/server/lace-imports', () => ({
  Project: {
    getById: vi.fn(),
  },
}));

vi.mock('@/lib/server/session-service', () => ({
  getSessionService: vi.fn(),
}));

vi.mock('@/lib/validation/thread-id-validation', () => ({
  isValidThreadId: vi.fn(),
}));

describe('Session MCP Server Status API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.getMCPServerManager = vi.fn().mockReturnValue(mockMCPServerManager);
  });

  it('should return session MCP server status with runtime information', async () => {
    const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
    const { getSessionService } = vi.mocked(await import('@/lib/server/session-service'));
    const { isValidThreadId } = vi.mocked(await import('@/lib/validation/thread-id-validation'));

    Project.getById = vi.fn().mockReturnValue(mockProject);
    getSessionService.mockReturnValue(mockSessionService);
    mockSessionService.getSession.mockResolvedValue(mockSession);
    isValidThreadId.mockReturnValue(true);

    const request = new Request(
      'http://localhost/api/projects/test-project/sessions/test-session/mcp/servers'
    );
    const response = await loader(
      createLoaderArgs(request, {
        projectId: 'test-project',
        sessionId: 'test-session',
      })
    );
    const data = await parseResponse<SessionMCPServerListResponse>(response);

    expect(response.status).toBe(200);
    expect(data.projectId).toBe('test-project');
    expect(data.sessionId).toBe('test-session');
    expect(data.servers).toHaveLength(2);

    // Filesystem server - running
    expect(data.servers[0]).toMatchObject({
      id: 'filesystem',
      command: 'npx',
      enabled: true,
      status: 'running',
      connectedAt: '2023-01-01T00:00:00Z',
    });

    // Git server - failed
    expect(data.servers[1]).toMatchObject({
      id: 'git',
      command: 'npx',
      enabled: false,
      status: 'failed',
      lastError: 'Connection timeout',
    });
  });

  it('should show stopped status for servers not running in session', async () => {
    const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
    const { getSessionService } = vi.mocked(await import('@/lib/server/session-service'));
    const { isValidThreadId } = vi.mocked(await import('@/lib/validation/thread-id-validation'));

    Project.getById = vi.fn().mockReturnValue(mockProject);
    getSessionService.mockReturnValue(mockSessionService);
    mockSessionService.getSession.mockResolvedValue(mockSession);
    isValidThreadId.mockReturnValue(true);

    // Mock no running servers
    mockMCPServerManager.getAllServers = vi.fn().mockReturnValue([]);

    const request = new Request(
      'http://localhost/api/projects/test-project/sessions/test-session/mcp/servers'
    );
    const response = await loader(
      createLoaderArgs(request, {
        projectId: 'test-project',
        sessionId: 'test-session',
      })
    );
    const data = await parseResponse<SessionMCPServerListResponse>(response);

    expect(response.status).toBe(200);
    expect(data.servers).toHaveLength(2);
    expect(data.servers[0].status).toBe('stopped');
    expect(data.servers[1].status).toBe('stopped');
  });

  it('should return 404 when project not found', async () => {
    const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
    Project.getById = vi.fn().mockReturnValue(null);

    const request = new Request(
      'http://localhost/api/projects/nonexistent/sessions/test-session/mcp/servers'
    );
    const response = await loader(
      createLoaderArgs(request, {
        projectId: 'nonexistent',
        sessionId: 'test-session',
      })
    );
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Project not found');
  });

  it('should return 400 for invalid session ID', async () => {
    const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
    const { isValidThreadId } = vi.mocked(await import('@/lib/validation/thread-id-validation'));

    Project.getById = vi.fn().mockReturnValue(mockProject);
    isValidThreadId.mockReturnValue(false);

    const request = new Request(
      'http://localhost/api/projects/test-project/sessions/invalid/mcp/servers'
    );
    const response = await loader(
      createLoaderArgs(request, {
        projectId: 'test-project',
        sessionId: 'invalid',
      })
    );
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid session ID');
  });

  it('should return 404 when session not found', async () => {
    const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
    const { getSessionService } = vi.mocked(await import('@/lib/server/session-service'));
    const { isValidThreadId } = vi.mocked(await import('@/lib/validation/thread-id-validation'));

    Project.getById = vi.fn().mockReturnValue(mockProject);
    getSessionService.mockReturnValue(mockSessionService);
    mockSessionService.getSession.mockResolvedValue(null);
    isValidThreadId.mockReturnValue(true);

    const request = new Request(
      'http://localhost/api/projects/test-project/sessions/nonexistent/mcp/servers'
    );
    const response = await loader(
      createLoaderArgs(request, {
        projectId: 'test-project',
        sessionId: 'nonexistent',
      })
    );
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Session not found');
  });

  it('should handle session service errors', async () => {
    const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
    const { getSessionService } = vi.mocked(await import('@/lib/server/session-service'));
    const { isValidThreadId } = vi.mocked(await import('@/lib/validation/thread-id-validation'));

    Project.getById = vi.fn().mockReturnValue(mockProject);
    getSessionService.mockReturnValue(mockSessionService);
    mockSessionService.getSession.mockRejectedValue(new Error('Session service error'));
    isValidThreadId.mockReturnValue(true);

    const request = new Request(
      'http://localhost/api/projects/test-project/sessions/test-session/mcp/servers'
    );
    const response = await loader(
      createLoaderArgs(request, {
        projectId: 'test-project',
        sessionId: 'test-session',
      })
    );
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to load server status');
  });

  it('should validate invalid route parameters', async () => {
    const request = new Request('http://localhost/api/projects//sessions//mcp/servers');
    const response = await loader(
      createLoaderArgs(request, {
        projectId: '',
        sessionId: '',
      })
    );
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid route parameters');
  });
});
