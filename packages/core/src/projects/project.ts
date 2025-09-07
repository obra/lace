// ABOUTME: Project class for managing AI coding projects with working directories and configurations
// ABOUTME: Provides high-level interface for project CRUD operations and session management

import { randomUUID } from 'crypto';
import { basename } from 'path';
import { getPersistence, ProjectData, SessionData } from '~/persistence/database';
import { logger } from '~/utils/logger';
import { Session } from '~/sessions/session';
import type { ThreadId } from '~/threads/types';
import { ThreadManager } from '~/threads/thread-manager';
import type { SessionConfiguration } from '~/sessions/session-config';
import { ProjectEnvironmentManager } from '~/projects/environment-variables';
import { getProcessTempDir } from '~/config/lace-dir';
import { MCPConfigLoader } from '~/config/mcp-config-loader';
import type { MCPServerConfig } from '~/config/mcp-types';
import type { ToolExecutor } from '~/tools/executor';
import { ToolCatalog } from '~/tools/tool-catalog';
import { mkdirSync } from 'fs';
import { join } from 'path';

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
    const persistence = getPersistence();

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

    persistence.saveProject(projectData);
    // Don't close the global persistence - it's managed by the persistence system

    logger.info('Project created', { projectId: projectData.id, name, workingDirectory });

    // Create the project instance
    const project = new Project(projectData);

    // Auto-create a default session with project configuration
    try {
      void Session.create({
        name: 'Main Session',
        description: 'Default session for project',
        projectId: projectData.id,
        configuration, // Pass project configuration to session
      });

      logger.debug('Auto-created default session for project', { projectId: projectData.id });
    } catch (error) {
      logger.warn('Failed to create default session for project', {
        projectId: projectData.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return project;
  }

  static getAll(): ProjectInfo[] {
    const persistence = getPersistence();
    const projects = persistence.loadAllProjects();

    return projects.map((project) => {
      // Create a temporary Project instance to get session count
      const projectInstance = new Project(project);
      return {
        id: project.id,
        name: project.name,
        description: project.description,
        workingDirectory: project.workingDirectory,
        isArchived: project.isArchived,
        createdAt: project.createdAt,
        lastUsedAt: project.lastUsedAt,
        sessionCount: projectInstance.getSessionCount(),
      };
    });
  }

  static getById(projectId: string): Project | null {
    const persistence = getPersistence();
    const projectData = persistence.loadProject(projectId);

    if (!projectData) {
      return null;
    }

    // 👈 NEW: Pass projectData to constructor instead of discarding it
    return new Project(projectData);
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
      sessionCount: this.getSessionCount(),
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
    const persistence = getPersistence();
    const freshData = persistence.loadProject(this._id);
    if (freshData) {
      this._projectData = freshData;
    }
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
    const persistence = getPersistence();

    // Always update lastUsedAt when project is modified
    const updatesWithTimestamp = {
      ...updates,
      lastUsedAt: new Date(),
    };

    persistence.updateProject(this._id, updatesWithTimestamp);

    // 👈 NEW: Update cached data
    this._projectData = {
      ...this._projectData,
      ...updatesWithTimestamp,
    };

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

  updateConfiguration(updates: Partial<SessionConfiguration>): void {
    // For now, we'll do basic validation here to avoid circular dependency
    // In a full implementation, this would use a shared validation schema
    const validatedConfig = updates as SessionConfiguration;

    const currentConfig = this.getConfiguration();
    const newConfig = { ...currentConfig, ...validatedConfig };

    this.updateInfo({
      configuration: newConfig as Record<string, unknown>,
    });
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
    const persistence = getPersistence();

    // Delete all sessions in this project first using our deleteSession method
    const sessionData = persistence.loadSessionsByProject(this._id);
    for (const sessionInfo of sessionData) {
      this.deleteSession(sessionInfo.id);
    }

    // Then delete the project
    persistence.deleteProject(this._id);
    // Don't close the global persistence - it's managed by the persistence system

    // Clean up registry
    Project._projectRegistry.delete(this._id);

    logger.info('Project deleted', { projectId: this._id });
  }

  touchLastUsed(): void {
    this.updateInfo({});
  }

  getSessions(): (SessionData & { agentCount: number })[] {
    const persistence = getPersistence();
    const sessionDataList = persistence.loadSessionsByProject(this._id);

    // Use persistence layer directly for agent counts to avoid async complexity
    return sessionDataList.map((sessionData) => {
      const agentCount = persistence.getThreadsBySession(sessionData.id).length;

      return {
        ...sessionData,
        agentCount,
      };
    });
  }

  getSession(sessionId: string): SessionData | null {
    const persistence = getPersistence();
    const session = persistence.loadSession(sessionId);

    // Verify session belongs to this project
    if (session && session.projectId !== this._id) {
      return null;
    }

    return session;
  }

  updateSession(sessionId: string, updates: Partial<SessionData>): SessionData | null {
    const persistence = getPersistence();

    // Verify session belongs to this project
    const existingSession = persistence.loadSession(sessionId);
    if (!existingSession || existingSession.projectId !== this._id) {
      return null;
    }

    // Always update the timestamp
    const updatesWithTimestamp = {
      ...updates,
      updatedAt: new Date(),
    };

    persistence.updateSession(sessionId, updatesWithTimestamp);
    logger.info('Session updated', { sessionId, projectId: this._id, updates });

    return persistence.loadSession(sessionId);
  }

  deleteSession(sessionId: string): boolean {
    const persistence = getPersistence();

    // Verify session belongs to this project
    const existingSession = persistence.loadSession(sessionId);
    if (!existingSession || existingSession.projectId !== this._id) {
      return false;
    }

    // Delete all threads in this session first using ThreadManager
    const threadManager = new ThreadManager();
    const threads = persistence.getAllThreadsWithMetadata();
    const sessionThreads = threads.filter((thread) => thread.sessionId === sessionId);

    for (const thread of sessionThreads) {
      threadManager.deleteThread(thread.id);
    }

    // Then delete the session
    persistence.deleteSession(sessionId);
    logger.info('Session deleted', { sessionId, projectId: this._id });

    return true;
  }

  getSessionCount(): number {
    const sessions = this.getSessions();
    return sessions.length;
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
  async createToolExecutor(): Promise<ToolExecutor> {
    const { ToolExecutor } = await import('~/tools/executor');
    const toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();

    // For configuration APIs, we just show what MCP tools would be available
    // without actually starting the servers (that happens in sessions)
    const mcpServers = this.getMCPServers();
    if (Object.keys(mcpServers).length > 0) {
      const { MCPServerManager } = await import('~/mcp/server-manager');
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
  async addMCPServer(serverId: string, serverConfig: MCPServerConfig): Promise<void> {
    // Check for duplicates
    const existingServers = this.getMCPServers();
    if (existingServers[serverId]) {
      throw new Error(`MCP server '${serverId}' already exists in project`);
    }

    // Start async tool discovery (non-blocking)
    await ToolCatalog.discoverAndCacheTools(serverId, serverConfig, this.getWorkingDirectory());

    // Notify sessions immediately
    this.notifySessionsMCPChange(serverId, 'created', serverConfig);
  }

  /**
   * Update existing MCP server configuration
   */
  updateMCPServer(serverId: string, serverConfig: MCPServerConfig): void {
    MCPConfigLoader.updateServerConfig(serverId, serverConfig, this.getWorkingDirectory());
    this.notifySessionsMCPChange(serverId, 'updated', serverConfig);
  }

  /**
   * Remove MCP server from project configuration
   */
  deleteMCPServer(serverId: string): void {
    MCPConfigLoader.deleteServerConfig(serverId, this.getWorkingDirectory());
    this.notifySessionsMCPChange(serverId, 'deleted');
  }

  private notifySessionsMCPChange(
    serverId: string,
    action: 'created' | 'updated' | 'deleted',
    serverConfig?: MCPServerConfig
  ): void {
    // Get session data and look up actual Session instances
    const sessionDataList = this.getSessions();

    sessionDataList.forEach((sessionData) => {
      const session = Session.getByIdSync(sessionData.id as ThreadId);
      if (session) {
        session.announceMCPConfigChange(serverId, action, serverConfig);
      } else {
        logger.warn(
          `Session ${sessionData.id} not found in registry for MCP config change notification`
        );
      }
    });
  }

  private static generateNameFromDirectory(workingDirectory: string): string {
    const cleanPath = workingDirectory.replace(/[/\\]+$/, '');
    const dirName = basename(cleanPath);
    return dirName || 'root';
  }
}
