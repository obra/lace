// ABOUTME: Stdio MCP test server exposing one tool, "send", whose FIRST tools/list
// ABOUTME: is delayed by SLOW_FIRST_LIST_MS (default 0). Models a box slow right after boot.

/* global process */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const slowFirstListMs = Number(process.env.SLOW_FIRST_LIST_MS ?? '0');
let listCalls = 0;

const server = new Server(
  { name: 'slow-first-list', version: '0.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  listCalls++;
  if (listCalls === 1 && slowFirstListMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, slowFirstListMs));
  }
  return {
    tools: [
      {
        name: 'send',
        description: 'Send a chat message',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: 'text', text: 'sent' }],
}));

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

await server.connect(new StdioServerTransport());
