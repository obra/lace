import { describe, expect, it } from 'vitest';
import {
  EntProtocolNotificationSchema,
  EntProtocolRequestSchema,
  EntAgentPingResponseSchema,
  EntSessionEventsResponseSchema,
  InitializeResponseSchema,
  SessionNewResponseSchema,
  SessionPromptResponseSchema,
  SessionRequestPermissionResponseSchema,
} from '../methods';

describe('protocol shapes (representative examples)', () => {
  it('parses representative client->agent requests', () => {
    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '1.0',
          clientInfo: { name: 'test-client', version: '0.0.0' },
          capabilities: { streaming: true },
          config: { approvalMode: 'ask' },
        },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'c_2',
        method: 'session/new',
        params: {
          workDir: '/tmp',
          persona: 'lace',
          systemPrompt: { type: 'preset', preset: 'lace' },
        },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'c_3',
        method: 'session/prompt',
        params: {
          content: [{ type: 'text', text: 'hello' }],
        },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 4,
        method: 'ent/agent/ping',
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 5,
        method: 'ent/session/events',
        params: { afterEventSeq: 10, limit: 50 },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 6,
        method: 'ent/session/compact',
        params: { strategy: 'summarize', targetTokens: 1000, preserveRecent: 25 },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 7,
        method: 'ent/session/rewind',
        params: { toEventSeq: 123 },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 8,
        method: 'ent/session/checkpoint',
        params: { label: 'before-refactor' },
      })
    ).not.toThrow();

    // MCP server management methods
    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 9,
        method: 'ent/mcp/servers/list',
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 10,
        method: 'ent/mcp/servers/upsert',
        params: {
          name: 'test-server',
          command: 'node',
          args: ['server.js'],
          enabled: true,
        },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 11,
        method: 'ent/mcp/servers/delete',
        params: { serverId: 'test-server' },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 12,
        method: 'ent/mcp/servers/test',
        params: { serverId: 'test-server' },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 13,
        method: 'ent/mcp/tools/list',
        params: { serverId: 'test-server' },
      })
    ).not.toThrow();
  });

  it('parses representative agent->client notifications', () => {
    expect(() =>
      EntProtocolNotificationSchema.parse({
        jsonrpc: '2.0',
        method: 'ent/session/inject',
        params: {
          content: [{ type: 'text', text: 'system prompt' }],
          priority: 'immediate',
        },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolNotificationSchema.parse({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess_test',
          streamSeq: 1,
          turnId: 'turn_1',
          turnSeq: 1,
          type: 'text_delta',
          text: 'hi',
        },
      })
    ).not.toThrow();
  });

  it('parses representative responses', () => {
    expect(() =>
      InitializeResponseSchema.parse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '1.0',
          agentInfo: { name: 'lace-agent', version: '0.0.0' },
          capabilities: {
            streaming: true,
            multiTurn: true,
            tools: [
              {
                name: 'read_file',
                description: 'read a file',
                kind: 'read',
                inputSchema: { type: 'object' },
              },
            ],
            'ent/contextInjection': true,
            'ent/backgroundJobs': true,
            'ent/fileCheckpointing': false,
            'ent/structuredOutput': false,
          },
        },
      })
    ).not.toThrow();

    expect(() =>
      SessionNewResponseSchema.parse({
        jsonrpc: '2.0',
        id: 'c_2',
        result: {
          sessionId: 'sess_test',
          created: '2026-01-04T00:00:00Z',
        },
      })
    ).not.toThrow();

    expect(() =>
      SessionPromptResponseSchema.parse({
        jsonrpc: '2.0',
        id: 'c_3',
        result: {
          turnId: 'turn_1',
          stopReason: 'end_turn',
          content: [{ type: 'text', text: 'done' }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      })
    ).not.toThrow();

    expect(() =>
      EntAgentPingResponseSchema.parse({
        jsonrpc: '2.0',
        id: 4,
        result: {
          ok: true,
          timestamp: '2026-01-04T00:00:00Z',
        },
      })
    ).not.toThrow();

    expect(() =>
      EntSessionEventsResponseSchema.parse({
        jsonrpc: '2.0',
        id: 5,
        result: {
          events: [
            {
              eventSeq: 11,
              timestamp: '2026-01-04T00:00:00Z',
              type: 'message',
              data: { role: 'assistant' },
            },
          ],
          hasMore: false,
        },
      })
    ).not.toThrow();

    expect(() =>
      SessionRequestPermissionResponseSchema.parse({
        jsonrpc: '2.0',
        id: 'a_1',
        result: { decision: 'allow' },
      })
    ).not.toThrow();
  });
});
