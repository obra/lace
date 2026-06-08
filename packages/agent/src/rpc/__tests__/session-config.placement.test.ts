// ABOUTME: Regression guard for MCP server placement defaulting logic.
// ABOUTME: Ensures explicit placement:host is never overridden, and stdio servers default to toolRuntime.

import { describe, it, expect } from 'vitest';
import { defaultMcpServerPlacements } from '@lace/agent/rpc/session-config';

describe('defaultMcpServerPlacements', () => {
  it('preserves explicit placement:host on a stdio server', () => {
    const server = {
      name: 'my-server',
      command: 'my-cmd',
      transport: 'stdio' as const,
      placement: 'host' as const,
    };
    const [result] = defaultMcpServerPlacements([server]);
    expect(result.placement).toBe('host');
  });

  it('preserves explicit placement:host on a server with no transport', () => {
    const server = { name: 'my-server', command: 'my-cmd', placement: 'host' as const };
    const [result] = defaultMcpServerPlacements([server]);
    expect(result.placement).toBe('host');
  });

  it('assigns placement:toolRuntime to a stdio server with no explicit placement', () => {
    const server = { name: 'my-server', command: 'my-cmd', transport: 'stdio' as const };
    const [result] = defaultMcpServerPlacements([server]);
    expect(result.placement).toBe('toolRuntime');
  });

  it('assigns placement:toolRuntime to a server with no transport and no explicit placement', () => {
    const server = { name: 'my-server', command: 'my-cmd' };
    const [result] = defaultMcpServerPlacements([server]);
    expect(result.placement).toBe('toolRuntime');
  });

  it('assigns placement:host to an http server with no explicit placement', () => {
    const server = { name: 'my-server', command: 'my-cmd', transport: 'http' as const };
    const [result] = defaultMcpServerPlacements([server]);
    expect(result.placement).toBe('host');
  });

  it('assigns placement:host to an sse server with no explicit placement', () => {
    const server = { name: 'my-server', command: 'my-cmd', transport: 'sse' as const };
    const [result] = defaultMcpServerPlacements([server]);
    expect(result.placement).toBe('host');
  });
});
