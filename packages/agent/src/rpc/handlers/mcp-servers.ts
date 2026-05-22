// ABOUTME: MCP server management RPC handlers for external tool integration
// Handles server lifecycle management (list, create, update, delete, test) and tool discovery

import { z } from 'zod';
import type { JsonRpcPeer } from '@lace/ent-protocol';
import { AcpErrorCodes, EntErrorCodes, McpServerConfigSchema } from '@lace/ent-protocol';
import type { ToolPolicy } from '../../tools/types';
import type { MCPServerConfig } from '../../config/mcp-types';
import type { AgentServerState } from '../../server-types';
import {
  assertInitialized,
  throwInvalidParams,
  toNonEmptyString,
  mcpServerConfigEquivalent,
} from '../utils';
import { logger } from '../../utils/logger';
import {
  readSessionState,
  writeSessionState,
  type StoredMcpServer,
} from '../../storage/session-store';
import { loadSession } from '../../storage/session-store';
import { invalidateSessionToolExecutor } from '../../server';
import { defaultMcpServerPlacements } from '../session-config';
import { HostToolRuntime } from '../../tools/runtime/host';
import { createToolRuntimeFromBinding } from '../../tools/runtime/factory';
import type { ToolRuntime } from '../../tools/runtime/types';
import { mcpConnectionKey } from '../../mcp/server-manager';

function isUnsupportedMcpTransport(config: { transport?: string }): boolean {
  return Boolean(config.transport && config.transport !== 'stdio');
}

function unsupportedMcpTransportError(config: { transport?: string }): string {
  return `Unsupported MCP transport: ${config.transport}`;
}

function defaultMcpPlacement(config: MCPServerConfig): MCPServerConfig {
  if (config.placement) return config;
  return {
    ...config,
    placement: config.transport === 'http' || config.transport === 'sse' ? 'host' : 'toolRuntime',
  };
}

function activeSessionRuntime(state: AgentServerState, config: MCPServerConfig): ToolRuntime {
  const activeSession = state.activeSession;
  const runtimeBinding = activeSession?.state.config?.runtimeBinding;
  const hostCwd = activeSession?.meta.workDir ?? process.cwd();
  const placement = config.placement ?? 'host';

  if (placement === 'host') {
    return new HostToolRuntime({
      id: activeSession ? `session:${activeSession.meta.sessionId}:host` : 'mcp:host',
      cwd: hostCwd,
    });
  }

  if (runtimeBinding) {
    return createToolRuntimeFromBinding({
      binding: runtimeBinding,
      containerManager: state.containerManager,
      sessionId: activeSession?.meta.sessionId,
      secretResolver: state.runtimeSecretResolver,
    });
  }

  return new HostToolRuntime({
    id: activeSession ? `session:${activeSession.meta.sessionId}:host` : 'mcp:host',
    cwd: hostCwd,
  });
}

function activeSessionHostCwd(state: AgentServerState): string {
  return state.activeSession?.meta.workDir ?? process.cwd();
}

function activeSessionConnectionKey(
  state: AgentServerState,
  serverId: string,
  config: MCPServerConfig
): string {
  const runtime = activeSessionRuntime(state, config);
  return mcpConnectionKey({
    serverId,
    config,
    runtimeId: runtime.id,
    runtimeCwd: runtime.cwd,
    hostCwd: activeSessionHostCwd(state),
  });
}

function activeSessionDisplacedStdioConnectionKey(
  state: AgentServerState,
  serverId: string,
  config: MCPServerConfig
): string {
  return activeSessionConnectionKey(state, serverId, { ...config, transport: 'stdio' });
}

async function startServerForActiveSession(
  state: AgentServerState,
  serverId: string,
  config: MCPServerConfig
): Promise<void> {
  const runtime = activeSessionRuntime(state, config);
  await state.mcpServerManager.startServer({
    serverId,
    config,
    runtime,
    hostCwd: activeSessionHostCwd(state),
    sessionId: state.activeSession?.meta.sessionId,
    secretResolver: state.runtimeSecretResolver,
  });
}

async function syncEnabledMcpServerForActiveSession(
  state: AgentServerState,
  serverId: string,
  config: MCPServerConfig
): Promise<void> {
  const connectionKey = activeSessionConnectionKey(state, serverId, config);

  for (const existing of state.mcpServerManager.getAllServers()) {
    if (existing.id === serverId && existing.connectionKey !== connectionKey) {
      await state.mcpServerManager.removeServer(existing.connectionKey);
    }
  }

  const existing = state.mcpServerManager.getServer(connectionKey);
  if (existing && !mcpServerConfigEquivalent(existing.config, config)) {
    await state.mcpServerManager.stopServer(connectionKey);
  }

  await startServerForActiveSession(state, serverId, config);
}

