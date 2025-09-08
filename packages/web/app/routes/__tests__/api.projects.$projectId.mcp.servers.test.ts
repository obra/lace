// ABOUTME: Tests for project-scoped MCP server list API following Lace project hierarchy patterns
// ABOUTME: Validates project MCP server configuration retrieval and error handling

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loader } from '@/app/routes/api.projects.$projectId.mcp.servers';
import { parseResponse } from '@/lib/serialization';
import { createLoaderArgs } from '@/test-utils/route-test-helpers';

interface ProjectMCPServerListResponse {
  projectId: string;
  servers: Array<{
    id: string;
    command: string;
    args?: string[];
    enabled: boolean;
    tools: Record<string, string>;
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
      tools: { read_file: 'allow-session' },
    },
    git: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-git'],
      enabled: false,
      tools: { git_status: 'ask' },
    },
  }),
};

vi.mock('@/lib/server/lace-imports', () => ({
  Project: {
    getById: vi.fn(),
  },
}));

describe('Project MCP Server List API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return project MCP server configurations', async () => {
    const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
    Project.getById = vi.fn().mockReturnValue(mockProject);

    const request = new Request('http://localhost/api/projects/test-project/mcp/servers');
    const response = await loader(createLoaderArgs(request, { projectId: 'test-project' }));
    const data = await parseResponse<ProjectMCPServerListResponse>(response);

    expect(response.status).toBe(200);
    expect(data.projectId).toBe('test-project');
    expect(data.servers).toHaveLength(2);
    expect(data.servers[0]).toMatchObject({
      id: 'filesystem',
      command: 'npx',
      enabled: true,
    });
    expect(data.servers[1]).toMatchObject({
      id: 'git',
      command: 'npx',
      enabled: false,
    });
  });

  it('should return empty list when project has no MCP servers', async () => {
    const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
    const projectWithNoMCP = {
      ...mockProject,
      getMCPServers: vi.fn().mockReturnValue({}),
    };
    Project.getById = vi.fn().mockReturnValue(projectWithNoMCP);

    const request = new Request('http://localhost/api/projects/test-project/mcp/servers');
    const response = await loader(createLoaderArgs(request, { projectId: 'test-project' }));
    const data = await parseResponse<ProjectMCPServerListResponse>(response);

    expect(response.status).toBe(200);
    expect(data.projectId).toBe('test-project');
    expect(data.servers).toEqual([]);
  });

  it('should return 404 when project not found', async () => {
    const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
    Project.getById = vi.fn().mockReturnValue(null);

    const request = new Request('http://localhost/api/projects/nonexistent/mcp/servers');
    const response = await loader(createLoaderArgs(request, { projectId: 'nonexistent' }));
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Project not found');
  });

  it('should return 400 for invalid project ID', async () => {
    const request = new Request('http://localhost/api/projects//mcp/servers');
    const response = await loader(createLoaderArgs(request, { projectId: '' }));
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid project ID');
  });

  it('should handle project MCP configuration errors', async () => {
    const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
    const projectWithError = {
      ...mockProject,
      getMCPServers: vi.fn().mockImplementation(() => {
        throw new Error('MCP config corrupted');
      }),
    };
    Project.getById = vi.fn().mockReturnValue(projectWithError);

    const request = new Request('http://localhost/api/projects/test-project/mcp/servers');
    const response = await loader(createLoaderArgs(request, { projectId: 'test-project' }));
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to load server configuration');
  });
});
