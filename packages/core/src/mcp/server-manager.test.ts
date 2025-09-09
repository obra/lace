import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPServerManager } from './server-manager';
import type { MCPServerConfig } from './types';

// Mock the MCP SDK modules
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
    onerror: null,
    onclose: null,
  })),
}));

describe('MCPServerManager', () => {
  let manager: MCPServerManager;

  beforeEach(() => {
    manager = new MCPServerManager();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  it('should track server status changes', async () => {
    const statusChanges: Array<{ serverId: string; status: string }> = [];

    manager.on('server-status-changed', (serverId, status) => {
      statusChanges.push({ serverId, status });
    });

    const config: MCPServerConfig = {
      command: 'node',
      args: ['test-server.js'],
      enabled: true,
      tools: {},
    };

    await manager.startServer('test-server', config);

    expect(statusChanges).toEqual([
      { serverId: 'test-server', status: 'starting' },
      { serverId: 'test-server', status: 'running' },
    ]);
  });

  it('should create client and transport instances', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

    const config: MCPServerConfig = {
      command: 'node',
      args: ['server.js'],
      env: { NODE_ENV: 'test' },
      cwd: '/test/dir',
      enabled: true,
      tools: {},
    };

    await manager.startServer('test', config);

    expect(StdioClientTransport).toHaveBeenCalledWith({
      command: 'node',
      args: ['server.js'],
      env: { NODE_ENV: 'test' },
      cwd: '/test/dir',
    });

    expect(Client).toHaveBeenCalledWith(
      { name: 'lace', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    const server = manager.getServer('test');
    expect(server?.status).toBe('running');
    expect(server?.client).toBeDefined();
    expect(server?.transport).toBeDefined();
  });

  it('should handle connection errors', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');

    // Mock client.connect to throw error
    const mockClient = {
      connect: vi.fn().mockRejectedValue(new Error('Connection failed')),
      close: vi.fn(),
    };

    const MockedClient = vi.mocked(Client);
    MockedClient.mockImplementationOnce(() => mockClient);

    const errorEvents: Array<{ serverId: string; error: string }> = [];
    manager.on('server-error', (serverId, error) => {
      errorEvents.push({ serverId, error });
    });

    const config: MCPServerConfig = {
      command: 'nonexistent-command',
      enabled: true,
      tools: {},
    };

    await expect(manager.startServer('failing-server', config)).rejects.toThrow(
      'Connection failed'
    );

    const server = manager.getServer('failing-server');
    expect(server?.status).toBe('failed');
    expect(server?.lastError).toBe('Connection failed');
    expect(errorEvents).toContainEqual({
      serverId: 'failing-server',
      error: 'Connection failed',
    });
  });

  it('should stop servers cleanly', async () => {
    const config: MCPServerConfig = {
      command: 'node',
      args: ['server.js'],
      enabled: true,
      tools: {},
    };

    await manager.startServer('test', config);

    const server = manager.getServer('test');
    expect(server?.status).toBe('running');

    await manager.stopServer('test');

    const stoppedServer = manager.getServer('test');
    expect(stoppedServer?.status).toBe('stopped');
    expect(stoppedServer?.client).toBeUndefined();
    expect(stoppedServer?.transport).toBeUndefined();
  });

  it('should provide client access for running servers', async () => {
    const config: MCPServerConfig = {
      command: 'node',
      enabled: true,
      tools: {},
    };

    await manager.startServer('test', config);

    const client = manager.getClient('test');
    expect(client).toBeDefined();

    await manager.stopServer('test');

    const stoppedClient = manager.getClient('test');
    expect(stoppedClient).toBeUndefined();
  });
});
