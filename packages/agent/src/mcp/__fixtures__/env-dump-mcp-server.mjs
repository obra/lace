// ABOUTME: Minimal MCP server used by tests to echo its process.env back to the client.
// ABOUTME: Exposes one tool `dump_env` whose result is the JSON-stringified subprocess env.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer(
  { name: 'env-dump-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.registerTool(
  'dump_env',
  {
    description: 'Return the subprocess process.env as a JSON string.',
    inputSchema: {},
  },
  () => ({
    content: [{ type: 'text', text: JSON.stringify(process.env) }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
