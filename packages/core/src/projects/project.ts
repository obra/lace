// ABOUTME: Project class for managing AI coding projects with working directories and configurations
// ABOUTME: Provides high-level interface for project CRUD operations and session management

import { randomUUID } from 'crypto';
import { basename, join } from 'path';
import { logger } from '@lace/core/utils/logger';
import { accessSync, constants, existsSync, mkdirSync, statSync } from 'fs';
import { ProjectEnvironmentManager } from './environment-variables';
import { ProjectStore, type ProjectRecord } from './project-store';
import { getProcessTempDir } from '@lace/core/config/lace-dir';
import { MCPConfigLoader } from '@lace/core/config/mcp-config-loader';
import type { MCPServerConfig } from '@lace/core/config/mcp-types';
import { ToolExecutor } from '@lace/core/tools/executor';
import { ToolCatalog } from '@lace/core/tools/tool-catalog';
import { MCPServerManager } from '@lace/core/mcp/server-manager';

type ProjectData = {
  id: string;
  name: string;
  description: string;
  workingDirectory: string;
  configuration: Record<string, unknown>;
  isArchived: boolean;
  createdAt: Date;
  lastUsedAt: Date;
};

export interface ProjectInfo {
  id: string;
  name: string;
  description: string;
  workingDirectory: string;
  isArchived: boolean;
  createdAt: Date;
  lastUsedAt: Date;
  sessionCount?: number;
}

function projectDataFromRecord(record: ProjectRecord): ProjectData {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    workingDirectory: record.workingDirectory,
    configuration: record.configuration,
    isArchived: record.isArchived,
    createdAt: new Date(record.createdAt),
    lastUsedAt: new Date(record.lastUsedAt),
  };
}

function projectRecordFromData(data: ProjectData): ProjectRecord {
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    workingDirectory: data.workingDirectory,
    configuration: data.configuration ?? {},
    isArchived: data.isArchived,
    createdAt: data.createdAt.toISOString(),
    lastUsedAt: data.lastUsedAt.toISOString(),
  };
}

export class Project {
  private static _projectRegistry = new Map<string, Project>();

  private _id: string;
  private _projectData: ProjectData; // 👈 NEW: Cache the project data
  private _environmentManager: ProjectEnvironmentManager;

  constructor(projectData: ProjectData) {
    this._id = projectData.id;
    this._projectData = projectData; // 👈 NEW: Store the data
    this._environmentManager = new ProjectEnvironmentManager();

    // Register this project in the registry for cache consistency
    Project._projectRegistry.set(this._id, this);
  }

  static create(
    name: string,
    workingDirectory: string,
    description = '',
    configuration: Record<string, unknown> = {}
  ): Project {
    // Validate workingDirectory is not empty
    if (!workingDirectory || workingDirectory.trim() === '') {
      throw new Error(
        'Project workingDirectory cannot be empty. This usually means tempDir was accessed before beforeEach ran.'
      );
    }

    // Validate workingDirectory exists and is a real directory
    if (!existsSync(workingDirectory)) {
      throw new Error(
        `Project workingDirectory does not exist: ${workingDirectory}. ` +
          'In tests, use a temp directory from setupCoreTest().'
      );
    }

    const stats = statSync(workingDirectory);
    if (!stats.isDirectory()) {
      throw new Error(`Project workingDirectory is not a directory: ${workingDirectory}`);
    }

    // Validate directory is writable
    try {
      accessSync(workingDirectory, constants.W_OK);
    } catch {
      throw new Error(`Project workingDirectory is not writable: ${workingDirectory}`);
    }

    // Auto-generate name from directory if not provided
    const projectName = name.trim() || Project.generateNameFromDirectory(workingDirectory);

    const projectData: ProjectData = {
      id: randomUUID(),
      name: projectName,
      description,
      workingDirectory,
      configuration,
      isArchived: false,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    };

    const store = new ProjectStore();
    store.upsert(projectRecordFromData(projectData));

    logger.info('Project created', { projectId: projectData.id, name, workingDirectory });

    // Create the project instance
    const project = new Project(projectData);

    return project;
  }

