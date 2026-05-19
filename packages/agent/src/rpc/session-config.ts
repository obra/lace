// ABOUTME: Shared session configuration helpers used by lifecycle and configure handlers.

import { McpServerConfigSchema, type McpServerConfig } from '@lace/ent-protocol';
import { throwInvalidParams } from './utils';

export function mergeMcpServers(existing: unknown, incoming: unknown): McpServerConfig[] {
  const parsedIncoming = McpServerConfigSchema.array().safeParse(incoming);
  if (!parsedIncoming.success) {
    throwInvalidParams('mcpServers is invalid');
  }

  for (const server of parsedIncoming.data) {
    if (server.transport && server.transport !== 'stdio') {
      throwInvalidParams(`Unsupported MCP transport for ${server.name}: ${server.transport}`);
    }
  }

  const parsedExisting = Array.isArray(existing)
    ? McpServerConfigSchema.array().safeParse(existing)
    : { success: true as const, data: [] as McpServerConfig[] };
  const existingServers = parsedExisting.success ? parsedExisting.data : [];

  const incomingByName = new Map(parsedIncoming.data.map((server) => [server.name, server]));
  const merged: McpServerConfig[] = [];
  const seen = new Set<string>();

  for (const oldServer of existingServers) {
    const incomingServer = incomingByName.get(oldServer.name);
    if (incomingServer) {
      merged.push({ ...oldServer, ...incomingServer });
    } else {
      merged.push(oldServer);
    }
    seen.add(oldServer.name);
  }

  for (const server of parsedIncoming.data) {
    if (seen.has(server.name)) continue;
    merged.push(server);
  }

  return merged;
}
