import { describe, expect, it } from 'vitest';
import {
  SessionForkRequestSchema,
  SessionForkResponseSchema,
  EntProtocolRequestSchema,
} from '../methods';

describe('session/fork method', () => {
  it('parses valid session/fork request', () => {
    expect(() =>
      SessionForkRequestSchema.parse({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/fork',
        params: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000001',
        },
      })
    ).not.toThrow();
  });

  it('parses session/fork request with cwd', () => {
    expect(() =>
      SessionForkRequestSchema.parse({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/fork',
        params: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000001',
          cwd: '/home/user/project',
        },
      })
    ).not.toThrow();
  });

  it('parses session/fork request with mcpServers', () => {
    expect(() =>
      SessionForkRequestSchema.parse({
        jsonrpc: '2.0',
        id: 3,
        method: 'session/fork',
        params: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000001',
          mcpServers: [
            {
              name: 'test-server',
              command: 'node',
              args: ['server.js'],
            },
          ],
        },
      })
    ).not.toThrow();
  });

  it('parses session/fork request with both cwd and mcpServers', () => {
    expect(() =>
      SessionForkRequestSchema.parse({
        jsonrpc: '2.0',
        id: 4,
        method: 'session/fork',
        params: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000001',
          cwd: '/home/user/project',
          mcpServers: [
            {
              name: 'test-server',
              command: 'node',
              args: ['server.js'],
            },
          ],
        },
      })
    ).not.toThrow();
  });

  it('parses valid session/fork response', () => {
    expect(() =>
      SessionForkResponseSchema.parse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000002',
          forkedFrom: 'sess_00000000-0000-0000-0000-000000000001',
          messageCount: 42,
          updatedAt: '2026-01-04T00:00:00Z',
        },
      })
    ).not.toThrow();
  });

  it('includes session/fork in EntProtocolRequestSchema union', () => {
    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 5,
        method: 'session/fork',
        params: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000001',
          cwd: '/tmp',
        },
      })
    ).not.toThrow();
  });

  it('rejects session/fork with missing sessionId', () => {
    expect(() =>
      SessionForkRequestSchema.parse({
        jsonrpc: '2.0',
        id: 6,
        method: 'session/fork',
        params: {
          cwd: '/tmp',
        },
      })
    ).toThrow();
  });

  it('rejects session/fork with empty cwd', () => {
    expect(() =>
      SessionForkRequestSchema.parse({
        jsonrpc: '2.0',
        id: 7,
        method: 'session/fork',
        params: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000001',
          cwd: '',
        },
      })
    ).toThrow();
  });
});
