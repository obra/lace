// ABOUTME: Configuration loader for MCP servers with hierarchical merging
// ABOUTME: Supports global and project-level configs with server-level replacement

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { z } from 'zod';
import type { MCPConfig, MCPServerConfig } from '~/config/mcp-types';

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
   * Load merged MCP configuration from global and project configs with validation and error recovery
   * Project server configs completely replace global ones (no inheritance)
   */
  static loadConfig(projectRoot?: string): MCPConfig {
    const rawConfig = this.loadRawConfig(projectRoot);
    return this.validateConfig(rawConfig);
  }

  /**
   * Load raw configuration without validation
   */
  private static loadRawConfig(projectRoot?: string): MCPConfig {
    const globalConfig = this.loadGlobalConfigInternal();
    const projectConfig = projectRoot ? this.loadProjectConfig(projectRoot) : null;

    return this.mergeConfigs(globalConfig, projectConfig);
  }

  /**
   * Validate config and disable invalid servers (graceful degradation)
   */
  static validateConfig(config: MCPConfig): MCPConfig {
    const validatedConfig = { ...config };

    for (const [serverId, serverConfig] of Object.entries(validatedConfig.servers)) {
      try {
        MCPServerConfigSchema.parse(serverConfig);
      } catch (error) {
        // Disable invalid servers, keep valid ones running
        validatedConfig.servers[serverId] = {
          ...serverConfig,
          enabled: false,
          tools: {},
        };
        console.warn(`Disabled invalid MCP server ${serverId}:`, error);
      }
    }

    return validatedConfig;
  }

  private static loadGlobalConfigInternal(): MCPConfig | null {
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
   * Load global configuration only (for API use)
   */
  static loadGlobalConfig(): MCPConfig | null {
    const homePath = process.env.HOME || process.env.USERPROFILE;
    if (!homePath) {
      return null;
    }

    const globalConfigPath = join(homePath, '.lace', this.CONFIG_FILENAME);
    return this.loadConfigFile(globalConfigPath);
  }

  /**
   * Save global configuration
   */
  static saveGlobalConfig(config: MCPConfig): void {
    const homePath = process.env.HOME || process.env.USERPROFILE;
    if (!homePath) {
      throw new Error('Cannot determine home directory for global config');
    }

    const laceDir = join(homePath, '.lace');
    const globalConfigPath = join(laceDir, this.CONFIG_FILENAME);

    this.saveConfigFile(globalConfigPath, config);
  }

  /**
   * Save configuration with validation
   */
  static saveConfig(config: MCPConfig, projectRoot?: string): void {
    // Validate before saving
    const validatedConfig = this.validateConfig(config);

    if (projectRoot) {
      const projectConfigPath = join(projectRoot, '.lace', this.CONFIG_FILENAME);
      this.saveConfigFile(projectConfigPath, validatedConfig);
    } else {
      this.saveGlobalConfig(validatedConfig);
    }
  }

  /**
   * Update specific server configuration in project
   */
  static updateServerConfig(
    serverId: string,
    serverConfig: MCPServerConfig,
    projectRoot?: string
  ): void {
    const currentConfig = projectRoot
      ? this.loadProjectConfig(projectRoot)
      : this.loadGlobalConfig();
    const config = currentConfig || { servers: {} };

    config.servers[serverId] = serverConfig;
    this.saveConfig(config, projectRoot);
  }

  /**
   * Delete server configuration from project
   */
  static deleteServerConfig(serverId: string, projectRoot?: string): void {
    const currentConfig = projectRoot
      ? this.loadProjectConfig(projectRoot)
      : this.loadGlobalConfig();
    if (!currentConfig) return;

    delete currentConfig.servers[serverId];
    this.saveConfig(currentConfig, projectRoot);
  }

  /**
   * Save configuration to file
   */
  private static saveConfigFile(filepath: string, config: MCPConfig): void {
    // Ensure directory exists
    mkdirSync(dirname(filepath), { recursive: true });

    const content = JSON.stringify(config, null, 2);
    writeFileSync(filepath, content, 'utf-8');
  }

  /**
   * Validate configuration structure without loading from files
   */
  static validateConfigStructure(config: unknown): MCPConfig {
    return MCPConfigSchema.parse(config);
  }
}
