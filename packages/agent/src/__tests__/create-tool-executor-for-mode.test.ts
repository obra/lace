// ABOUTME: Tests for createToolExecutorForMode covering MCP discovery race window

import { describe, it, expect } from 'vitest';
import { createToolExecutorForMode } from '../server';
import { MCPServerManager } from '../mcp/server-manager';
import type { MCPServerConnection } from '../config/mcp-types';

describe('createToolExecutorForMode', () => {
  it('returns an executor whose MCP tool list is fully populated', async () => {
    const listToolsResult = {
      tools: [
        {
          name: 'echo',
          description: 'Echo input',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    };

    // Stub MCP client that resolves listTools on the next microtask only.
    // Without awaiting MCP discovery inline, the returned executor's tool
    // list will not yet contain the MCP tool.
    const fakeClient = {
      listTools: () => Promise.resolve(listToolsResult),
    };

    const fakeServer: MCPServerConnection = {
      id: 'mock',
      config: {
        command: 'unused',
        enabled: true,
        tools: { echo: 'ask' },
      },
      status: 'running',
      client: fakeClient as unknown as MCPServerConnection['client'],
    };

    const mgr = new MCPServerManager();
    // Bypass startServer (no real subprocess). Inject the connection directly.
    (mgr as unknown as { servers: Map<string, MCPServerConnection> }).servers.set(
      'mock',
      fakeServer
    );

    const { executor } = await createToolExecutorForMode('execute', mgr);

    const toolNames = executor.getAllTools().map((t) => t.name);
    expect(toolNames).toContain('mock/echo');
  });
});
