// ABOUTME: MCP server connection management using official TypeScript SDK
// ABOUTME: Handles server lifecycle, connection state, and provides SDK client access

import { EventEmitter } from 'events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '@lace/agent/utils/logger';
import type { MCPServerConfig, MCPServerConnection } from '@lace/agent/config/mcp-types';
import type { ToolRuntime } from '@lace/agent/tools/runtime/types';
import { RuntimeStdioClientTransport } from '@lace/agent/tools/runtime/runtime-stdio-transport';

export interface StartMCPServerInput {
  serverId: string;
  config: MCPServerConfig;
  runtime: ToolRuntime;
  hostCwd?: string;
}

interface ReplaceStoppedServerConfigOptions {
  desiredConnectionKey?: string;
  replaceConnectionKey?: string;
  status?: 'stopped' | 'failed';
  lastError?: string;
}

export function mcpConnectionKey(input: {
  serverId: string;
  config: Pick<MCPServerConfig, 'placement' | 'transport'>;
  runtimeId: string;
  runtimeCwd?: string;
  hostCwd?: string;
}): string {
  const placement = input.config.placement ?? 'host';
  const transport = input.config.transport ?? 'stdio';
  const effectiveCwd = placement === 'toolRuntime' ? input.runtimeCwd : input.hostCwd;
  return JSON.stringify([
    input.serverId,
    placement,
    transport,
    input.runtimeId,
    effectiveCwd ?? '',
  ]);
}

export class MCPServerManager extends EventEmitter {
  private servers = new Map<string, MCPServerConnection>();

  /**
   * Start a server if it's not already running
   */
  async startServer(input: StartMCPServerInput): Promise<void> {
    const { serverId, config, runtime, hostCwd } = input;
    const placement = config.placement ?? 'host';
    const transportKind = config.transport ?? 'stdio';
    const connectionKey = mcpConnectionKey({
      serverId,
      config,
      runtimeId: runtime.id,
      runtimeCwd: runtime.cwd,
      hostCwd,
    });
    const existing = this.servers.get(connectionKey);
    if (existing && (existing.status === 'running' || existing.status === 'starting')) {
      return; // Already running or starting
    }

    if (transportKind !== 'stdio') {
      throw new Error(`Unsupported MCP transport for stdio start: ${transportKind}`);
    }

    const connection: MCPServerConnection = {
      id: serverId,
      connectionKey,
      config,
      status: 'starting',
    };

    this.servers.set(connectionKey, connection);
    this.emit('server-status-changed', serverId, 'starting', connectionKey);

    try {
      // Create transport for spawning the server process
      const transport =
        placement === 'toolRuntime'
          ? new RuntimeStdioClientTransport({
              runtime,
              command: config.command,
              args: config.args,
              env: config.env,
              cwd: runtime.cwd,
            })
          : new StdioClientTransport({
              command: config.command,
              args: config.args,
              env: config.env,
              cwd: hostCwd,
            });

      // Create MCP client
      const client = new Client({ name: 'lace', version: '1.0.0' }, { capabilities: {} });

      // Store references before connecting
      connection.transport = transport;
      connection.client = client;

      // Set up error handling before connecting
      transport.onerror = (error) => {
        connection.status = 'failed';
        connection.lastError = error.message;
        this.emit('server-status-changed', serverId, 'failed', connectionKey);
        this.emit('server-error', serverId, error.message, connectionKey);
      };

      transport.onclose = () => {
        if (connection.status === 'running') {
          connection.status = 'stopped';
          this.emit('server-status-changed', serverId, 'stopped', connectionKey);
        }
      };

      // Connect client to server
      await client.connect(transport);

      connection.status = 'running';
      connection.connectedAt = new Date();
      this.emit('server-status-changed', serverId, 'running', connectionKey);
    } catch (error) {
      // Clean up transport and client on connection failure
      if (connection.transport) {
        await connection.transport.close();
        connection.transport = undefined;
      }
      if (connection.client) {
        await connection.client.close();
        connection.client = undefined;
      }

      connection.status = 'failed';
      connection.lastError = error instanceof Error ? error.message : 'Unknown error';
      this.emit('server-status-changed', serverId, 'failed', connectionKey);
      this.emit('server-error', serverId, connection.lastError, connectionKey);
      throw error;
    }
  }

