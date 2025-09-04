// ABOUTME: MCP server connection management using official TypeScript SDK
// ABOUTME: Handles server lifecycle, connection state, and provides SDK client access

import { EventEmitter } from 'events';
import { Client } from '../../../vendor/typescript-sdk/src/client/index.js';
import { StdioClientTransport } from '../../../vendor/typescript-sdk/src/client/stdio.js';
import type { MCPServerConfig, MCPServerConnection } from './types';

export interface ServerManagerEvents {
  'server-status-changed': (serverId: string, status: MCPServerConnection['status']) => void;
  'server-error': (serverId: string, error: string) => void;
}

export declare interface MCPServerManager {
  on<K extends keyof ServerManagerEvents>(event: K, listener: ServerManagerEvents[K]): this;
  emit<K extends keyof ServerManagerEvents>(
    event: K,
    ...args: Parameters<ServerManagerEvents[K]>
  ): boolean;
}

export class MCPServerManager extends EventEmitter {
  private servers = new Map<string, MCPServerConnection>();

  /**
   * Start a server if it's not already running
   */
  async startServer(serverId: string, config: MCPServerConfig): Promise<void> {
    const existing = this.servers.get(serverId);
    if (existing && (existing.status === 'running' || existing.status === 'starting')) {
      return; // Already running or starting
    }

    const connection: MCPServerConnection = {
      id: serverId,
      config,
      status: 'starting',
    };

    this.servers.set(serverId, connection);
    this.emit('server-status-changed', serverId, 'starting');

    try {
      // Create transport for spawning the server process
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
      });

      // Create MCP client
      const client = new Client(
        { name: 'lace', version: '1.0.0' },
        { capabilities: { tools: {} } }
      );

      // Store references before connecting
      connection.transport = transport;
      connection.client = client;

      // Set up error handling before connecting
      transport.onerror = (error) => {
        connection.status = 'failed';
        connection.lastError = error.message;
        this.emit('server-status-changed', serverId, 'failed');
        this.emit('server-error', serverId, error.message);
      };

      transport.onclose = () => {
        if (connection.status === 'running') {
          connection.status = 'stopped';
          this.emit('server-status-changed', serverId, 'stopped');
        }
      };

      // Connect client to server
      await client.connect(transport);

      connection.status = 'running';
      connection.connectedAt = new Date();
      this.emit('server-status-changed', serverId, 'running');
    } catch (error) {
      connection.status = 'failed';
      connection.lastError = error instanceof Error ? error.message : 'Unknown error';
      this.emit('server-status-changed', serverId, 'failed');
      this.emit('server-error', serverId, connection.lastError);
      throw error;
    }
  }

  /**
   * Stop a server
   */
  async stopServer(serverId: string): Promise<void> {
    const connection = this.servers.get(serverId);
    if (!connection) {
      return;
    }

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
      console.warn(`Error stopping server ${serverId}:`, error);
    }

    connection.status = 'stopped';
    connection.client = undefined;
    connection.transport = undefined;
    this.emit('server-status-changed', serverId, 'stopped');
  }

  /**
   * Get server connection by ID
   */
  getServer(serverId: string): MCPServerConnection | undefined {
    return this.servers.get(serverId);
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
    const server = this.servers.get(serverId);
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
}
