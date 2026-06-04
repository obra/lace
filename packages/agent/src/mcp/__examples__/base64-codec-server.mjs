// ABOUTME: Example MCP server that encodes and decodes Base64.
// ABOUTME: Demonstrates a self-contained, useful MCP tool: agents frequently need to
// ABOUTME: encode binary data or secret values for embedding in configs, headers, or
// ABOUTME: API payloads, and to decode base64 blobs received from external systems.
// ABOUTME: No external dependencies — uses Node's built-in Buffer.
//
// Usage (stdio, same as all lace MCP servers):
//   node base64-codec-server.mjs
//
// Exposes two tools:
//   base64_encode — encode a UTF-8 string to Base64
//     - text: string  (the text to encode)
//   base64_decode — decode a Base64 string back to UTF-8
//     - encoded: string  (the Base64-encoded value)
// Returns: { result: string }  on success
//          { error: string }   on failure (e.g. invalid Base64)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Buffer } from 'node:buffer';
import { z } from 'zod';

const server = new McpServer(
  { name: 'base64-codec', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.registerTool(
  'base64_encode',
  {
    description:
      'Encode a UTF-8 string to Base64. ' +
      'Useful for embedding text in HTTP Authorization headers, data URIs, or JSON payloads. ' +
      'Returns { result: "<base64>" }.',
    inputSchema: {
      text: z.string().describe('The UTF-8 text to encode'),
    },
  },
  ({ text }) => {
    const result = Buffer.from(text, 'utf8').toString('base64');
    return {
      content: [{ type: 'text', text: JSON.stringify({ result }) }],
    };
  }
);

server.registerTool(
  'base64_decode',
  {
    description:
      'Decode a Base64 string back to UTF-8 text. ' +
      'Returns { result: "<decoded text>" } on success, or { error: "<message>" } if the input is not valid Base64.',
    inputSchema: {
      encoded: z.string().describe('The Base64-encoded string to decode'),
    },
  },
  ({ encoded }) => {
    // Validate that the input is legitimate Base64 (standard or URL-safe alphabet,
    // optional padding).  Buffer.from silently ignores unknown characters, so we
    // must validate first.
    const base64Re = /^[A-Za-z0-9+/\-_]*={0,2}$/;
    if (!base64Re.test(encoded)) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Input contains characters outside the Base64 alphabet' }),
          },
        ],
      };
    }

    try {
      // Normalise URL-safe Base64 (- → +, _ → /) before decoding.
      const standard = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const result = Buffer.from(standard, 'base64').toString('utf8');
      return {
        content: [{ type: 'text', text: JSON.stringify({ result }) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: String(err) }),
          },
        ],
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
