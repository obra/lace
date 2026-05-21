// ABOUTME: Web-owned MCP server configuration store
// ABOUTME: Persists global MCP configs to LACE_WEB_DIR/mcp.json

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { z } from 'zod';
import type { MCPServerConfig } from '@lace/web/types/core';
import { getLaceWebFilePath } from './web-data-dir';
import {
  McpPlacementSchema,
  McpSecretReferenceSchema,
  McpTransportSchema,
  normalizeMcpServers,
} from './mcp-config-normalization';

const ToolPolicySchema = z.enum(['allow', 'ask', 'deny', 'disable']);

const McpServerConfigSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    transport: McpTransportSchema.optional(),
    secretEnv: z.record(z.string(), McpSecretReferenceSchema).optional(),
    placement: McpPlacementSchema.optional(),
    enabled: z.boolean().optional(),
    tools: z.record(z.string(), ToolPolicySchema).optional(),
  })
  .strict();

const McpConfigSchema = z
  .object({
    servers: z.record(z.string(), McpServerConfigSchema),
  })
  .strict();

export type GlobalMcpConfig = z.infer<typeof McpConfigSchema>;

function normalizeGlobalMcpConfig(config: GlobalMcpConfig): GlobalMcpConfig {
  return {
    ...config,
    servers: normalizeMcpServers(config.servers, 'global'),
  };
}

export class McpConfigStore {
  private static readonly filename = 'mcp.json';

  static loadGlobalConfig(): GlobalMcpConfig | null {
    const filePath = getLaceWebFilePath(this.filename);
    if (!existsSync(filePath)) return null;

    const raw = readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const result = McpConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid global MCP config format: ${filePath}`);
    }
    return normalizeGlobalMcpConfig(result.data);
  }

  static saveGlobalConfig(config: GlobalMcpConfig): void {
    const normalizedConfig = normalizeGlobalMcpConfig(config);
    const filePath = getLaceWebFilePath(this.filename);
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true });

    const tempPath = `${filePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(normalizedConfig, null, 2), { mode: 0o600 });
    renameSync(tempPath, filePath);
  }

  static updateServerConfig(serverId: string, serverConfig: MCPServerConfig): void {
    const current = this.loadGlobalConfig() || { servers: {} };
    const next: GlobalMcpConfig = {
      ...current,
      servers: {
        ...current.servers,
        [serverId]: serverConfig,
      },
    };
    this.saveGlobalConfig(next);
  }

  static deleteServerConfig(serverId: string): void {
    const current = this.loadGlobalConfig();
    if (!current?.servers[serverId]) return;
    const next = { ...current, servers: { ...current.servers } };
    delete next.servers[serverId];
    this.saveGlobalConfig(next);
  }
}
