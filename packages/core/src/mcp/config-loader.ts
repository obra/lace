// ABOUTME: Configuration loader for MCP servers with hierarchical merging
// ABOUTME: Supports global and project-level configs with server-level replacement

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import type { MCPConfig } from '~/mcp/types';

// Zod schemas for validation
const ApprovalLevelSchema = z.enum([
  'disable',
  'deny',
  'require-approval',
  'allow-once',
  'allow-session',
  'allow-project',
  'allow-always',
]);

const MCPServerConfigSchema = z.object({
  command: z.string().min(1, 'Command is required'),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  enabled: z.boolean(),
  tools: z.record(z.string(), ApprovalLevelSchema),
});

const MCPConfigSchema = z.object({
  servers: z.record(z.string(), MCPServerConfigSchema),
});

export class MCPConfigLoader {
  private static readonly CONFIG_FILENAME = 'mcp-config.json';

  /**
   * Load merged MCP configuration from global and project configs
   * Project server configs completely replace global ones (no inheritance)
   */
  static loadConfig(projectRoot?: string): MCPConfig {
    const globalConfig = this.loadGlobalConfig();
    const projectConfig = projectRoot ? this.loadProjectConfig(projectRoot) : null;

    return this.mergeConfigs(globalConfig, projectConfig);
  }

  private static loadGlobalConfig(): MCPConfig | null {
    const homePath = process.env.HOME || process.env.USERPROFILE;
    if (!homePath) {
      return null;
    }

    const globalConfigPath = join(homePath, '.lace', this.CONFIG_FILENAME);
    return this.loadConfigFile(globalConfigPath);
  }

  private static loadProjectConfig(projectRoot: string): MCPConfig | null {
    const projectConfigPath = join(projectRoot, '.lace', this.CONFIG_FILENAME);
    return this.loadConfigFile(projectConfigPath);
  }

  private static loadConfigFile(filepath: string): MCPConfig | null {
    if (!existsSync(filepath)) {
      return null;
    }

    try {
      const content = readFileSync(filepath, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      return MCPConfigSchema.parse(parsed);
    } catch (error) {
      throw new Error(
        `Invalid MCP config at ${filepath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private static mergeConfigs(global: MCPConfig | null, project: MCPConfig | null): MCPConfig {
    if (!global && !project) {
      return { servers: {} };
    }

    // Start with global servers
    const merged: MCPConfig = {
      servers: { ...(global?.servers || {}) },
    };

    // Project servers completely replace global servers (no inheritance)
    if (project) {
      Object.assign(merged.servers, project.servers);
    }

    return merged;
  }

  /**
   * Validate configuration structure without loading from files
   */
  static validateConfig(config: unknown): MCPConfig {
    return MCPConfigSchema.parse(config);
  }
}
