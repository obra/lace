// ABOUTME: MCP server connection management using official TypeScript SDK
// ABOUTME: Handles server lifecycle, connection state, and provides SDK client access

import { EventEmitter } from 'events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '@lace/agent/utils/logger';
import type { MCPServerConfig, MCPServerConnection } from '@lace/agent/config/mcp-types';
import type { ToolRuntime } from '@lace/agent/tools/runtime/types';
import { RuntimeStdioClientTransport } from '@lace/agent/tools/runtime/runtime-stdio-transport';
import {
  RuntimeSecretResolutionError,
  type RuntimeSecretResolver,
  redactSecretReference,
  resolveSecretEnv,
} from '@lace/agent/tools/runtime/secrets';

export interface StartMCPServerInput {
  serverId: string;
  config: MCPServerConfig;
  runtime: ToolRuntime;
  hostCwd?: string;
  sessionId?: string;
  secretResolver?: RuntimeSecretResolver;
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
  const runtimeKey = placement === 'toolRuntime' ? input.runtimeId : 'host';
  return JSON.stringify([input.serverId, placement, transport, runtimeKey, effectiveCwd ?? '']);
}

async function resolveMcpEnvironment(input: {
  serverId: string;
  config: MCPServerConfig;
  runtime: ToolRuntime;
  sessionId?: string;
  secretResolver?: RuntimeSecretResolver;
}): Promise<Record<string, string> | undefined> {
  const secretEntries = Object.entries(input.config.secretEnv ?? {});
  if (secretEntries.length === 0) return input.config.env;

  const sessionId = input.sessionId ?? 'unknown';
  if (!input.secretResolver) {
    const [, reference] = secretEntries[0]!;
    throw new RuntimeSecretResolutionError(
      `Secret unavailable or unauthorized: ${redactSecretReference(reference)}`,
      {
        reference,
        runtimeId: input.runtime.id,
        sessionId,
        serverId: input.serverId,
      }
    );
  }

  const resolved = await resolveSecretEnv({
    secretEnv: input.config.secretEnv,
    resolver: input.secretResolver,
    runtimeId: input.runtime.id,
    sessionId,
    serverId: input.serverId,
  });

  return {
    ...(input.config.env ?? {}),
    ...resolved,
  };
}

// Auto-reconnect bookkeeping for a desired (started, not intentionally stopped)
// connection. When an in-container MCP's stdio transport drops mid-session
// (docker-exec pipe close), the manager re-establishes it with bounded
// exponential backoff so its tools (e.g. use_browser) come back instead of
// silently vanishing for the rest of the session.
interface ReconnectState {
  input: StartMCPServerInput;
  attempts: number;
  timer?: ReturnType<typeof setTimeout>;
  desired: boolean;
}

const RECONNECT_MAX_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

async function closeQuietly(closable?: { close: () => unknown }): Promise<void> {
  try {
    await closable?.close();
  } catch {
    // Best-effort cleanup — a close failure must never mask the original outcome.
  }
}

export class MCPServerManager extends EventEmitter {
  private servers = new Map<string, MCPServerConnection>();
  private reconnects = new Map<string, ReconnectState>();

  /**
   * Start a server if it's not already running
   */
  async startServer(input: StartMCPServerInput): Promise<void> {
    const { serverId, config, runtime, hostCwd } = input;
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

    // Record the inputs needed to auto-reconnect this connection after an
    // unexpected drop. Marked desired until an intentional stop/remove/shutdown.
    this.reconnects.set(connectionKey, { input, attempts: 0, desired: true });

    await this.establishConnection(connectionKey, input);
  }

