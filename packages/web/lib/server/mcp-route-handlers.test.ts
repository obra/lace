// ABOUTME: Tests for MCP route handlers that abstract global vs project-scoped storage
// ABOUTME: Verifies correct behavior for listing, getting, creating, updating, and deleting MCP servers

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { McpServerConfigInput } from './mcp-route-handlers';

// Mock the dependencies before importing the module under test
vi.mock('@lace/web/lib/server/mcp-config-store', () => ({
  McpConfigStore: {
    loadGlobalConfig: vi.fn(),
    saveGlobalConfig: vi.fn(),
    updateServerConfig: vi.fn(),
    deleteServerConfig: vi.fn(),
  },
}));

vi.mock('@lace/web/lib/server/projects/project', () => ({
  Project: {
    getById: vi.fn(),
  },
}));

// Import after mocking
import {
  listMcpServers,
  getMcpServer,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  type McpRouteContext,
} from './mcp-route-handlers';
import { McpConfigStore } from '@lace/web/lib/server/mcp-config-store';
import { Project } from '@lace/web/lib/server/projects/project';
import { RouteValidationError } from './route-helpers';

const mockMcpConfigStore = vi.mocked(McpConfigStore);
const mockProject = vi.mocked(Project);

describe('MCP Route Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listMcpServers', () => {
    describe('global context (no projectId)', () => {
      const globalContext: McpRouteContext = {};

      it('returns empty array when no global config exists', async () => {
        mockMcpConfigStore.loadGlobalConfig.mockReturnValue(null);

        const result = await listMcpServers(globalContext);

        expect(result).toEqual([]);
        expect(mockMcpConfigStore.loadGlobalConfig).toHaveBeenCalled();
      });

      it('returns servers from global config', async () => {
        const serverConfig: McpServerConfigInput = {
          command: 'npx',
          args: ['mcp-server'],
          enabled: true,
        };
        mockMcpConfigStore.loadGlobalConfig.mockReturnValue({
          servers: { 'test-server': serverConfig },
        });

        const result = await listMcpServers(globalContext);

        expect(result).toEqual([{ id: 'test-server', ...serverConfig }]);
      });

      it('returns multiple servers', async () => {
        mockMcpConfigStore.loadGlobalConfig.mockReturnValue({
          servers: {
            server1: { command: 'cmd1', enabled: true },
            server2: { command: 'cmd2', enabled: false },
          },
        });

        const result = await listMcpServers(globalContext);

        expect(result).toHaveLength(2);
        expect(result.map((s) => s.id).sort()).toEqual(['server1', 'server2']);
      });
    });

    describe('project context (with projectId)', () => {
      const projectContext: McpRouteContext = { projectId: 'project-123' };

      it('throws RouteValidationError when project not found', async () => {
        mockProject.getById.mockReturnValue(null);

        await expect(listMcpServers(projectContext)).rejects.toThrow(RouteValidationError);
        await expect(listMcpServers(projectContext)).rejects.toThrow('Project not found');
      });

      it('returns servers from project', async () => {
        const serverConfig: McpServerConfigInput = {
          command: 'npx',
          args: ['project-server'],
          enabled: true,
        };
        const mockProjectInstance = {
          getMCPServers: vi.fn().mockReturnValue({ 'project-server': serverConfig }),
        };
        mockProject.getById.mockReturnValue(mockProjectInstance as unknown as Project);

        const result = await listMcpServers(projectContext);

        expect(result).toEqual([{ id: 'project-server', ...serverConfig }]);
        expect(mockProject.getById).toHaveBeenCalledWith('project-123');
      });
    });
  });

  describe('getMcpServer', () => {
    describe('global context', () => {
      const globalContext: McpRouteContext = {};

      it('throws RouteValidationError when server not found', async () => {
        mockMcpConfigStore.loadGlobalConfig.mockReturnValue({ servers: {} });

        await expect(getMcpServer(globalContext, 'nonexistent')).rejects.toThrow(
          RouteValidationError
        );
        await expect(getMcpServer(globalContext, 'nonexistent')).rejects.toThrow(
          "MCP server 'nonexistent' not found"
        );
      });

      it('throws RouteValidationError when no global config exists', async () => {
        mockMcpConfigStore.loadGlobalConfig.mockReturnValue(null);

        await expect(getMcpServer(globalContext, 'test-server')).rejects.toThrow(
          RouteValidationError
        );
      });

      it('returns server when found', async () => {
        const serverConfig: McpServerConfigInput = {
          command: 'npx',
          args: ['mcp-server'],
          enabled: true,
        };
        mockMcpConfigStore.loadGlobalConfig.mockReturnValue({
          servers: { 'test-server': serverConfig },
        });

        const result = await getMcpServer(globalContext, 'test-server');

        expect(result).toEqual({ id: 'test-server', ...serverConfig });
      });
    });

    describe('project context', () => {
      const projectContext: McpRouteContext = { projectId: 'project-123' };

      it('throws RouteValidationError when project not found', async () => {
        mockProject.getById.mockReturnValue(null);

        await expect(getMcpServer(projectContext, 'test-server')).rejects.toThrow(
          RouteValidationError
        );
        await expect(getMcpServer(projectContext, 'test-server')).rejects.toThrow(
          'Project not found'
        );
      });

      it('throws RouteValidationError when server not found in project', async () => {
        const mockProjectInstance = {
          getMCPServer: vi.fn().mockReturnValue(null),
        };
        mockProject.getById.mockReturnValue(mockProjectInstance as unknown as Project);

        await expect(getMcpServer(projectContext, 'nonexistent')).rejects.toThrow(
          RouteValidationError
        );
        await expect(getMcpServer(projectContext, 'nonexistent')).rejects.toThrow(
          "MCP server 'nonexistent' not found"
        );
      });

      it('returns server when found in project', async () => {
        const serverConfig: McpServerConfigInput = {
          command: 'npx',
          args: ['project-server'],
          enabled: true,
        };
        const mockProjectInstance = {
          getMCPServer: vi.fn().mockReturnValue(serverConfig),
        };
        mockProject.getById.mockReturnValue(mockProjectInstance as unknown as Project);

        const result = await getMcpServer(projectContext, 'project-server');

        expect(result).toEqual({ id: 'project-server', ...serverConfig });
        expect(mockProjectInstance.getMCPServer).toHaveBeenCalledWith('project-server');
      });
    });
  });

  describe('createMcpServer', () => {
    const newServerConfig: McpServerConfigInput = {
      command: 'npx',
      args: ['new-server'],
      enabled: true,
    };

    describe('global context', () => {
      const globalContext: McpRouteContext = {};

      it('throws RouteValidationError when server already exists', async () => {
        mockMcpConfigStore.loadGlobalConfig.mockReturnValue({
          servers: { 'existing-server': { command: 'cmd', enabled: true } },
        });

        await expect(
          createMcpServer(globalContext, 'existing-server', newServerConfig)
        ).rejects.toThrow(RouteValidationError);
        await expect(
          createMcpServer(globalContext, 'existing-server', newServerConfig)
        ).rejects.toThrow("MCP server 'existing-server' already exists");
      });

      it('creates server when it does not exist', async () => {
        mockMcpConfigStore.loadGlobalConfig.mockReturnValue({ servers: {} });

        const result = await createMcpServer(globalContext, 'new-server', newServerConfig);

        expect(result).toEqual({ id: 'new-server', ...newServerConfig });
        expect(mockMcpConfigStore.saveGlobalConfig).toHaveBeenCalledWith({
          servers: { 'new-server': newServerConfig },
        });
      });

      it('creates server when no global config exists', async () => {
        mockMcpConfigStore.loadGlobalConfig.mockReturnValue(null);

        const result = await createMcpServer(globalContext, 'new-server', newServerConfig);

        expect(result).toEqual({ id: 'new-server', ...newServerConfig });
        expect(mockMcpConfigStore.saveGlobalConfig).toHaveBeenCalledWith({
          servers: { 'new-server': newServerConfig },
        });
      });
    });

    describe('project context', () => {
      const projectContext: McpRouteContext = { projectId: 'project-123' };

      it('throws RouteValidationError when project not found', async () => {
        mockProject.getById.mockReturnValue(null);

        await expect(
          createMcpServer(projectContext, 'new-server', newServerConfig)
        ).rejects.toThrow(RouteValidationError);
      });

      it('throws RouteValidationError when server already exists in project', async () => {
        const mockProjectInstance = {
          getMCPServer: vi.fn().mockReturnValue({ command: 'existing', enabled: true }),
        };
        mockProject.getById.mockReturnValue(mockProjectInstance as unknown as Project);

        await expect(
          createMcpServer(projectContext, 'existing-server', newServerConfig)
        ).rejects.toThrow(RouteValidationError);
        await expect(
          createMcpServer(projectContext, 'existing-server', newServerConfig)
        ).rejects.toThrow("MCP server 'existing-server' already exists");
      });

      it('creates server in project when it does not exist', async () => {
        const mockProjectInstance = {
          getMCPServer: vi.fn().mockReturnValue(null),
          addMCPServer: vi.fn(),
        };
        mockProject.getById.mockReturnValue(mockProjectInstance as unknown as Project);

        const result = await createMcpServer(projectContext, 'new-server', newServerConfig);

        expect(result).toEqual({ id: 'new-server', ...newServerConfig });
        expect(mockProjectInstance.addMCPServer).toHaveBeenCalledWith(
          'new-server',
          newServerConfig
        );
      });
    });
  });

  describe('updateMcpServer', () => {
    const updates: Partial<McpServerConfigInput> = {
      enabled: false,
      args: ['updated-args'],
    };

    describe('global context', () => {
      const globalContext: McpRouteContext = {};

      it('throws RouteValidationError when server not found', async () => {
        mockMcpConfigStore.loadGlobalConfig.mockReturnValue({ servers: {} });

        await expect(updateMcpServer(globalContext, 'nonexistent', updates)).rejects.toThrow(
          RouteValidationError
        );
        await expect(updateMcpServer(globalContext, 'nonexistent', updates)).rejects.toThrow(
          "MCP server 'nonexistent' not found"
        );
      });

      it('updates server and returns merged config', async () => {
        const existingConfig: McpServerConfigInput = {
          command: 'npx',
          args: ['old-args'],
          enabled: true,
        };
        mockMcpConfigStore.loadGlobalConfig.mockReturnValue({
          servers: { 'test-server': existingConfig },
        });

        const result = await updateMcpServer(globalContext, 'test-server', updates);

        expect(result).toEqual({
          id: 'test-server',
          command: 'npx',
          args: ['updated-args'],
          enabled: false,
        });
        expect(mockMcpConfigStore.saveGlobalConfig).toHaveBeenCalledWith({
          servers: {
            'test-server': {
              command: 'npx',
              args: ['updated-args'],
              enabled: false,
            },
          },
        });
      });
    });

    describe('project context', () => {
      const projectContext: McpRouteContext = { projectId: 'project-123' };

      it('throws RouteValidationError when project not found', async () => {
        mockProject.getById.mockReturnValue(null);

        await expect(updateMcpServer(projectContext, 'test-server', updates)).rejects.toThrow(
          RouteValidationError
        );
      });

      it('throws RouteValidationError when server not found in project', async () => {
        const mockProjectInstance = {
          getMCPServer: vi.fn().mockReturnValue(null),
        };
        mockProject.getById.mockReturnValue(mockProjectInstance as unknown as Project);

        await expect(updateMcpServer(projectContext, 'nonexistent', updates)).rejects.toThrow(
          RouteValidationError
        );
      });

      it('updates server in project', async () => {
        const existingConfig: McpServerConfigInput = {
          command: 'npx',
          args: ['old-args'],
          enabled: true,
        };
        const mockProjectInstance = {
          getMCPServer: vi.fn().mockReturnValue(existingConfig),
          updateMCPServer: vi.fn(),
        };
        mockProject.getById.mockReturnValue(mockProjectInstance as unknown as Project);

        const result = await updateMcpServer(projectContext, 'test-server', updates);

        expect(result).toEqual({
          id: 'test-server',
          command: 'npx',
          args: ['updated-args'],
          enabled: false,
        });
        expect(mockProjectInstance.updateMCPServer).toHaveBeenCalledWith('test-server', {
          command: 'npx',
          args: ['updated-args'],
          enabled: false,
        });
      });
    });
  });

  describe('deleteMcpServer', () => {
    describe('global context', () => {
      const globalContext: McpRouteContext = {};

      it('throws RouteValidationError when server not found', async () => {
        mockMcpConfigStore.loadGlobalConfig.mockReturnValue({ servers: {} });

        await expect(deleteMcpServer(globalContext, 'nonexistent')).rejects.toThrow(
          RouteValidationError
        );
        await expect(deleteMcpServer(globalContext, 'nonexistent')).rejects.toThrow(
          "MCP server 'nonexistent' not found"
        );
      });

      it('deletes server when found', async () => {
        mockMcpConfigStore.loadGlobalConfig.mockReturnValue({
          servers: { 'test-server': { command: 'cmd', enabled: true } },
        });

        await deleteMcpServer(globalContext, 'test-server');

        expect(mockMcpConfigStore.saveGlobalConfig).toHaveBeenCalledWith({
          servers: {},
        });
      });
    });

    describe('project context', () => {
      const projectContext: McpRouteContext = { projectId: 'project-123' };

      it('throws RouteValidationError when project not found', async () => {
        mockProject.getById.mockReturnValue(null);

        await expect(deleteMcpServer(projectContext, 'test-server')).rejects.toThrow(
          RouteValidationError
        );
      });

      it('throws RouteValidationError when server not found in project', async () => {
        const mockProjectInstance = {
          getMCPServer: vi.fn().mockReturnValue(null),
        };
        mockProject.getById.mockReturnValue(mockProjectInstance as unknown as Project);

        await expect(deleteMcpServer(projectContext, 'nonexistent')).rejects.toThrow(
          RouteValidationError
        );
      });

      it('deletes server from project', async () => {
        const mockProjectInstance = {
          getMCPServer: vi.fn().mockReturnValue({ command: 'cmd', enabled: true }),
          deleteMCPServer: vi.fn(),
        };
        mockProject.getById.mockReturnValue(mockProjectInstance as unknown as Project);

        await deleteMcpServer(projectContext, 'test-server');

        expect(mockProjectInstance.deleteMCPServer).toHaveBeenCalledWith('test-server');
      });
    });
  });
});
