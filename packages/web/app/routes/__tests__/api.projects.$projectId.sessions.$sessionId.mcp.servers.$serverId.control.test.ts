// ABOUTME: Tests for session MCP server control API for runtime server management
// ABOUTME: Validates start/stop/restart operations on session's running MCP servers

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { action } from '@/app/routes/api.projects.$projectId.sessions.$sessionId.mcp.servers.$serverId.control';
import { parseResponse } from '@/lib/serialization';
import { createActionArgs } from '@/test-utils/route-test-helpers';

interface ServerControlResponse {
  message: string;
  serverId: string;
  status: 'starting' | 'running' | 'stopped' | 'failed';
}

interface ErrorResponse {
  error: string;
  details?: unknown;
}

// Mock project instance
const mockProject = {
  getId: vi.fn().mockReturnValue('test-project'),
  getMCPServer: vi.fn().mockReturnValue({
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    enabled: true,
    tools: { read_file: 'allow' },
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
  startServer: vi.fn(),
  stopServer: vi.fn(),
  getAllServers: vi.fn().mockReturnValue([
    {
      id: 'filesystem',
      status: 'running',
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

describe('Session MCP Server Control API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.getMCPServerManager = vi.fn().mockReturnValue(mockMCPServerManager);
  });

  describe('POST /api/projects/:projectId/sessions/:sessionId/mcp/servers/:serverId/control', () => {
    it('should start MCP server', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      const { getSessionService } = vi.mocked(await import('@/lib/server/session-service'));
      const { isValidThreadId } = vi.mocked(await import('@/lib/validation/thread-id-validation'));

      Project.getById = vi.fn().mockReturnValue(mockProject);
      getSessionService.mockReturnValue(mockSessionService);
      mockSessionService.getSession.mockResolvedValue(mockSession);
      isValidThreadId.mockReturnValue(true);

      mockMCPServerManager.startServer.mockResolvedValue(undefined);

      const request = new Request(
        'http://localhost/api/projects/test-project/sessions/test-session/mcp/servers/filesystem/control',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start' }),
        }
      );

      const response = await action(
        createActionArgs(request, {
          projectId: 'test-project',
          sessionId: 'test-session',
          serverId: 'filesystem',
        })
      );
      const data = await parseResponse<ServerControlResponse>(response);

      expect(response.status).toBe(200);
      expect(data.message).toContain('Server start initiated');
      expect(data.serverId).toBe('filesystem');
      expect(mockMCPServerManager.startServer).toHaveBeenCalledWith(
        'filesystem',
        expect.objectContaining({
          command: 'npx',
        })
      );
    });

    it('should stop MCP server', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      const { getSessionService } = vi.mocked(await import('@/lib/server/session-service'));
      const { isValidThreadId } = vi.mocked(await import('@/lib/validation/thread-id-validation'));

      Project.getById = vi.fn().mockReturnValue(mockProject);
      getSessionService.mockReturnValue(mockSessionService);
      mockSessionService.getSession.mockResolvedValue(mockSession);
      isValidThreadId.mockReturnValue(true);

      mockMCPServerManager.stopServer.mockResolvedValue(undefined);

      const request = new Request(
        'http://localhost/api/projects/test-project/sessions/test-session/mcp/servers/filesystem/control',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop' }),
        }
      );

      const response = await action(
        createActionArgs(request, {
          projectId: 'test-project',
          sessionId: 'test-session',
          serverId: 'filesystem',
        })
      );
      const data = await parseResponse<ServerControlResponse>(response);

      expect(response.status).toBe(200);
      expect(data.message).toContain('Server stop initiated');
      expect(data.serverId).toBe('filesystem');
      expect(mockMCPServerManager.stopServer).toHaveBeenCalledWith('filesystem');
    });

    it('should restart MCP server', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      const { getSessionService } = vi.mocked(await import('@/lib/server/session-service'));
      const { isValidThreadId } = vi.mocked(await import('@/lib/validation/thread-id-validation'));

      Project.getById = vi.fn().mockReturnValue(mockProject);
      getSessionService.mockReturnValue(mockSessionService);
      mockSessionService.getSession.mockResolvedValue(mockSession);
      isValidThreadId.mockReturnValue(true);

      mockMCPServerManager.stopServer.mockResolvedValue(undefined);
      mockMCPServerManager.startServer.mockResolvedValue(undefined);

      const request = new Request(
        'http://localhost/api/projects/test-project/sessions/test-session/mcp/servers/filesystem/control',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'restart' }),
        }
      );

      const response = await action(
        createActionArgs(request, {
          projectId: 'test-project',
          sessionId: 'test-session',
          serverId: 'filesystem',
        })
      );
      const data = await parseResponse<ServerControlResponse>(response);

      expect(response.status).toBe(200);
      expect(data.message).toContain('Server restart initiated');
      expect(data.serverId).toBe('filesystem');
      expect(mockMCPServerManager.stopServer).toHaveBeenCalledWith('filesystem');
      expect(mockMCPServerManager.startServer).toHaveBeenCalledWith(
        'filesystem',
        expect.objectContaining({
          command: 'npx',
        })
      );
    });

    it('should return 404 when project not found', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(null);

      const request = new Request(
        'http://localhost/api/projects/nonexistent/sessions/test-session/mcp/servers/filesystem/control',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start' }),
        }
      );

      const response = await action(
        createActionArgs(request, {
          projectId: 'nonexistent',
          sessionId: 'test-session',
          serverId: 'filesystem',
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
        'http://localhost/api/projects/test-project/sessions/invalid/mcp/servers/filesystem/control',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start' }),
        }
      );

      const response = await action(
        createActionArgs(request, {
          projectId: 'test-project',
          sessionId: 'invalid',
          serverId: 'filesystem',
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
        'http://localhost/api/projects/test-project/sessions/nonexistent/mcp/servers/filesystem/control',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start' }),
        }
      );

      const response = await action(
        createActionArgs(request, {
          projectId: 'test-project',
          sessionId: 'nonexistent',
          serverId: 'filesystem',
        })
      );
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should return 404 when server config not found', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      const { getSessionService } = vi.mocked(await import('@/lib/server/session-service'));
      const { isValidThreadId } = vi.mocked(await import('@/lib/validation/thread-id-validation'));

      const projectWithoutServer = {
        ...mockProject,
        getMCPServer: vi.fn().mockReturnValue(null),
      };
      Project.getById = vi.fn().mockReturnValue(projectWithoutServer);
      getSessionService.mockReturnValue(mockSessionService);
      mockSessionService.getSession.mockResolvedValue(mockSession);
      isValidThreadId.mockReturnValue(true);

      const request = new Request(
        'http://localhost/api/projects/test-project/sessions/test-session/mcp/servers/nonexistent/control',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start' }),
        }
      );

      const response = await action(
        createActionArgs(request, {
          projectId: 'test-project',
          sessionId: 'test-session',
          serverId: 'nonexistent',
        })
      );
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toContain('not found');
    });

    it('should validate invalid action', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      const { getSessionService } = vi.mocked(await import('@/lib/server/session-service'));
      const { isValidThreadId } = vi.mocked(await import('@/lib/validation/thread-id-validation'));

      Project.getById = vi.fn().mockReturnValue(mockProject);
      getSessionService.mockReturnValue(mockSessionService);
      mockSessionService.getSession.mockResolvedValue(mockSession);
      isValidThreadId.mockReturnValue(true);

      const request = new Request(
        'http://localhost/api/projects/test-project/sessions/test-session/mcp/servers/filesystem/control',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'invalid-action' }),
        }
      );

      const response = await action(
        createActionArgs(request, {
          projectId: 'test-project',
          sessionId: 'test-session',
          serverId: 'filesystem',
        })
      );
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
    });

    it('should handle server control errors', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      const { getSessionService } = vi.mocked(await import('@/lib/server/session-service'));
      const { isValidThreadId } = vi.mocked(await import('@/lib/validation/thread-id-validation'));

      Project.getById = vi.fn().mockReturnValue(mockProject);
      getSessionService.mockReturnValue(mockSessionService);
      mockSessionService.getSession.mockResolvedValue(mockSession);
      isValidThreadId.mockReturnValue(true);

      mockMCPServerManager.startServer.mockRejectedValue(new Error('Server start failed'));

      const request = new Request(
        'http://localhost/api/projects/test-project/sessions/test-session/mcp/servers/filesystem/control',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start' }),
        }
      );

      const response = await action(
        createActionArgs(request, {
          projectId: 'test-project',
          sessionId: 'test-session',
          serverId: 'filesystem',
        })
      );
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Server control operation failed');
    });

    it('should validate invalid route parameters', async () => {
      const request = new Request('http://localhost/api/projects//sessions//mcp/servers//control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });

      const response = await action(
        createActionArgs(request, {
          projectId: '',
          sessionId: '',
          serverId: '',
        })
      );
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid route parameters');
    });

    it('should only allow POST method', async () => {
      const request = new Request(
        'http://localhost/api/projects/test-project/sessions/test-session/mcp/servers/filesystem/control',
        {
          method: 'GET',
        }
      );

      const response = await action(
        createActionArgs(request, {
          projectId: 'test-project',
          sessionId: 'test-session',
          serverId: 'filesystem',
        })
      );

      expect(response.status).toBe(405);
    });
  });
});
