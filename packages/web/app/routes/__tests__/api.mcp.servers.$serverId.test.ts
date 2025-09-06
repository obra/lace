// ABOUTME: Tests for individual global MCP server management API
// ABOUTME: Validates CRUD operations for specific global MCP servers

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loader, action } from '@/app/routes/api.mcp.servers.$serverId';
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

// Mock the MCPConfigLoader
vi.mock('@/lib/server/lace-imports', async () => {
  const actual = await vi.importActual('@/lib/server/lace-imports');
  return {
    ...actual,
    MCPConfigLoader: {
      loadGlobalConfig: vi.fn(),
      saveGlobalConfig: vi.fn(),
    },
  };
});

describe('Individual Global MCP Server Management API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/mcp/servers/:serverId', () => {
    it('should return specific server configuration', async () => {
      const { MCPConfigLoader } = vi.mocked(await import('@/lib/server/lace-imports'));
      MCPConfigLoader.loadGlobalConfig = vi.fn().mockReturnValue({
        servers: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem'],
            enabled: true,
            tools: { read_file: 'allow-session' },
          },
        },
      });

      const request = new Request('http://localhost/api/mcp/servers/filesystem');
      const response = await loader(createLoaderArgs(request, { serverId: 'filesystem' }));
      const data = await parseResponse<ServerResponse>(response);

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        id: 'filesystem',
        command: 'npx',
        enabled: true,
      });
    });

    it('should return 404 for non-existent server', async () => {
      const { MCPConfigLoader } = vi.mocked(await import('@/lib/server/lace-imports'));
      MCPConfigLoader.loadGlobalConfig = vi.fn().mockReturnValue({
        servers: {},
      });

      const request = new Request('http://localhost/api/mcp/servers/nonexistent');
      const response = await loader(createLoaderArgs(request, { serverId: 'nonexistent' }));

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/mcp/servers/:serverId', () => {
    it('should create new global server', async () => {
      const { MCPConfigLoader } = vi.mocked(await import('@/lib/server/lace-imports'));
      MCPConfigLoader.loadGlobalConfig = vi.fn().mockReturnValue({
        servers: {},
      });

      const request = new Request('http://localhost/api/mcp/servers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'echo',
          args: ['hello'],
          enabled: true,
          tools: { echo: 'allow-session' },
        }),
      });

      const response = await action(createActionArgs(request, { serverId: 'test' }));
      const data = await parseResponse<ServerActionResponse>(response);

      expect(response.status).toBe(201);
      expect(data.message).toContain('created successfully');
      expect(MCPConfigLoader.saveGlobalConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          servers: {
            test: expect.objectContaining({
              command: 'echo',
              enabled: true,
            }),
          },
        })
      );
    });

    it('should prevent duplicate server creation', async () => {
      const { MCPConfigLoader } = vi.mocked(await import('@/lib/server/lace-imports'));
      MCPConfigLoader.loadGlobalConfig = vi.fn().mockReturnValue({
        servers: {
          existing: {
            command: 'node',
            enabled: true,
            tools: {},
          },
        },
      });

      const request = new Request('http://localhost/api/mcp/servers/existing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'echo',
          enabled: true,
          tools: {},
        }),
      });

      const response = await action(createActionArgs(request, { serverId: 'existing' }));

      expect(response.status).toBe(409);
    });
  });

  describe('PUT /api/mcp/servers/:serverId', () => {
    it('should update existing server', async () => {
      const { MCPConfigLoader } = vi.mocked(await import('@/lib/server/lace-imports'));
      MCPConfigLoader.loadGlobalConfig = vi.fn().mockReturnValue({
        servers: {
          filesystem: {
            command: 'npx',
            enabled: true,
            tools: { read_file: 'allow-session' },
          },
        },
      });

      const request = new Request('http://localhost/api/mcp/servers/filesystem', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: false,
          tools: { read_file: 'deny' },
        }),
      });

      const response = await action(createActionArgs(request, { serverId: 'filesystem' }));

      expect(response.status).toBe(200);
      expect(MCPConfigLoader.saveGlobalConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          servers: {
            filesystem: expect.objectContaining({
              enabled: false,
              tools: { read_file: 'deny' },
            }),
          },
        })
      );
    });
  });

  describe('DELETE /api/mcp/servers/:serverId', () => {
    it('should delete existing server', async () => {
      const { MCPConfigLoader } = vi.mocked(await import('@/lib/server/lace-imports'));
      MCPConfigLoader.loadGlobalConfig = vi.fn().mockReturnValue({
        servers: {
          filesystem: {
            command: 'npx',
            enabled: true,
            tools: {},
          },
        },
      });

      const request = new Request('http://localhost/api/mcp/servers/filesystem', {
        method: 'DELETE',
      });

      const response = await action(createActionArgs(request, { serverId: 'filesystem' }));
      const data = await parseResponse<ServerActionResponse>(response);

      expect(response.status).toBe(200);
      expect(data.message).toContain('deleted successfully');

      // Verify the server was removed from config
      expect(MCPConfigLoader.saveGlobalConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          servers: {}, // Should be empty after deletion
        })
      );
    });
  });
});