async function syncDisabledMcpServerForActiveSession(
  state: AgentServerState,
  serverId: string,
  config: MCPServerConfig
): Promise<void> {
  const connectionKey = activeSessionConnectionKey(state, serverId, config);
  const existingConnections = state.mcpServerManager
    .getAllServers()
    .filter((connection) => connection.id === serverId);
  const replacementConnectionKey = existingConnections[0]?.connectionKey ?? connectionKey;

  for (const existing of existingConnections) {
    await state.mcpServerManager.stopServer(existing.connectionKey);
  }
  for (const stale of existingConnections.slice(1)) {
    await state.mcpServerManager.removeServer(stale.connectionKey);
  }

  state.mcpServerManager.replaceStoppedServerConfig(serverId, config, {
    desiredConnectionKey: connectionKey,
    replaceConnectionKey: replacementConnectionKey,
  });
}

// Lace-internal storage schema: protocol's McpServerConfigSchema plus an
// optional `source` tag (see session-store.ts). The strict protocol schema
// would reject this tag, so reading state.json uses the extended shape.
const StoredMcpServerSchema = McpServerConfigSchema.extend({
  source: z.enum(['embedder', 'user']).optional(),
});

/**
 * Reconcile MCP servers for the active session.
 * Compares configured servers to running servers and starts/stops as needed.
 */
export async function reconcileMcpServersForActiveSession(state: AgentServerState): Promise<void> {
  if (!state.activeSession) return;

  // MCP changes invalidate the cached executor's tool list for this session.
  invalidateSessionToolExecutor(state.toolExecutorCache, state.activeSession.meta.sessionId);

  const configured = state.activeSession.state.config?.mcpServers;
  const parsed = Array.isArray(configured)
    ? StoredMcpServerSchema.array().safeParse(configured)
    : { success: true as const, data: [] as Array<any> };

  if (!parsed.success) {
    console.warn('Invalid mcpServers config in session state; leaving servers unchanged', {
      error: parsed.error,
    });
    return;
  }

  const mcpServers = parsed.data;
  const hostCwd = activeSessionHostCwd(state);
  const desired = new Map<string, { serverId: string; config: MCPServerConfig }>();

  for (const server of mcpServers) {
    const enabled = typeof server.enabled === 'boolean' ? server.enabled : true;
    const tools: Record<string, ToolPolicy> =
      server.tools && typeof server.tools === 'object' ? server.tools : {};

    const config = defaultMcpPlacement({
      command: server.command,
      ...(Array.isArray(server.args) ? { args: server.args } : {}),
      ...(server.env && typeof server.env === 'object' ? { env: server.env } : {}),
      ...(server.transport ? { transport: server.transport } : {}),
      ...(server.placement ? { placement: server.placement } : {}),
      ...(server.secretEnv ? { secretEnv: server.secretEnv } : {}),
      enabled,
      tools,
    });
    const runtime = activeSessionRuntime(state, config);
    const connectionKey = mcpConnectionKey({
      serverId: server.name,
      config,
      runtimeId: runtime.id,
      runtimeCwd: runtime.cwd,
      hostCwd,
    });
    desired.set(connectionKey, { serverId: server.name, config });
  }

  for (const existing of state.mcpServerManager.getAllServers()) {
    if (!desired.has(existing.connectionKey)) {
      await state.mcpServerManager.removeServer(existing.connectionKey);
    }
  }

  for (const [connectionKey, { serverId, config }] of desired) {
    const runtime = activeSessionRuntime(state, config);
    const existing = state.mcpServerManager.getServer(connectionKey);
    const needsRestart = existing ? !mcpServerConfigEquivalent(existing.config, config) : false;

    if (needsRestart) {
      await state.mcpServerManager.stopServer(connectionKey);
    }

    if (!config.enabled) {
      await state.mcpServerManager.stopServer(connectionKey);
      state.mcpServerManager.replaceStoppedServerConfig(serverId, config, {
        desiredConnectionKey: connectionKey,
        replaceConnectionKey: connectionKey,
      });
      continue;
    }

    if (isUnsupportedMcpTransport(config)) {
      const displacedStdioConnectionKey = activeSessionDisplacedStdioConnectionKey(
        state,
        serverId,
        config
      );
      const stoppedConnectionKey =
        existing?.connectionKey ??
        state.mcpServerManager.getServer(displacedStdioConnectionKey)?.connectionKey ??
        displacedStdioConnectionKey;
      await state.mcpServerManager.stopServer(stoppedConnectionKey);
      state.mcpServerManager.replaceStoppedServerConfig(serverId, config, {
        desiredConnectionKey: connectionKey,
        replaceConnectionKey: stoppedConnectionKey,
        status: 'failed',
        lastError: unsupportedMcpTransportError(config),
      });
      logger.warn('Skipping MCP server with unsupported transport', {
        serverId,
        transport: config.transport,
      });
      continue;
    }

    await state.mcpServerManager.startServer({
      serverId,
      config,
      runtime,
      hostCwd,
      sessionId: state.activeSession.meta.sessionId,
      secretResolver: state.runtimeSecretResolver,
    });
  }
}

