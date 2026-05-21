import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPServerManager, mcpConnectionKey } from './server-manager';
import type { MCPServerConfig } from './types';
import { RuntimeStdioClientTransport } from '../tools/runtime/runtime-stdio-transport';
import { createFakeRuntime } from '../tools/runtime/__tests__/fake-runtime';

// Mock the MCP SDK modules
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockImplementation(async (transport?: { start?: () => Promise<void> }) => {
      await transport?.start?.();
    }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  getDefaultEnvironment: vi.fn(() => ({ PATH: '/usr/bin' })),
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

    await manager.startServer({
      serverId: 'test-server',
      config,
      runtime: createFakeRuntime(),
      hostCwd: '/host/project',
    });

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
      enabled: true,
      tools: {},
    };

    // Pass cwd directly as part of the extended config (simulating what session does)
    await manager.startServer({
      serverId: 'test',
      config,
      runtime: createFakeRuntime(),
      hostCwd: '/test/dir',
    });

    expect(StdioClientTransport).toHaveBeenCalledWith({
      command: 'node',
      args: ['server.js'],
      env: { NODE_ENV: 'test' },
      cwd: '/test/dir',
    });

    expect(Client).toHaveBeenCalledWith({ name: 'lace', version: '1.0.0' }, { capabilities: {} });

    const server = manager.getServer('test');
    expect(server?.status).toBe('running');
    expect(server?.client).toBeDefined();
    expect(server?.transport).toBeDefined();
    expect(server?.connectionKey).toBe(
      mcpConnectionKey({
        serverId: 'test',
        config,
        runtimeId: 'rt_fake',
        hostCwd: '/test/dir',
      })
    );
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

    await expect(
      manager.startServer({
        serverId: 'failing-server',
        config,
        runtime: createFakeRuntime(),
        hostCwd: '/host/project',
      })
    ).rejects.toThrow('Connection failed');

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

    await manager.startServer({
      serverId: 'test',
      config,
      runtime: createFakeRuntime(),
      hostCwd: '/host/project',
    });

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

    await manager.startServer({
      serverId: 'test',
      config,
      runtime: createFakeRuntime(),
      hostCwd: '/host/project',
    });

    const client = manager.getClient('test');
    expect(client).toBeDefined();

    await manager.stopServer('test');

    const stoppedClient = manager.getClient('test');
    expect(stoppedClient).toBeUndefined();
  });

  it('keeps host and runtime placed connections with the same server id distinct', async () => {
    const hostRuntime = createFakeRuntime();
    const toolRuntime = createFakeRuntime();
    Object.assign(toolRuntime, { id: 'rt_projected', cwd: '/runtime/project' });
    const config: MCPServerConfig = {
      command: 'node',
      transport: 'stdio',
      enabled: true,
      tools: {},
    };

    await manager.startServer({
      serverId: 'shared',
      config: { ...config, placement: 'host' },
      runtime: hostRuntime,
      hostCwd: '/host/project',
    });
    await manager.startServer({
      serverId: 'shared',
      config: { ...config, placement: 'toolRuntime' },
      runtime: toolRuntime,
      hostCwd: '/host/project',
    });

    const servers = manager.getAllServers();
    expect(servers.map((server) => server.connectionKey).sort()).toEqual([
      mcpConnectionKey({
        serverId: 'shared',
        config: { ...config, placement: 'host' },
        runtimeId: 'rt_fake',
        runtimeCwd: '/runtime',
        hostCwd: '/host/project',
      }),
      mcpConnectionKey({
        serverId: 'shared',
        config: { ...config, placement: 'toolRuntime' },
        runtimeId: 'rt_projected',
        runtimeCwd: '/runtime/project',
        hostCwd: '/host/project',
      }),
    ]);
    expect(servers).toHaveLength(2);
    expect(manager.getServer('shared')).toBeUndefined();
  });

  it('keeps runtime placed connections with the same runtime id and different cwd distinct', async () => {
    const firstRuntime = createFakeRuntime();
    Object.assign(firstRuntime, { id: 'rt_shared', cwd: '/runtime/one' });
    const secondRuntime = createFakeRuntime();
    Object.assign(secondRuntime, { id: 'rt_shared', cwd: '/runtime/two' });
    const config: MCPServerConfig = {
      command: 'node',
      transport: 'stdio',
      placement: 'toolRuntime',
      enabled: true,
      tools: {},
    };

    await manager.startServer({
      serverId: 'shared-runtime',
      config,
      runtime: firstRuntime,
      hostCwd: '/host/project',
    });
    await manager.startServer({
      serverId: 'shared-runtime',
      config,
      runtime: secondRuntime,
      hostCwd: '/host/project',
    });

    expect(
      manager
        .getAllServers()
        .map((server) => server.connectionKey)
        .sort()
    ).toEqual([
      mcpConnectionKey({
        serverId: 'shared-runtime',
        config,
        runtimeId: 'rt_shared',
        runtimeCwd: '/runtime/one',
        hostCwd: '/host/project',
      }),
      mcpConnectionKey({
        serverId: 'shared-runtime',
        config,
        runtimeId: 'rt_shared',
        runtimeCwd: '/runtime/two',
        hostCwd: '/host/project',
      }),
    ]);
  });

  it('keeps structured connection keys collision-free when fields contain colons', () => {
    expect(
      mcpConnectionKey({
        serverId: 'shared',
        config: { placement: 'toolRuntime', transport: 'stdio' },
        runtimeId: 'rt:a',
        runtimeCwd: 'b:/work',
      })
    ).not.toBe(
      mcpConnectionKey({
        serverId: 'shared',
        config: { placement: 'toolRuntime', transport: 'stdio' },
        runtimeId: 'rt:a:b',
        runtimeCwd: '/work',
      })
    );
  });

  it('uses runtime stdio transport for runtime placement and SDK stdio for host placement', async () => {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const runtime = createFakeRuntime();
    const config: MCPServerConfig = {
      command: 'node',
      args: ['server.js'],
      env: { NODE_ENV: 'test' },
      transport: 'stdio',
      enabled: true,
      tools: {},
    };

    await manager.startServer({
      serverId: 'runtime-server',
      config: { ...config, placement: 'toolRuntime' },
      runtime,
      hostCwd: '/host/project',
    });
    await manager.startServer({
      serverId: 'host-server',
      config: { ...config, placement: 'host' },
      runtime,
      hostCwd: '/host/project',
    });

    expect(runtime.process.start).toHaveBeenCalledWith(
      ['node', 'server.js'],
      expect.objectContaining({
        cwd: '/runtime',
        env: expect.objectContaining({ NODE_ENV: 'test' }),
        envMode: 'replace',
      })
    );
    expect(StdioClientTransport).toHaveBeenCalledTimes(1);
    expect(manager.getServer('runtime-server')?.transport).toBeInstanceOf(
      RuntimeStdioClientTransport
    );
  });
});
