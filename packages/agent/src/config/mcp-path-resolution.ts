// ABOUTME: PRI-1912 — resolve relative MCP command/args against an embedder base
// ABOUTME: dir. Host-placement servers run from the embedder package root (where
// ABOUTME: the server scripts live), not lace's cwd; toolRuntime servers run
// ABOUTME: container-side and are left untouched. Shared by PersonaRegistry
// ABOUTME: (persona-declared MCP) and session-config (embedder session/new MCP).

import path from 'node:path';

interface McpPathServer {
  command: string;
  args?: string[];
  placement?: 'host' | 'toolRuntime';
}

function resolveRelative(value: string, baseDir: string): string {
  return value.startsWith('./') || value.startsWith('../') ? path.resolve(baseDir, value) : value;
}

/**
 * Resolve a single MCP server's relative `./`/`../` command/args against
 * `baseDir`. Undefined placement is treated as host (matches the persona
 * default and the fact that root-runtime personas run their MCP servers
 * host-side). toolRuntime-placement servers are container-side — left untouched.
 * Absolute paths and bare command names pass through, so this is idempotent over
 * already-absolute configs. Returns the same object reference when nothing
 * changes, so callers can cheaply detect a no-op.
 */
export function resolveMcpServerCommandArgs<T extends McpPathServer>(
  server: T,
  baseDir: string
): T {
  if ((server.placement ?? 'host') !== 'host') return server;
  const command = resolveRelative(server.command, baseDir);
  const args = server.args?.map((a) => resolveRelative(a, baseDir));
  const argsChanged = args !== undefined && args.some((a, i) => a !== server.args?.[i]);
  if (command === server.command && !argsChanged) return server;
  return { ...server, command, ...(args ? { args } : {}) };
}

/** Map `resolveMcpServerCommandArgs` over a list. No-op when baseDir is undefined. */
export function resolveMcpServerPaths<T extends McpPathServer>(
  servers: T[],
  baseDir: string | undefined
): T[] {
  if (baseDir === undefined) return servers;
  return servers.map((s) => resolveMcpServerCommandArgs(s, baseDir));
}
