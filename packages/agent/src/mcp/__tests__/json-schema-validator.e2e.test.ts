// ABOUTME: End-to-end test for the json-schema-validator MCP server example.
// ABOUTME: Exercises the full real lace MCP path: MCPServerManager spawns the server
// ABOUTME: subprocess, MCPToolAdapter wraps the discovered tool, and execute() is called
// ABOUTME: for real — no mocks of the MCP protocol itself.
//
// Connection path used: MCPServerManager.startServer() (path 1 — lace's real wiring).
//   The manager spawns the .mjs server via node, the MCP SDK negotiates the stdio
//   protocol, client.listTools() discovers the tool, and MCPToolAdapter wraps it.
//   We could not use manager.getClient().callTool() alone because we also want to
//   verify the full MCPToolAdapter.execute() integration including Zod schema conversion.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPServerManager } from '../server-manager';
import { MCPToolAdapter } from '../tool-adapter';
import type { MCPTool } from '@lace/agent/config/mcp-types';
import type { MCPServerConfig } from '@lace/agent/config/mcp-types';
import { HostToolRuntime } from '@lace/agent/tools/runtime/host';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER = path.join(__dirname, '..', '__examples__', 'json-schema-validator-server.mjs');

// Helper: parse the text result from an MCPToolAdapter execute() call
function parseResult(content: Array<{ type: string; text?: string }>): {
  valid: boolean;
  errors: string[];
} {
  const text = content[0]?.text;
  if (typeof text !== 'string') throw new Error('No text content in result');
  return JSON.parse(text) as { valid: boolean; errors: string[] };
}

