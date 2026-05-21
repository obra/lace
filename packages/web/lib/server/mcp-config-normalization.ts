// ABOUTME: Shared MCP config schema pieces and placement defaults for web-owned config
// ABOUTME: Keeps global and project MCP persistence aligned with agent config semantics

import { z } from 'zod';

export const McpTransportSchema = z.enum(['stdio', 'sse', 'http']);
export const McpPlacementSchema = z.enum(['toolRuntime', 'host']);
export const McpSecretReferenceSchema = z
  .object({
    namespace: z.enum(['session', 'project', 'host-service']),
    name: z.string().min(1),
  })
  .strict();

export type MCPTransport = z.infer<typeof McpTransportSchema>;
export type MCPPlacement = z.infer<typeof McpPlacementSchema>;
export type MCPSecretReference = z.infer<typeof McpSecretReferenceSchema>;
export type MCPConfigSource = 'global' | 'project';

type PlacementConfig = {
  transport?: MCPTransport;
  placement?: MCPPlacement;
};

export function defaultMcpPlacement(
  config: PlacementConfig,
  source: MCPConfigSource
): MCPPlacement {
  if (config.placement) return config.placement;
  if (config.transport === 'http' || config.transport === 'sse') return 'host';
  return source === 'global' ? 'host' : 'toolRuntime';
}

export function normalizeMcpServerConfig<T extends PlacementConfig>(
  config: T,
  source: MCPConfigSource
): T & { placement: MCPPlacement } {
  return {
    ...config,
    placement: defaultMcpPlacement(config, source),
  };
}

export function normalizeMcpServers<T extends Record<string, PlacementConfig>>(
  servers: T,
  source: MCPConfigSource
): { [K in keyof T]: T[K] & { placement: MCPPlacement } } {
  return Object.fromEntries(
    Object.entries(servers).map(([serverId, config]) => [
      serverId,
      normalizeMcpServerConfig(config, source),
    ])
  ) as { [K in keyof T]: T[K] & { placement: MCPPlacement } };
}
