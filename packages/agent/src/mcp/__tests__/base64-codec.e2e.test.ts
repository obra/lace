// ABOUTME: End-to-end test for the base64-codec MCP server example.
// ABOUTME: Exercises the full real lace MCP path: MCPServerManager spawns the server
// ABOUTME: subprocess, MCPToolAdapter wraps each discovered tool, and execute() is called
// ABOUTME: for real — no mocks of the MCP protocol itself.
//
// Connection path used: MCPServerManager.startServer() (lace's real wiring).
//   The manager spawns the .mjs server via node, the MCP SDK negotiates the stdio
//   protocol, client.listTools() discovers both tools, and MCPToolAdapter wraps each.

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
const SERVER = path.join(__dirname, '..', '__examples__', 'base64-codec-server.mjs');

// Helper: parse the JSON result from an MCPToolAdapter execute() call
function parseResult(content: Array<{ type: string; text?: string }>): Record<string, string> {
  const text = content[0]?.text;
  if (typeof text !== 'string') throw new Error('No text content in result');
  return JSON.parse(text) as Record<string, string>;
}

describe('base64-codec MCP server (e2e — real lace wiring)', () => {
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
      serverId: 'base64-codec',
      config: { ...config, placement: 'host' },
      runtime: new HostToolRuntime({ id: 'test:base64-codec', cwd: process.cwd() }),
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
    const server = manager.getServer('base64-codec');
    expect(server).toBeDefined();
    expect(server?.status).toBe('running');
  });

  it('lists both base64_encode and base64_decode as discovered tools', async () => {
    const client = manager.getClient('base64-codec');
    expect(client).toBeDefined();

    const result = await client!.listTools();
    const toolNames = result.tools.map((t: MCPTool) => t.name);
    expect(toolNames).toContain('base64_encode');
    expect(toolNames).toContain('base64_decode');
  });

  it('MCPToolAdapter wraps base64_encode with the correct namespaced name', async () => {
    const client = manager.getClient('base64-codec')!;
    const listResult = await client.listTools();
    const mcpTool = listResult.tools.find((t: MCPTool) => t.name === 'base64_encode');
    expect(mcpTool).toBeDefined();

    const adapter = new MCPToolAdapter(mcpTool!, 'base64-codec', client);
    expect(adapter.name).toBe('base64-codec/base64_encode');
    expect(adapter.description).toContain('Encode a UTF-8 string');
  });

  // -------------------------------------------------------------------------
  // base64_encode — success cases
  // -------------------------------------------------------------------------

  it('encodes a plain ASCII string to Base64', async () => {
    const client = manager.getClient('base64-codec')!;
    const listResult = await client.listTools();
    const mcpTool = listResult.tools.find((t: MCPTool) => t.name === 'base64_encode')!;
    const adapter = new MCPToolAdapter(mcpTool, 'base64-codec', client);

    const result = await adapter.execute({ text: 'Hello, World!' }, {});

    expect(result.status).toBe('completed');
    const parsed = parseResult(result.content as Array<{ type: string; text?: string }>);
    expect(parsed.result).toBe(Buffer.from('Hello, World!', 'utf8').toString('base64'));
  });

  it('round-trips a UTF-8 string through encode then decode', async () => {
    const client = manager.getClient('base64-codec')!;
    const listResult = await client.listTools();
    const encodeTool = listResult.tools.find((t: MCPTool) => t.name === 'base64_encode')!;
    const decodeTool = listResult.tools.find((t: MCPTool) => t.name === 'base64_decode')!;

    const encodeAdapter = new MCPToolAdapter(encodeTool, 'base64-codec', client);
    const decodeAdapter = new MCPToolAdapter(decodeTool, 'base64-codec', client);

    const original = 'user:password123';

    const encodeResult = await encodeAdapter.execute({ text: original }, {});
    expect(encodeResult.status).toBe('completed');
    const encoded = parseResult(
      encodeResult.content as Array<{ type: string; text?: string }>
    ).result;
    expect(encoded).toBe('dXNlcjpwYXNzd29yZDEyMw==');

    const decodeResult = await decodeAdapter.execute({ encoded }, {});
    expect(decodeResult.status).toBe('completed');
    const decoded = parseResult(
      decodeResult.content as Array<{ type: string; text?: string }>
    ).result;
    expect(decoded).toBe(original);
  });

  it('encodes an empty string to an empty Base64 string', async () => {
    const client = manager.getClient('base64-codec')!;
    const listResult = await client.listTools();
    const mcpTool = listResult.tools.find((t: MCPTool) => t.name === 'base64_encode')!;
    const adapter = new MCPToolAdapter(mcpTool, 'base64-codec', client);

    const result = await adapter.execute({ text: '' }, {});

    expect(result.status).toBe('completed');
    const parsed = parseResult(result.content as Array<{ type: string; text?: string }>);
    expect(parsed.result).toBe('');
  });

  // -------------------------------------------------------------------------
  // base64_decode — edge / error cases
  // -------------------------------------------------------------------------

  it('decodes a valid Base64 string with padding', async () => {
    const client = manager.getClient('base64-codec')!;
    const listResult = await client.listTools();
    const mcpTool = listResult.tools.find((t: MCPTool) => t.name === 'base64_decode')!;
    const adapter = new MCPToolAdapter(mcpTool, 'base64-codec', client);

    // 'SGVsbG8=' decodes to 'Hello'
    const result = await adapter.execute({ encoded: 'SGVsbG8=' }, {});

    expect(result.status).toBe('completed');
    const parsed = parseResult(result.content as Array<{ type: string; text?: string }>);
    expect(parsed.result).toBe('Hello');
  });

  it('returns an error for input containing characters outside the Base64 alphabet', async () => {
    const client = manager.getClient('base64-codec')!;
    const listResult = await client.listTools();
    const mcpTool = listResult.tools.find((t: MCPTool) => t.name === 'base64_decode')!;
    const adapter = new MCPToolAdapter(mcpTool, 'base64-codec', client);

    // '!!invalid!!' is not a valid Base64 string
    const result = await adapter.execute({ encoded: '!!invalid!!' }, {});

    expect(result.status).toBe('completed');
    const parsed = parseResult(result.content as Array<{ type: string; text?: string }>);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain('Base64 alphabet');
  });
});
