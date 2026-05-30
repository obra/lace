import { describe, it, expect } from 'vitest';
import { resolveMcpServerCommandArgs, resolveMcpServerPaths } from './mcp-path-resolution';

describe('resolveMcpServerCommandArgs (PRI-1912)', () => {
  it('resolves relative ./ and ../ command/args against baseDir for host placement', () => {
    const out = resolveMcpServerCommandArgs(
      { command: './node_modules/.bin/tsx', args: ['./src/mcp/servers/knowledge.ts', '--flag'] },
      '/pkg/root'
    );
    expect(out.command).toBe('/pkg/root/node_modules/.bin/tsx');
    expect(out.args).toEqual(['/pkg/root/src/mcp/servers/knowledge.ts', '--flag']);
  });

  it('treats undefined placement as host (resolves)', () => {
    const out = resolveMcpServerCommandArgs({ command: './x' }, '/pkg');
    expect(out.command).toBe('/pkg/x');
  });

  it('leaves toolRuntime-placement servers untouched (container-side path)', () => {
    const server = { command: './rel/in/container.js', placement: 'toolRuntime' as const };
    expect(resolveMcpServerCommandArgs(server, '/pkg')).toBe(server);
  });

  it('leaves absolute paths and bare command names unchanged (idempotent)', () => {
    const server = { command: 'node', args: ['/opt/abs/index.js'] };
    expect(resolveMcpServerCommandArgs(server, '/pkg')).toBe(server);
  });
});

describe('resolveMcpServerPaths (PRI-1912)', () => {
  it('maps over a list, resolving host-placement relatives', () => {
    const out = resolveMcpServerPaths(
      [
        { name: 'a', command: './bin/a' },
        { name: 'b', command: 'node', args: ['/abs.js'] },
        { name: 'c', command: './bin/c.js', placement: 'toolRuntime' as const },
      ] as Array<{
        name: string;
        command: string;
        args?: string[];
        placement?: 'host' | 'toolRuntime';
      }>,
      '/pkg'
    );
    expect(out[0].command).toBe('/pkg/bin/a');
    expect(out[1].command).toBe('node');
    expect(out[2].command).toBe('./bin/c.js'); // toolRuntime untouched
  });

  it('is a no-op when baseDir is undefined', () => {
    const servers = [{ command: './x' }];
    expect(resolveMcpServerPaths(servers, undefined)).toBe(servers);
  });
});
