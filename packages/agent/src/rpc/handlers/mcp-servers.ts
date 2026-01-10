// ABOUTME: MCP server management RPC handlers for external tool integration
// Handles server lifecycle management (list, create, update, delete, test) and tool discovery

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
import { readSessionState, writeSessionState } from '../../storage/session-store';
import { loadSession } from '../../storage/session-store';

/**
 * Reconcile MCP servers for the active session.
 * Compares configured servers to running servers and starts/stops as needed.
 */
export async function reconcileMcpServersForActiveSession(state: AgentServerState): Promise<void> {
  if (!state.activeSession) return;

  const configured = state.activeSession.state.config?.mcpServers;
  const parsed = Array.isArray(configured)
    ? McpServerConfigSchema.array().safeParse(configured)
    : { success: true as const, data: [] as Array<any> };

  if (!parsed.success) {
    console.warn('Invalid mcpServers config in session state; leaving servers unchanged', {
      error: parsed.error,
    });
    return;
  }

  const mcpServers = parsed.data;
  const desired = new Map<string, MCPServerConfig>();

  for (const server of mcpServers) {
    const enabled = typeof server.enabled === 'boolean' ? server.enabled : true;
    const tools: Record<string, ToolPolicy> =
      server.tools && typeof server.tools === 'object' ? server.tools : {};

    desired.set(server.name, {
      command: server.command,
      ...(Array.isArray(server.args) ? { args: server.args } : {}),
      ...(server.env && typeof server.env === 'object' ? { env: server.env } : {}),
      enabled,
      tools,
    });
  }

  for (const existing of state.mcpServerManager.getAllServers()) {
    if (!desired.has(existing.id)) {
      await state.mcpServerManager.stopServer(existing.id);
    }
  }

  for (const [serverId, config] of desired) {
    const existing = state.mcpServerManager.getServer(serverId);
    const needsRestart = existing ? !mcpServerConfigEquivalent(existing.config, config) : false;

    if (needsRestart) {
      await state.mcpServerManager.stopServer(serverId);
    }

    if (!config.enabled) {
      await state.mcpServerManager.stopServer(serverId);
      continue;
    }

    await state.mcpServerManager.startServer(serverId, {
      ...config,
      cwd: state.activeSession.meta.workDir,
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

    const config: MCPServerConfig = {
      command,
      ...(Array.isArray(parsed.args) ? { args: parsed.args } : {}),
      ...(parsed.env && typeof parsed.env === 'object' ? { env: parsed.env } : {}),
      enabled,
      tools,
    };

    // Update session config to include this MCP server
    await runExclusive(() => {
      const sessionState = readSessionState(state.activeSession!.dir);
      const existingMcpServers = Array.isArray(sessionState.config?.mcpServers)
        ? sessionState.config.mcpServers
        : [];

      // Find and replace or add the server config
      const updatedServers = existingMcpServers.filter((s: any) => s.name !== serverId);
      updatedServers.push({
        name: serverId,
        command: config.command,
        ...(config.args ? { args: config.args } : {}),
        ...(config.env ? { env: config.env } : {}),
        enabled: config.enabled,
        ...(Object.keys(config.tools).length > 0 ? { tools: config.tools } : {}),
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
    if (enabled) {
      await state.mcpServerManager.startServer(serverId, {
        ...config,
        cwd: state.activeSession.meta.workDir,
      });
    }

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

    // Stop the server if running
    await state.mcpServerManager.stopServer(serverId);

    // Remove from session config
    await runExclusive(() => {
      const sessionState = readSessionState(state.activeSession!.dir);
      const existingMcpServers = Array.isArray(sessionState.config?.mcpServers)
        ? sessionState.config.mcpServers
        : [];

      const updatedServers = existingMcpServers.filter((s: any) => s.name !== serverId);

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

    // If not running, try to start it
    if (server.status !== 'running') {
      const startTime = Date.now();
      try {
        await state.mcpServerManager.startServer(serverId, {
          ...server.config,
          cwd: state.activeSession?.meta.workDir,
        });

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