  static getAll(): ProjectInfo[] {
    const store = new ProjectStore();
    const projects = store.loadAll().map(projectDataFromRecord);

    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      workingDirectory: project.workingDirectory,
      isArchived: project.isArchived,
      createdAt: project.createdAt,
      lastUsedAt: project.lastUsedAt,
    }));
  }

  static getById(projectId: string): Project | null {
    const store = new ProjectStore();
    const record = store.load(projectId);
    if (!record) return null;
    return new Project(projectDataFromRecord(record));
  }

  getId(): string {
    return this._id;
  }

  getInfo(): ProjectInfo | null {
    // 👈 NEW: Use cached data instead of database query
    return {
      id: this._projectData.id,
      name: this._projectData.name,
      description: this._projectData.description,
      workingDirectory: this._projectData.workingDirectory,
      isArchived: this._projectData.isArchived,
      createdAt: this._projectData.createdAt,
      lastUsedAt: this._projectData.lastUsedAt,
    };
  }

  getName(): string {
    return this._projectData.name;
  }

  getDescription(): string {
    return this._projectData.description;
  }

  getWorkingDirectory(): string {
    return this._projectData.workingDirectory;
  }

  // Add method to force refresh from database
  refreshFromDatabase(): void {
    const store = new ProjectStore();
    const record = store.load(this._id);
    if (!record) return;
    this._projectData = projectDataFromRecord(record);
  }

  getConfiguration(): Record<string, unknown> {
    return this._projectData.configuration || {};
  }

  updateInfo(updates: {
    name?: string;
    description?: string;
    workingDirectory?: string;
    configuration?: Record<string, unknown>;
    isArchived?: boolean;
  }): void {
    // Always update lastUsedAt when project is modified
    const updatesWithTimestamp = {
      ...updates,
      lastUsedAt: new Date(),
    };

    // 👈 NEW: Update cached data
    this._projectData = {
      ...this._projectData,
      ...updatesWithTimestamp,
    };

    const store = new ProjectStore();
    store.upsert(projectRecordFromData(this._projectData));

    // Update all other Project instances for the same ID to maintain cache consistency
    for (const [registryProjectId, registryProject] of Project._projectRegistry.entries()) {
      if (registryProjectId === this._id && registryProject !== this) {
        registryProject._projectData = {
          ...registryProject._projectData,
          ...updatesWithTimestamp,
        };
      }
    }

    logger.info('Project updated', { projectId: this._id, updates });
  }

  updateConfiguration(updates: Record<string, unknown>): void {
    const currentConfig = this.getConfiguration();
    this.updateInfo({ configuration: { ...currentConfig, ...updates } });
  }

  archive(): void {
    this.updateInfo({ isArchived: true });
    logger.info('Project archived', { projectId: this._id });
  }

  unarchive(): void {
    this.updateInfo({ isArchived: false });
    logger.info('Project unarchived', { projectId: this._id });
  }

  delete(): void {
    const store = new ProjectStore();
    store.delete(this._id);

    // Clean up registry
    Project._projectRegistry.delete(this._id);

    logger.info('Project deleted', { projectId: this._id });
  }

  touchLastUsed(): void {
    this.updateInfo({});
  }

  // Advanced Feature Managers
  getEnvironmentManager(): ProjectEnvironmentManager {
    return this._environmentManager;
  }

  // Environment Variables Management
  setEnvironmentVariables(
    variables: Record<string, string>,
    options?: { encrypt?: string[] }
  ): void {
    this._environmentManager.setEnvironmentVariables(this._id, variables, options);
  }

  getEnvironmentVariables(): Record<string, string> {
    return this._environmentManager.getEnvironmentVariables(this._id);
  }

  getMergedEnvironment(): Record<string, string> {
    return this._environmentManager.getMergedEnvironment(this._id);
  }

  deleteEnvironmentVariable(key: string): void {
    this._environmentManager.deleteEnvironmentVariable(this._id, key);
  }

  /**
   * Clear the project registry - primarily for testing
   */
  static clearRegistry(): void {
    Project._projectRegistry.clear();
  }

  /**
   * Get registry size - primarily for testing
   */
  static getRegistrySize(): number {
    return Project._projectRegistry.size;
  }

  /**
   * Get temporary directory for a project
   * Creates: /tmp/lace-runtime-{pid}-{timestamp}-{random}/project-{projectId}/
   */
  static getProjectTempDir(projectId: string): string {
    const processTempDir = getProcessTempDir();
    const projectTempPath = join(processTempDir, `project-${projectId}`);
    mkdirSync(projectTempPath, { recursive: true });
    return projectTempPath;
  }

  /**
   * Get MCP servers configured for this project
   */
  getMCPServers(): Record<string, MCPServerConfig> {
    const config = MCPConfigLoader.loadConfig(this.getWorkingDirectory());
    return config.servers;
  }

  /**
   * Get specific MCP server configuration for this project
   */
  getMCPServer(serverId: string): MCPServerConfig | null {
    const servers = this.getMCPServers();
    return servers[serverId] || null;
  }

  /**
   * Create ToolExecutor with project MCP servers for configuration APIs
   */
  createToolExecutor(): ToolExecutor {
    const toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();

    // For configuration APIs, we just show what MCP tools would be available
    // without actually starting the servers (that happens in sessions)
    const mcpServers = this.getMCPServers();
    if (Object.keys(mcpServers).length > 0) {
      const mcpManager = new MCPServerManager();
      toolExecutor.registerMCPTools(mcpManager);

      // Add placeholder tools based on server configuration
      for (const [serverId, serverConfig] of Object.entries(mcpServers)) {
        if (serverConfig.enabled && serverConfig.tools) {
          for (const toolName of Object.keys(serverConfig.tools)) {
            // Create placeholder MCP tools for configuration display
            const _mcpToolName = `${serverId}/${toolName}`;
            // The tool adapter will handle this properly when servers actually run
          }
        }
      }
    }

    return toolExecutor;
  }

  /**
   * Add new MCP server to project configuration
   */
  addMCPServer(serverId: string, serverConfig: MCPServerConfig): void {
    // Check for duplicates
    const existingServers = this.getMCPServers();
    if (existingServers[serverId]) {
      throw new Error(`MCP server '${serverId}' already exists in project`);
    }

    // Save server configuration to project config
    MCPConfigLoader.updateServerConfig(serverId, serverConfig, this.getWorkingDirectory());

    // Start async tool discovery (non-blocking)
    void ToolCatalog.discoverAndCacheTools(
      serverId,
      serverConfig,
      this.getWorkingDirectory()
    ).catch((error) => {
      logger.warn(`Tool discovery failed for MCP server ${serverId}:`, error);
    });
  }

  /**
   * Update existing MCP server configuration
   */
  updateMCPServer(serverId: string, serverConfig: MCPServerConfig): void {
    MCPConfigLoader.updateServerConfig(serverId, serverConfig, this.getWorkingDirectory());
  }

  /**
   * Remove MCP server from project configuration
   */
  deleteMCPServer(serverId: string): void {
    MCPConfigLoader.deleteServerConfig(serverId, this.getWorkingDirectory());
  }

  private static generateNameFromDirectory(workingDirectory: string): string {
    const cleanPath = workingDirectory.replace(/[/\\]+$/, '');
    const dirName = basename(cleanPath);
    return dirName || 'root';
  }
}