  /**
   * Register a pre-built connection without spawning a subprocess.
   *
   * Intended for cases where the caller owns the underlying MCP client
   * lifecycle (e.g., tests with stubbed clients, or in-process servers).
   * Throws if a connection with the same id is already registered.
   */
  registerConnection(
    serverId: string,
    connection: Omit<MCPServerConnection, 'connectionKey'> & { connectionKey?: string }
  ): void {
    const connectionKey =
      connection.connectionKey ??
      mcpConnectionKey({
        serverId,
        config: connection.config,
        runtimeId: 'registered',
        runtimeCwd: 'registered',
        hostCwd: 'registered',
      });
    if (this.servers.has(connectionKey)) {
      throw new Error(`Server '${serverId}' is already registered`);
    }
    this.servers.set(connectionKey, { ...connection, connectionKey });
    this.emit('server-status-changed', serverId, connection.status, connectionKey);
  }

  /**
   * Stop a server
   */
  async stopServer(serverId: string): Promise<void> {
    const connections = this.resolveConnections(serverId);
    if (connections.length === 0) {
      return;
    }

    for (const connection of connections) {
      try {
        // Close client connection (which closes transport)
        if (connection.client) {
          await connection.client.close();
        }

        // Clean up transport if still active
        if (connection.transport) {
          await connection.transport.close();
        }
      } catch (error) {
        // Log but don't throw - we want to clean up state regardless
        logger.warn(`Error stopping server ${connection.id}:`, { serverId: connection.id, error });
      }

      connection.status = 'stopped';
      connection.client = undefined;
      connection.transport = undefined;
      this.emit('server-status-changed', connection.id, 'stopped', connection.connectionKey);
    }
  }

  /**
   * Replace config for an already-stopped server without spawning a subprocess.
   */
  replaceStoppedServerConfig(
    serverId: string,
    config: MCPServerConfig,
    options: ReplaceStoppedServerConfigOptions = {}
  ): void {
    const replacement = options.replaceConnectionKey
      ? this.servers.get(options.replaceConnectionKey)
      : undefined;
    const connections = replacement ? [replacement] : this.resolveConnections(serverId);
    let primary: MCPServerConnection | undefined;

    for (const connection of connections) {
      if (connection.status !== 'stopped') {
        continue;
      }

      if (primary) {
        this.servers.delete(connection.connectionKey);
        continue;
      }

      primary = connection;
      connection.config = config;
      connection.status = options.status ?? 'stopped';
      connection.lastError = options.lastError;
      if (
        options.desiredConnectionKey &&
        options.desiredConnectionKey !== connection.connectionKey
      ) {
        this.servers.delete(connection.connectionKey);
        connection.connectionKey = options.desiredConnectionKey;
        this.servers.set(options.desiredConnectionKey, connection);
      }
    }

    if (!primary && options.desiredConnectionKey) {
      const status = options.status ?? 'stopped';
      this.servers.set(options.desiredConnectionKey, {
        id: serverId,
        connectionKey: options.desiredConnectionKey,
        config,
        status,
        ...(options.lastError ? { lastError: options.lastError } : {}),
      });
      this.emit('server-status-changed', serverId, status, options.desiredConnectionKey);
    }
  }

  /**
   * Get server connection by ID
   */
  getServer(serverId: string): MCPServerConnection | undefined {
    return this.servers.get(serverId) ?? this.resolveUniqueServerId(serverId);
  }

  /**
   * Get all server connections
   */
  getAllServers(): MCPServerConnection[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get MCP client for a running server (for tool operations)
   */
  getClient(serverId: string): Client | undefined {
    const server = this.getServer(serverId);
    return server?.status === 'running' ? server.client : undefined;
  }

  /**
   * Cleanup all servers on shutdown
   */
  async shutdown(): Promise<void> {
    const stopPromises = Array.from(this.servers.keys()).map((id) => this.stopServer(id));
    await Promise.allSettled(stopPromises); // Use allSettled to handle errors gracefully
    this.servers.clear();
  }

  private resolveConnections(serverIdOrConnectionKey: string): MCPServerConnection[] {
    const connection = this.servers.get(serverIdOrConnectionKey);
    if (connection) {
      return [connection];
    }

    return Array.from(this.servers.values()).filter(
      (candidate) => candidate.id === serverIdOrConnectionKey
    );
  }

  private resolveUniqueServerId(serverId: string): MCPServerConnection | undefined {
    const matches = Array.from(this.servers.values()).filter((server) => server.id === serverId);
    return matches.length === 1 ? matches[0] : undefined;
  }
}