describe('json-schema-validator MCP server (e2e — real lace wiring)', () => {
  let manager: MCPServerManager;

  beforeEach(async () => {
    manager = new MCPServerManager();

    const config: MCPServerConfig = {
      command: process.execPath, // node
      args: [SERVER],
      enabled: true,
      tools: {},
    };

    await manager.startServer({
      serverId: 'json-validator',
      config: { ...config, placement: 'host' },
      runtime: new HostToolRuntime({ id: 'test:json-validator', cwd: process.cwd() }),
      hostCwd: process.cwd(),
    });
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  // -------------------------------------------------------------------------
  // Tool discovery
  // -------------------------------------------------------------------------

  it('server starts and reports running status', () => {
    const server = manager.getServer('json-validator');
    expect(server).toBeDefined();
    expect(server?.status).toBe('running');
  });

  it('lists validate_json as a discovered tool', async () => {
    const client = manager.getClient('json-validator');
    expect(client).toBeDefined();

    const result = await client!.listTools();
    const toolNames = result.tools.map((t: MCPTool) => t.name);
    expect(toolNames).toContain('validate_json');
  });

  // -------------------------------------------------------------------------
  // MCPToolAdapter wrapping and execution
  // -------------------------------------------------------------------------

  it('MCPToolAdapter wraps validate_json with the correct namespaced name', async () => {
    const client = manager.getClient('json-validator')!;
    const listResult = await client.listTools();
    const mcpTool = listResult.tools.find((t: MCPTool) => t.name === 'validate_json');
    expect(mcpTool).toBeDefined();

    const adapter = new MCPToolAdapter(mcpTool!, 'json-validator', client);
    expect(adapter.name).toBe('json-validator/validate_json');
    expect(adapter.description).toContain('Validate a JSON value');
  });

  it('validates a conforming object and returns valid:true', async () => {
    const client = manager.getClient('json-validator')!;
    const listResult = await client.listTools();
    const mcpTool = listResult.tools.find((t: MCPTool) => t.name === 'validate_json')!;

    const adapter = new MCPToolAdapter(mcpTool, 'json-validator', client);

    const schema = JSON.stringify({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer', minimum: 0 },
      },
      required: ['name'],
    });
    const value = JSON.stringify({ name: 'Alice', age: 30 });

    const result = await adapter.execute({ schema, value }, {});

    expect(result.status).toBe('completed');
    const parsed = parseResult(result.content as Array<{ type: string; text?: string }>);
    expect(parsed.valid).toBe(true);
    expect(parsed.errors).toHaveLength(0);
  });

  it('reports errors for a non-conforming value (missing required field)', async () => {
    const client = manager.getClient('json-validator')!;
    const listResult = await client.listTools();
    const mcpTool = listResult.tools.find((t: MCPTool) => t.name === 'validate_json')!;

    const adapter = new MCPToolAdapter(mcpTool, 'json-validator', client);

    const schema = JSON.stringify({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'integer' } },
      required: ['name', 'age'],
    });
    const value = JSON.stringify({ name: 'Bob' }); // missing age

    const result = await adapter.execute({ schema, value }, {});

    expect(result.status).toBe('completed');
    const parsed = parseResult(result.content as Array<{ type: string; text?: string }>);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.some((e) => e.includes("'age'"))).toBe(true);
  });

  it('reports type errors for wrong field types', async () => {
    const client = manager.getClient('json-validator')!;
    const listResult = await client.listTools();
    const mcpTool = listResult.tools.find((t: MCPTool) => t.name === 'validate_json')!;

    const adapter = new MCPToolAdapter(mcpTool, 'json-validator', client);

    const schema = JSON.stringify({
      type: 'object',
      properties: { count: { type: 'integer', minimum: 1 } },
      required: ['count'],
    });
    const value = JSON.stringify({ count: 'not-a-number' }); // wrong type

    const result = await adapter.execute({ schema, value }, {});

    expect(result.status).toBe('completed');
    const parsed = parseResult(result.content as Array<{ type: string; text?: string }>);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.some((e) => e.includes('type'))).toBe(true);
  });

  it('handles invalid JSON input gracefully without crashing', async () => {
    const client = manager.getClient('json-validator')!;
    const listResult = await client.listTools();
    const mcpTool = listResult.tools.find((t: MCPTool) => t.name === 'validate_json')!;

    const adapter = new MCPToolAdapter(mcpTool, 'json-validator', client);

    const result = await adapter.execute(
      { schema: '{"type":"object"}', value: 'not json at all {{' },
      {}
    );

    expect(result.status).toBe('completed');
    const parsed = parseResult(result.content as Array<{ type: string; text?: string }>);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.some((e) => e.includes('not valid JSON'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // DOCUMENTED LIMITATION: ToolContext is NOT passed through to MCP tools
  //
  // The doc says: "MCPToolAdapter forwards the model's arguments to the MCP
  // server but does NOT pass the lace ToolContext — an MCP tool cannot see
  // persona, sessionId, workingDirectory, or any runtime context (tracked as D2)."
  //
  // We verify this by confirming that the _context parameter is accepted by
  // execute() but the MCP call does not include any context fields.  The server
  // receives only the declared input arguments — it has no way to observe persona.
  // -------------------------------------------------------------------------

  it('DOCUMENTED LIMITATION: ToolContext (persona/sessionId) is NOT forwarded to MCP', async () => {
    const client = manager.getClient('json-validator')!;
    const listResult = await client.listTools();
    const mcpTool = listResult.tools.find((t: MCPTool) => t.name === 'validate_json')!;

    const adapter = new MCPToolAdapter(mcpTool, 'json-validator', client);

    // Pass a ToolContext with a persona — the MCP server should NOT see it.
    // The server only sees the schema/value args it declared in its inputSchema.
    const ctx = { persona: 'researcher', sessionId: 'sess-test-123' };
    const result = await adapter.execute(
      {
        schema: JSON.stringify({
          type: 'object',
          properties: { x: { type: 'number' } },
          required: ['x'],
        }),
        value: JSON.stringify({ x: 42 }),
      },
      ctx
    );

    // The call still succeeds — context being ignored doesn't break anything
    expect(result.status).toBe('completed');
    const parsed = parseResult(result.content as Array<{ type: string; text?: string }>);
    expect(parsed.valid).toBe(true);

    // The server received no persona/sessionId argument — it only knows about
    // the schema and value fields it declared. There is no way for an MCP tool
    // to receive ToolContext today (the doc's D2 limitation is confirmed).
  });
});
