// ABOUTME: Minimal MCP server used by tests to echo its process.env back to the client.
// ABOUTME: Exposes one tool `dump_env` whose result is the JSON-stringified subprocess env.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'env-dump-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: 'dump_env',
      description: 'Return the subprocess process.env as a JSON string.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, (req) => {
  if (req.params.name !== 'dump_env') {
    throw new Error(`Unknown tool: ${req.params.name}`);
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(process.env) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