/**
 * Register MCP server management handlers with the peer.
 * - list: Returns all configured MCP servers with status
 * - upsert: Create or update an MCP server configuration
 * - delete: Remove an MCP server configuration and stop it
 * - test: Test connection to an MCP server
 * - tools/list: List tools available from a specific MCP server
 */
export function registerMcpHandlers(
  peer: JsonRpcPeer,
  state: AgentServerState,
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>
): void {
  peer.onRequest('ent/mcp/servers/list', async (_params: unknown) => {
    assertInitialized(state);

    const servers = state.mcpServerManager.getAllServers().map((connection) => {
      // Get tool count from cached discovered tools in config
      let toolCount: number | undefined;
      if (connection.config.discoveredTools) {
        toolCount = connection.config.discoveredTools.length;
      }

      return {
        serverId: connection.id,
        name: connection.id,
        command: connection.config.command,
        args: connection.config.args,
        enabled: connection.config.enabled,
        status: connection.status,
        lastError: connection.lastError,
        connectedAt: connection.connectedAt?.toISOString(),
        toolCount,
      };
    });

    return { servers };
  });

  peer.onRequest('ent/mcp/servers/upsert', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const parsed = params as {
      serverId?: string;
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
      transport?: 'stdio' | 'sse' | 'http';
      secretEnv?: Record<
        string,
        { namespace: 'session' | 'project' | 'host-service'; name: string }
      >;
      placement?: 'toolRuntime' | 'host';
      enabled?: boolean;
      tools?: Record<string, string>;
    };

    const name = toNonEmptyString(parsed?.name);
    const command = toNonEmptyString(parsed?.command);
    if (!name) throwInvalidParams('name is required');
    if (!command) throwInvalidParams('command is required');

    const serverId = toNonEmptyString(parsed?.serverId) ?? name;
    const existing = state.mcpServerManager.getServer(serverId);
    const created = !existing;

    const enabled = typeof parsed.enabled === 'boolean' ? parsed.enabled : true;
    const tools: Record<string, ToolPolicy> =
      parsed.tools && typeof parsed.tools === 'object'
        ? (parsed.tools as Record<string, ToolPolicy>)
        : {};

    const [serverConfig] = defaultMcpServerPlacements([
      {
        name: serverId,
        command,
        ...(Array.isArray(parsed.args) ? { args: parsed.args } : {}),
        ...(parsed.env && typeof parsed.env === 'object' ? { env: parsed.env } : {}),
        ...(parsed.transport ? { transport: parsed.transport } : {}),
        ...(parsed.secretEnv ? { secretEnv: parsed.secretEnv } : {}),
        ...(parsed.placement ? { placement: parsed.placement } : {}),
        enabled,
        tools,
      },
    ]);

    const config: MCPServerConfig = defaultMcpPlacement({
      command: serverConfig.command,
      ...(Array.isArray(parsed.args) ? { args: parsed.args } : {}),
      ...(parsed.env && typeof parsed.env === 'object' ? { env: parsed.env } : {}),
      ...(serverConfig.transport ? { transport: serverConfig.transport } : {}),
      ...(serverConfig.secretEnv ? { secretEnv: serverConfig.secretEnv } : {}),
      ...(serverConfig.placement ? { placement: serverConfig.placement } : {}),
      enabled: serverConfig.enabled ?? true,
      tools: (serverConfig.tools ?? {}) as Record<string, ToolPolicy>,
    });

    // Update session config to include this MCP server
    await runExclusive(() => {
      const sessionState = readSessionState(state.activeSession!.dir);
      const existingMcpServers = Array.isArray(sessionState.config?.mcpServers)
        ? sessionState.config.mcpServers
        : [];

      // Find and replace or add the server config. Tag as 'user'-owned so
      // it survives subsequent embedder session/resume calls (see PRI-1754).
      const updatedServers: StoredMcpServer[] = existingMcpServers.filter(
        (s: { name: string }) => s.name !== serverId
      );
      updatedServers.push({
        name: serverId,
        command: config.command,
        ...(config.args ? { args: config.args } : {}),
        ...(config.env ? { env: config.env } : {}),
        ...(config.transport ? { transport: config.transport } : {}),
        ...(config.secretEnv ? { secretEnv: config.secretEnv } : {}),
        ...(config.placement ? { placement: config.placement } : {}),
        enabled: config.enabled,
        ...(Object.keys(config.tools).length > 0 ? { tools: config.tools } : {}),
        source: 'user',
      });

      writeSessionState(state.activeSession!.dir, {
        ...sessionState,
        config: {
          ...sessionState.config,
          mcpServers: updatedServers,
        },
      });
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    // Start the server if enabled
    if (!enabled) {
      await syncDisabledMcpServerForActiveSession(state, serverId, config);
    } else if (isUnsupportedMcpTransport(config)) {
      const connectionKey = activeSessionConnectionKey(state, serverId, config);
      await state.mcpServerManager.stopServer(serverId);
      state.mcpServerManager.replaceStoppedServerConfig(serverId, config, {
        desiredConnectionKey: connectionKey,
        status: 'failed',
        lastError: unsupportedMcpTransportError(config),
      });
      logger.warn('Skipping MCP server with unsupported transport', {
        serverId,
        transport: config.transport,
      });
    } else {
      await syncEnabledMcpServerForActiveSession(state, serverId, config);
    }

    invalidateSessionToolExecutor(state.toolExecutorCache, state.activeSession.meta.sessionId);

    return { serverId, created };
  });

  peer.onRequest('ent/mcp/servers/delete', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const parsed = params as { serverId: string };
    const serverId = toNonEmptyString(parsed?.serverId);
    if (!serverId) throwInvalidParams('serverId is required');

    // Stop the server if running and remove all in-memory connection state.
    await state.mcpServerManager.removeServer(serverId);

    invalidateSessionToolExecutor(state.toolExecutorCache, state.activeSession.meta.sessionId);

    // Remove from session config
    await runExclusive(() => {
      const sessionState = readSessionState(state.activeSession!.dir);
      const existingMcpServers = Array.isArray(sessionState.config?.mcpServers)
        ? sessionState.config.mcpServers
        : [];

      const updatedServers = existingMcpServers.filter(
        (s: { name: string }) => s.name !== serverId
      );

      writeSessionState(state.activeSession!.dir, {
        ...sessionState,
        config: {
          ...sessionState.config,
          mcpServers: updatedServers,
        },
      });
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    return { ok: true as const };
  });

  peer.onRequest('ent/mcp/servers/test', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { serverId: string };
    const serverId = toNonEmptyString(parsed?.serverId);
    if (!serverId) throwInvalidParams('serverId is required');

    const server = state.mcpServerManager.getServer(serverId);
    if (!server)
      throw {
        code: EntErrorCodes.McpServerNotFound,
        message: 'McpServerNotFound',
        data: { category: 'mcp', serverId },
      };

    if (isUnsupportedMcpTransport(server.config)) {
      return {
        ok: false,
        error: `Unsupported MCP transport for test: ${server.config.transport}`,
      };
    }

    // If not running, try to start it
    if (server.status !== 'running') {
      const startTime = Date.now();
      try {
        await startServerForActiveSession(state, serverId, server.config);

        // Get tool count from the client
        const client = state.mcpServerManager.getClient(serverId);
        let toolCount: number | undefined;
        if (client) {
          try {
            const toolsResult = await client.listTools();
            toolCount = toolsResult.tools.length;
          } catch (error) {
            logger.debug('mcp.listTools.failed', {
              serverId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        const latencyMs = Date.now() - startTime;
        return { ok: true, latencyMs, toolCount };
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          latencyMs,
        };
      }
    }

    // Already running, just test connectivity by listing tools
    const client = state.mcpServerManager.getClient(serverId);
    if (!client) {
      return { ok: false, error: 'No client available' };
    }

    const startTime = Date.now();
    try {
      const toolsResult = await client.listTools();
      const latencyMs = Date.now() - startTime;
      return { ok: true, latencyMs, toolCount: toolsResult.tools.length };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latencyMs,
      };
    }
  });

  peer.onRequest('ent/mcp/tools/list', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { serverId: string };
    const serverId = toNonEmptyString(parsed?.serverId);
    if (!serverId) throwInvalidParams('serverId is required');

    const server = state.mcpServerManager.getServer(serverId);
    if (!server)
      throw {
        code: EntErrorCodes.McpServerNotFound,
        message: 'McpServerNotFound',
        data: { category: 'mcp', serverId },
      };

    const client = state.mcpServerManager.getClient(serverId);
    if (!client || server.status !== 'running') {
      throw {
        code: EntErrorCodes.McpServerNotFound,
        message: 'McpServerNotRunning',
        data: { category: 'mcp', serverId, status: server.status },
      };
    }

    try {
      const toolsResult = await client.listTools();
      const tools = toolsResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
      }));

      return { serverId, tools };
    } catch (error) {
      throw {
        code: EntErrorCodes.ProviderError,
        message: 'McpToolListError',
        data: {
          category: 'mcp',
          serverId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  });
}
