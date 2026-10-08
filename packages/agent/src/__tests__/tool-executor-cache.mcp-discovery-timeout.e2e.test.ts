// ABOUTME: Regression test for a session permanently losing its MCP tools when a turn
// ABOUTME: builds the cached tool executor while a running server's tools/list is slow.
// ABOUTME: Real MCPServerManager + real stdio MCP server subprocess; no protocol mocks.
//
// The production shape: the server is 'running', but its first tools/list answers
// after the discovery guard gives up. The build returns a toolsForProvider without
// the server's tools. Discovery finishes later and fills the executor's registry, but
// the provider's `_`-to-`/` name mapping is built from toolsForProvider, so the model's
// `chat_send` never maps back to `chat/send`: "Tool not found: chat_send" until restart.

import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MCPServerConfig } from '@lace/agent/config/mcp-types';
import { MCPServerManager } from '@lace/agent/mcp/server-manager';
import { HostToolRuntime } from '@lace/agent/tools/runtime/host';
import { ToolExecutor } from '@lace/agent/tools/executor';
import {
  buildSanitizedToolNames,
  unsanitizeToolName,
} from '@lace/agent/providers/tool-name-sanitizer';
import { createToolExecutorForMode, getOrCreateSessionToolExecutor } from '../server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER = path.join(__dirname, 'fixtures', 'slow-first-list-mcp-server.mjs');
const SESSION_ID = 'sess_mcp_discovery_timeout';
const DISCOVERY_TIMEOUT_MS = 300;

// What BaseProvider does per request: build the mapping from the tools it was handed,
// then map the model's sanitized tool_use name back.
function resolveModelToolName(toolsForProvider: { name: string }[], modelName: string): string {
  const { mapping } = buildSanitizedToolNames(toolsForProvider.map((t) => t.name));
  return unsanitizeToolName(modelName, mapping);
}

describe('session tool executor cache across a slow MCP tool discovery (e2e)', () => {
  const originalTimeout = ToolExecutor.MCP_DISCOVERY_TIMEOUT_MS;
  let manager: MCPServerManager | undefined;

  afterEach(async () => {
    ToolExecutor.MCP_DISCOVERY_TIMEOUT_MS = originalTimeout;
    await manager?.shutdown();
    manager = undefined;
  });

  it('reports a server not ready while any of its same-id connections is still discovering', async () => {
    // The manager keys connections by id + placement + runtime + cwd, so one server id
    // can have several live connections. A fast one finishing must not mask a slow one.
    const mcpServerManager = new MCPServerManager();
    manager = mcpServerManager;
    for (const [hostCwd, slowFirstListMs] of [
      [process.cwd(), 0],
      [__dirname, DISCOVERY_TIMEOUT_MS * 3],
    ] as const) {
      await mcpServerManager.startServer({
        serverId: 'chat',
        config: {
          command: process.execPath,
          args: [SERVER],
          env: { SLOW_FIRST_LIST_MS: String(slowFirstListMs) },
          enabled: true,
          tools: {},
          placement: 'host',
        },
        runtime: new HostToolRuntime({ id: 'test:mcp-discovery-timeout', cwd: hostCwd }),
        hostCwd,
      });
    }
    expect(mcpServerManager.getAllServers().map((s) => [s.id, s.status])).toEqual([
      ['chat', 'running'],
      ['chat', 'running'],
    ]);

    const executor = new ToolExecutor();
    executor.registerMCPTools(mcpServerManager);

    expect(await executor.ensureMCPToolsReady(DISCOVERY_TIMEOUT_MS)).toEqual(['chat']);
  });

  it('rebuilds a cached tool list whose MCP discovery timed out', async () => {
    ToolExecutor.MCP_DISCOVERY_TIMEOUT_MS = DISCOVERY_TIMEOUT_MS;
    const mcpServerManager = new MCPServerManager();
    manager = mcpServerManager;
    const config: MCPServerConfig = {
      command: process.execPath,
      args: [SERVER],
      env: { SLOW_FIRST_LIST_MS: String(DISCOVERY_TIMEOUT_MS * 3) },
      enabled: true,
      tools: {},
      placement: 'host',
    };
    await mcpServerManager.startServer({
      serverId: 'chat',
      config,
      runtime: new HostToolRuntime({ id: 'test:mcp-discovery-timeout', cwd: process.cwd() }),
      hostCwd: process.cwd(),
    });
    expect(mcpServerManager.getAllServers().map((s) => s.status)).toEqual(['running']);

    const cache = new Map();
    const cachedTurnTools = () =>
      getOrCreateSessionToolExecutor(cache, SESSION_ID, 'execute', () =>
        createToolExecutorForMode('execute', mcpServerManager)
      );

    // Turn 1 builds while the first tools/list is still outstanding. That one turn is
    // degraded; the defect under test is that the degradation must not outlive it.
    const turn1 = await cachedTurnTools();
    expect(turn1.toolsForProvider.map((t) => t.name)).not.toContain('chat/send');
    expect(turn1.mcpServersNotReady).toEqual(['chat']);

    // Let the slow tools/list finish.
    await new Promise((resolve) => setTimeout(resolve, DISCOVERY_TIMEOUT_MS * 3));

    // The next turn must offer the provider the server's tools and map the model's
    // sanitized name back to one the executor knows.
    const turn2 = await cachedTurnTools();
    expect(turn2.mcpServersNotReady).toEqual([]);
    expect(turn2.toolsForProvider.map((t) => t.name)).toContain('chat/send');
    const name = resolveModelToolName(turn2.toolsForProvider, 'chat_send');
    expect(name).toBe('chat/send');
    expect(turn2.executor.getTool(name)).toBeDefined();
  });
});
