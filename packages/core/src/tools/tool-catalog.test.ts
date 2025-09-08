// ABOUTME: Tests for ToolCatalog class that provides fast tool enumeration and async discovery
// ABOUTME: Ensures proper caching, background discovery, and integration with MCP servers

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolCatalog } from './tool-catalog';
import type { MCPServerConfig } from '~/config/mcp-types';

// Mock dependencies
const mockProject = {
  getMCPServers: vi.fn(),
  getWorkingDirectory: vi.fn().mockReturnValue('/test/project'),
};

const mockServerManager = {
  startServer: vi.fn(),
  getClient: vi.fn(),
  shutdown: vi.fn(),
};

const mockClient = {
  listTools: vi.fn(),
};

vi.mock('~/mcp/server-manager', () => ({
  MCPServerManager: vi.fn(() => mockServerManager),
}));

vi.mock('~/config/mcp-config-loader', () => ({
  MCPConfigLoader: {
    updateServerConfig: vi.fn(),
    loadConfig: vi.fn(),
  },
}));

describe('ToolCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServerManager.getClient.mockReturnValue(mockClient);
  });

  describe('getAvailableTools', () => {
    it('should return native tools for projects without MCP servers', () => {
      mockProject.getMCPServers.mockReturnValue({});

      const tools = ToolCatalog.getAvailableTools(mockProject as any);

      expect(tools).toContain('bash');
      expect(tools).toContain('file_read');
      expect(tools).toContain('task_create');
      expect(tools.length).toBe(15); // All native tools
    });

    it('should include configured MCP tools from cache', () => {
      mockProject.getMCPServers.mockReturnValue({
        filesystem: {
          enabled: true,
          tools: { read_file: 'allow-once', write_file: 'deny' },
          discoveredTools: [
            { name: 'read_file', description: 'Read files' },
            { name: 'write_file', description: 'Write files' },
          ],
          discoveryStatus: 'success',
        },
      });

      const tools = ToolCatalog.getAvailableTools(mockProject as any);

      expect(tools).toContain('filesystem/read_file');
      expect(tools).toContain('filesystem/write_file');
    });

    it('should fallback to configured tool policies when no discovery cache', () => {
      mockProject.getMCPServers.mockReturnValue({
        git: {
          enabled: true,
          tools: { git_status: 'allow-once', git_commit: 'ask' },
          // No discoveredTools - should use keys from tools config
        },
      });

      const tools = ToolCatalog.getAvailableTools(mockProject as any);

      expect(tools).toContain('git/git_status');
      expect(tools).toContain('git/git_commit');
    });

    it('should exclude disabled MCP servers', () => {
      mockProject.getMCPServers.mockReturnValue({
        disabled_server: {
          enabled: false,
          tools: { some_tool: 'allow-once' },
        },
      });

      const tools = ToolCatalog.getAvailableTools(mockProject as any);

      expect(tools).not.toContain('disabled_server/some_tool');
    });
  });

  describe('discoverAndCacheTools', () => {
    const testConfig: MCPServerConfig = {
      command: 'npx',
      args: ['test-server'],
      enabled: true,
      tools: {},
    };

    afterEach(async () => {
      // Wait for background discovery to complete
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('should update config with discovering status immediately', async () => {
      const { MCPConfigLoader } = vi.mocked(await import('~/config/mcp-config-loader'));

      await ToolCatalog.discoverAndCacheTools('test-server', testConfig, '/test/project');

      expect(MCPConfigLoader.updateServerConfig).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({
          discoveryStatus: 'discovering',
          lastDiscovery: expect.any(String),
        }),
        '/test/project'
      );
    });

    it('should not block caller during discovery', async () => {
      // Mock slow discovery
      mockClient.listTools.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ tools: [] }), 100))
      );

      const startTime = Date.now();
      await ToolCatalog.discoverAndCacheTools('slow-server', testConfig);
      const elapsed = Date.now() - startTime;

      // Should return immediately, not wait for discovery
      expect(elapsed).toBeLessThan(50);
    });

    it('should cache discovered tools on success', async () => {
      mockClient.listTools.mockResolvedValue({
        tools: [
          { name: 'read_file', description: 'Read files' },
          { name: 'write_file', description: 'Write files' },
        ],
      });

      await ToolCatalog.discoverAndCacheTools('filesystem', testConfig, '/test/project');

      // Wait for background discovery
      await new Promise((resolve) => setTimeout(resolve, 20));

      const { MCPConfigLoader } = vi.mocked(await import('~/config/mcp-config-loader'));
      expect(MCPConfigLoader.updateServerConfig).toHaveBeenLastCalledWith(
        'filesystem',
        expect.objectContaining({
          discoveredTools: [
            { name: 'read_file', description: 'Read files' },
            { name: 'write_file', description: 'Write files' },
          ],
          discoveryStatus: 'success',
        }),
        '/test/project'
      );
    });

    it('should cache error status on discovery failure', async () => {
      mockClient.listTools.mockRejectedValue(new Error('Connection failed'));

      await ToolCatalog.discoverAndCacheTools('broken-server', testConfig);

      // Wait for background discovery
      await new Promise((resolve) => setTimeout(resolve, 20));

      const { MCPConfigLoader } = vi.mocked(await import('~/config/mcp-config-loader'));
      expect(MCPConfigLoader.updateServerConfig).toHaveBeenLastCalledWith(
        'broken-server',
        expect.objectContaining({
          discoveryStatus: 'failed',
          discoveryError: 'Connection failed',
        }),
        undefined
      );
    });

    it('should handle server startup failure', async () => {
      // Reset mocks to avoid interference from previous tests
      vi.clearAllMocks();
      mockServerManager.getClient.mockReturnValue(mockClient);

      mockServerManager.startServer.mockRejectedValue(new Error('Startup failed'));

      await ToolCatalog.discoverAndCacheTools('broken-server', testConfig);

      // Wait for background discovery
      await new Promise((resolve) => setTimeout(resolve, 20));

      const { MCPConfigLoader } = vi.mocked(await import('~/config/mcp-config-loader'));
      expect(MCPConfigLoader.updateServerConfig).toHaveBeenLastCalledWith(
        'broken-server',
        expect.objectContaining({
          discoveryStatus: 'failed',
          discoveryError: 'Startup failed',
        }),
        undefined
      );
    });
  });
});
