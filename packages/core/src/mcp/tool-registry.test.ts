import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPToolRegistry } from './tool-registry';
import { MCPServerManager } from './server-manager';
import type { MCPConfig } from './types';

// Mock dependencies
vi.mock('./server-manager');

describe('MCPToolRegistry', () => {
  let registry: MCPToolRegistry;
  let mockServerManager: MCPServerManager;

  beforeEach(() => {
    // Create a real EventEmitter for the mock
    mockServerManager = Object.assign(new (require('events').EventEmitter)(), {
      startServer: vi.fn().mockResolvedValue(),
      getClient: vi.fn().mockReturnValue({
        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: 'read_file',
              description: 'Read a file',
              inputSchema: {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path'],
              },
            },
          ],
        }),
      }),
      getAllServers: vi.fn().mockReturnValue([]),
      shutdown: vi.fn().mockResolvedValue(),
    });

    registry = new MCPToolRegistry(mockServerManager);
  });

  afterEach(async () => {
    await registry.shutdown();
  });

  it('should initialize and start enabled servers', async () => {
    const config: MCPConfig = {
      servers: {
        filesystem: {
          command: 'node',
          args: ['fs.js'],
          enabled: true,
          tools: { read_file: 'allow-session' },
        },
        browser: {
          command: 'python',
          args: ['browser.py'],
          enabled: false, // Should not start this one
          tools: {},
        },
      },
    };

    await registry.initialize(config);

    expect(mockServerManager.startServer).toHaveBeenCalledWith(
      'filesystem',
      config.servers.filesystem
    );
    expect(mockServerManager.startServer).not.toHaveBeenCalledWith('browser', expect.anything());
  });

  it('should discover tools when server comes online', async () => {
    const toolsUpdated = vi.fn();
    registry.on('tools-updated', toolsUpdated);

    // Simulate server coming online
    mockServerManager.emit('server-status-changed', 'filesystem', 'running');

    // Wait for async tool discovery
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(toolsUpdated).toHaveBeenCalledWith(
      'filesystem',
      expect.arrayContaining([
        expect.objectContaining({
          name: 'filesystem/read_file',
          description: 'Read a file',
        }),
      ])
    );
  });

  it('should filter disabled tools from available tools', () => {
    // Manually set up tools for testing
    const mockTool = {
      description: 'Write file',
      schema: vi.fn(),
      execute: vi.fn(),
    } as any;

    registry['toolsByServer'].set('filesystem', [
      { name: 'filesystem/read_file', ...mockTool },
      { name: 'filesystem/write_file', ...mockTool },
    ]);

    const config: MCPConfig = {
      servers: {
        filesystem: {
          command: 'node',
          enabled: true,
          tools: {
            read_file: 'allow-session',
            write_file: 'disable', // This should be filtered out
          },
        },
      },
    };

    const availableTools = registry.getAvailableTools(config);

    expect(availableTools).toHaveLength(1);
    expect(availableTools[0].name).toBe('filesystem/read_file');
  });

  it('should get correct approval level for tools', () => {
    const config: MCPConfig = {
      servers: {
        filesystem: {
          command: 'node',
          enabled: true,
          tools: {
            read_file: 'allow-session',
            write_file: 'require-approval',
          },
        },
      },
    };

    expect(registry.getToolApprovalLevel(config, 'filesystem/read_file')).toBe('allow-session');
    expect(registry.getToolApprovalLevel(config, 'filesystem/write_file')).toBe('require-approval');
    expect(registry.getToolApprovalLevel(config, 'filesystem/unknown_tool')).toBe(
      'require-approval'
    );
  });

  it('should handle tool discovery errors gracefully', async () => {
    const errorHandler = vi.fn();
    registry.on('tool-discovery-error', errorHandler);

    // Mock getClient to return a client that throws an error
    vi.spyOn(mockServerManager, 'getClient').mockReturnValue({
      listTools: vi.fn().mockRejectedValue(new Error('Server unavailable')),
    } as any);

    // Simulate server coming online
    mockServerManager.emit('server-status-changed', 'filesystem', 'running');

    // Wait for async error handling
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(errorHandler).toHaveBeenCalledWith('filesystem', 'Server unavailable');
  });

  it('should clear tools when server stops', () => {
    // Set up tools first
    const mockTool = { name: 'filesystem/read_file' } as any;
    registry['toolsByServer'].set('filesystem', [mockTool]);

    const toolsUpdated = vi.fn();
    registry.on('tools-updated', toolsUpdated);

    // Simulate server stopping
    mockServerManager.emit('server-status-changed', 'filesystem', 'stopped');

    expect(registry.getServerTools('filesystem')).toHaveLength(0);
    expect(toolsUpdated).toHaveBeenCalledWith('filesystem', []);
  });
});
