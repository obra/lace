// ABOUTME: Tests for individual project MCP server management API following established project patterns
// ABOUTME: Validates CRUD operations for project-specific MCP server configurations

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loader, action } from '@/app/routes/api.projects.$projectId.mcp.servers.$serverId';
import { parseResponse } from '@/lib/serialization';
import { createLoaderArgs, createActionArgs } from '@/test-utils/route-test-helpers';

interface ServerResponse {
  id: string;
  command: string;
  args?: string[];
  enabled: boolean;
  tools: Record<string, string>;
}

interface ServerActionResponse {
  message: string;
  server?: ServerResponse;
}

interface ErrorResponse {
  error: string;
  details?: unknown;
}

// Mock project instance
const mockProject = {
  getId: vi.fn().mockReturnValue('test-project'),
  getMCPServer: vi.fn(),
  addMCPServer: vi.fn(),
  updateMCPServer: vi.fn(),
  deleteMCPServer: vi.fn(),
};

vi.mock('@/lib/server/lace-imports', () => ({
  Project: {
    getById: vi.fn(),
  },
}));

describe('Individual Project MCP Server Management API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/projects/:projectId/mcp/servers/:serverId', () => {
    it('should return specific project MCP server configuration', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);
      mockProject.getMCPServer = vi.fn().mockReturnValue({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        enabled: true,
        tools: { read_file: 'allow-session' },
      });

      const request = new Request(
        'http://localhost/api/projects/test-project/mcp/servers/filesystem'
      );
      const response = await loader(
        createLoaderArgs(request, { projectId: 'test-project', serverId: 'filesystem' })
      );
      const data = await parseResponse<ServerResponse>(response);

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        id: 'filesystem',
        command: 'npx',
        enabled: true,
      });
    });

    it('should return 404 for non-existent project', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(null);

      const request = new Request(
        'http://localhost/api/projects/nonexistent/mcp/servers/filesystem'
      );
      const response = await loader(
        createLoaderArgs(request, { projectId: 'nonexistent', serverId: 'filesystem' })
      );
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 for non-existent server', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);
      mockProject.getMCPServer = vi.fn().mockReturnValue(null);

      const request = new Request(
        'http://localhost/api/projects/test-project/mcp/servers/nonexistent'
      );
      const response = await loader(
        createLoaderArgs(request, { projectId: 'test-project', serverId: 'nonexistent' })
      );
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toContain('not found');
    });
  });

  describe('POST /api/projects/:projectId/mcp/servers/:serverId', () => {
    it('should create new project MCP server', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);
      mockProject.getMCPServer = vi.fn().mockReturnValue(null); // Server doesn't exist

      const request = new Request('http://localhost/api/projects/test-project/mcp/servers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'echo',
          args: ['hello'],
          enabled: true,
          tools: { echo: 'allow-session' },
        }),
      });

      const response = await action(
        createActionArgs(request, { projectId: 'test-project', serverId: 'test' })
      );
      const data = await parseResponse<ServerActionResponse>(response);

      expect(response.status).toBe(201);
      expect(data.message).toContain('created successfully');
      expect(mockProject.addMCPServer).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          command: 'echo',
          enabled: true,
        })
      );
    });

    it('should prevent duplicate server creation', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);
      mockProject.getMCPServer = vi.fn().mockReturnValue({
        command: 'existing',
        enabled: true,
        tools: {},
      });

      const request = new Request(
        'http://localhost/api/projects/test-project/mcp/servers/existing',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: 'echo',
            enabled: true,
            tools: {},
          }),
        }
      );

      const response = await action(
        createActionArgs(request, { projectId: 'test-project', serverId: 'existing' })
      );

      expect(response.status).toBe(409);
    });

    it('should return 404 for non-existent project', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(null);

      const request = new Request('http://localhost/api/projects/nonexistent/mcp/servers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'echo',
          enabled: true,
          tools: {},
        }),
      });

      const response = await action(
        createActionArgs(request, { projectId: 'nonexistent', serverId: 'test' })
      );
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });
  });

  describe('PUT /api/projects/:projectId/mcp/servers/:serverId', () => {
    it('should update existing project MCP server', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);
      mockProject.getMCPServer = vi.fn().mockReturnValue({
        command: 'npx',
        enabled: true,
        tools: { read_file: 'allow-session' },
      });

      const request = new Request(
        'http://localhost/api/projects/test-project/mcp/servers/filesystem',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: false,
            tools: { read_file: 'deny' },
          }),
        }
      );

      const response = await action(
        createActionArgs(request, { projectId: 'test-project', serverId: 'filesystem' })
      );
      const data = await parseResponse<ServerActionResponse>(response);

      expect(response.status).toBe(200);
      expect(data.message).toContain('updated successfully');
      expect(mockProject.updateMCPServer).toHaveBeenCalledWith(
        'filesystem',
        expect.objectContaining({
          enabled: false,
          tools: { read_file: 'deny' },
        })
      );
    });

    it('should return 404 for non-existent server', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);
      mockProject.getMCPServer = vi.fn().mockReturnValue(null);

      const request = new Request(
        'http://localhost/api/projects/test-project/mcp/servers/nonexistent',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: false,
          }),
        }
      );

      const response = await action(
        createActionArgs(request, { projectId: 'test-project', serverId: 'nonexistent' })
      );
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toContain('not found');
    });
  });

  describe('DELETE /api/projects/:projectId/mcp/servers/:serverId', () => {
    it('should delete existing project MCP server', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);
      mockProject.getMCPServer = vi.fn().mockReturnValue({
        command: 'npx',
        enabled: true,
        tools: {},
      });

      const request = new Request(
        'http://localhost/api/projects/test-project/mcp/servers/filesystem',
        {
          method: 'DELETE',
        }
      );

      const response = await action(
        createActionArgs(request, { projectId: 'test-project', serverId: 'filesystem' })
      );
      const data = await parseResponse<ServerActionResponse>(response);

      expect(response.status).toBe(200);
      expect(data.message).toContain('deleted successfully');
      expect(mockProject.deleteMCPServer).toHaveBeenCalledWith('filesystem');
    });

    it('should return 404 for non-existent server', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);
      mockProject.getMCPServer = vi.fn().mockReturnValue(null);

      const request = new Request(
        'http://localhost/api/projects/test-project/mcp/servers/nonexistent',
        {
          method: 'DELETE',
        }
      );

      const response = await action(
        createActionArgs(request, { projectId: 'test-project', serverId: 'nonexistent' })
      );
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toContain('not found');
    });
  });

  describe('Validation', () => {
    it('should validate invalid project ID', async () => {
      const request = new Request('http://localhost/api/projects//mcp/servers/test');
      const response = await loader(createLoaderArgs(request, { projectId: '', serverId: 'test' }));
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid project ID');
    });

    it('should validate invalid server ID', async () => {
      const request = new Request('http://localhost/api/projects/test/mcp/servers/');
      const response = await loader(createLoaderArgs(request, { projectId: 'test', serverId: '' }));
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid server ID');
    });

    it('should validate invalid request data for POST', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);
      mockProject.getMCPServer = vi.fn().mockReturnValue(null);

      const request = new Request('http://localhost/api/projects/test/mcp/servers/invalid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: '', // Invalid empty command
          enabled: 'not-boolean', // Invalid type
        }),
      });

      const response = await action(
        createActionArgs(request, { projectId: 'test', serverId: 'invalid' })
      );
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
    });
  });
});