  /**
   * Create the transport + client, wire drop handlers, and connect. Shared by
   * the initial startServer and by auto-reconnect. Throws on connection failure
   * (after emitting 'failed'); the caller decides whether to retry.
   */
  private async establishConnection(
    connectionKey: string,
    input: StartMCPServerInput
  ): Promise<void> {
    const { serverId, config, runtime, hostCwd, sessionId, secretResolver } = input;
    const placement = config.placement ?? 'host';

    // Replace any prior connection for this key (e.g. the dropped one we're
    // re-establishing). Install the new connection in the map FIRST so the prior
    // transport's stale handlers — which guard on identity — become no-ops, then
    // close the prior transport/client so its subprocess isn't leaked.
    const prior = this.servers.get(connectionKey);
    const connection: MCPServerConnection = {
      id: serverId,
      connectionKey,
      config,
      status: 'starting',
    };
    this.servers.set(connectionKey, connection);
    this.emit('server-status-changed', serverId, 'starting', connectionKey);
    if (prior && prior !== connection) {
      await closeQuietly(prior.transport);
      await closeQuietly(prior.client);
    }

    // True only while THIS connection is still the live entry for its key. A
    // racing stop (stopServer nulls client/transport + sets 'stopped' in place)
    // or a newer establishConnection (replaces the map entry) must not let a
    // stale handler — or this connect resolving late — resurrect a dead connection.
    const isLive = (): boolean =>
      this.servers.get(connectionKey) === connection && connection.status === 'starting';

    try {
      const env = await resolveMcpEnvironment({
        serverId,
        config,
        runtime,
        sessionId,
        secretResolver,
      });

      // Create transport for spawning the server process
      const transport =
        placement === 'toolRuntime'
          ? new RuntimeStdioClientTransport({
              runtime,
              command: config.command,
              args: config.args,
              env,
              cwd: runtime.cwd,
            })
          : new StdioClientTransport({
              command: config.command,
              args: config.args,
              env,
              cwd: hostCwd,
            });

      // Create MCP client
      const client = new Client({ name: 'lace', version: '1.0.0' }, { capabilities: {} });

      // Store references before connecting
      connection.transport = transport;
      connection.client = client;

      // Set up error handling before connecting. Both handlers no-op once this
      // connection is no longer the live entry, so a dropped pipe's late error
      // can't mutate or reconnect a healthy replacement on the same key.
      transport.onerror = (error) => {
        if (this.servers.get(connectionKey) !== connection) return;
        connection.status = 'failed';
        connection.lastError = error.message;
        this.emit('server-status-changed', serverId, 'failed', connectionKey);
        this.emit('server-error', serverId, error.message, connectionKey);
        this.maybeScheduleReconnect(connectionKey);
      };

      transport.onclose = () => {
        if (this.servers.get(connectionKey) !== connection || connection.status !== 'running') {
          return;
        }
        connection.status = 'stopped';
        this.emit('server-status-changed', serverId, 'stopped', connectionKey);
        this.maybeScheduleReconnect(connectionKey);
      };

      // Connect client to server
      await client.connect(transport);

      // A stop or a newer (re)connect may have raced in during connect. Don't
      // resurrect a connection that's been torn down or replaced — close the
      // freshly-built transport/client and bail.
      if (!isLive()) {
        await closeQuietly(transport);
        await closeQuietly(client);
        return;
      }

      connection.status = 'running';
      connection.connectedAt = new Date();
      this.emit('server-status-changed', serverId, 'running', connectionKey);
    } catch (error) {
      // Clean up transport and client on connection failure
      if (connection.transport) {
        await closeQuietly(connection.transport);
        connection.transport = undefined;
      }
      if (connection.client) {
        await closeQuietly(connection.client);
        connection.client = undefined;
      }

      // Only claim the failure if we're still the live connection; a racing
      // stop/replace owns the status otherwise.
      if (this.servers.get(connectionKey) === connection) {
        connection.status = 'failed';
        connection.lastError = error instanceof Error ? error.message : 'Unknown error';
        this.emit('server-status-changed', serverId, 'failed', connectionKey);
        this.emit('server-error', serverId, connection.lastError, connectionKey);
      }
      throw error;
    }
  }

  /**
   * Schedule a backoff reconnect for a desired connection after an unexpected
   * drop. No-op if the connection was intentionally stopped, is disabled, a
   * reconnect is already pending, or the attempt budget is exhausted.
   */
  private maybeScheduleReconnect(connectionKey: string): void {
    const state = this.reconnects.get(connectionKey);
    if (!state || !state.desired) return;
    if (state.input.config.enabled === false) return;
    if (state.timer) return;
    // Backstop: never reconnect a connection that's already healthy (e.g. a
    // stale handler that slipped past its identity guard).
    if (this.servers.get(connectionKey)?.status === 'running') return;
    if (state.attempts >= RECONNECT_MAX_ATTEMPTS) {
      logger.error(
        `MCP server ${state.input.serverId} dropped and did not recover after ` +
          `${RECONNECT_MAX_ATTEMPTS} reconnect attempts — its tools are unavailable`,
        { serverId: state.input.serverId, connectionKey }
      );
      return;
    }
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** state.attempts, RECONNECT_MAX_DELAY_MS);
    state.timer = setTimeout(() => {
      state.timer = undefined;
      void this.attemptReconnect(connectionKey);
    }, delay);
    // Don't let a pending reconnect keep the process alive.
    state.timer.unref?.();
  }

  private async attemptReconnect(connectionKey: string): Promise<void> {
    const state = this.reconnects.get(connectionKey);
    if (!state || !state.desired) return;
    state.attempts += 1;
    const { serverId } = state.input;
    logger.warn(
      `MCP server ${serverId} dropped; reconnect attempt ${state.attempts}/${RECONNECT_MAX_ATTEMPTS}`,
      { serverId, connectionKey }
    );
    try {
      await this.establishConnection(connectionKey, state.input);
      // Re-check: an intentional stop may have raced in during connect.
      if (!state.desired) return;
      state.attempts = 0;
      logger.info(`MCP server ${serverId} reconnected after drop`, { serverId, connectionKey });
      this.emit('server-reconnected', serverId, connectionKey);
    } catch {
      // establishConnection already emitted 'failed'; back off and retry.
      this.maybeScheduleReconnect(connectionKey);
    }
  }

  private cancelReconnect(connectionKey: string): void {
    const state = this.reconnects.get(connectionKey);
    if (!state) return;
    state.desired = false;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
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
      // Mark not-desired + cancel any pending reconnect BEFORE closing, so the
      // transport's onclose handler treats this as an intentional stop.
      this.cancelReconnect(connection.connectionKey);
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
   * Stop and forget connections that are no longer part of desired session config.
   */
  async removeServer(serverId: string): Promise<void> {
    const connections = this.resolveConnections(serverId);
    for (const connection of connections) {
      await this.stopServer(connection.connectionKey);
      this.servers.delete(connection.connectionKey);
      this.reconnects.delete(connection.connectionKey);
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
    // Cancel all pending reconnects up front so nothing re-establishes mid-shutdown.
    for (const connectionKey of this.reconnects.keys()) {
      this.cancelReconnect(connectionKey);
    }
    const stopPromises = Array.from(this.servers.keys()).map((id) => this.stopServer(id));
    await Promise.allSettled(stopPromises); // Use allSettled to handle errors gracefully
    this.servers.clear();
    this.reconnects.clear();
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
    if (matches.length === 1) {
      return matches[0];
    }

    const runningMatches = matches.filter((server) => server.status === 'running');
    return runningMatches.length === 1 ? runningMatches[0] : undefined;
  }
}
