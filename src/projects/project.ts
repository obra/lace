// ABOUTME: Project class for managing AI coding projects with working directories and configurations
// ABOUTME: Provides high-level interface for project CRUD operations and session management

import { randomUUID } from 'crypto';
import { basename } from 'path';
import { getPersistence, ProjectData, SessionData } from '~/persistence/database';
import { logger } from '~/utils/logger';
import { Session } from '~/sessions/session';
import { ThreadManager } from '~/threads/thread-manager';
import type { SessionConfiguration } from '~/sessions/session-config';
import { PromptTemplateManager, PromptTemplate } from '~/projects/prompt-templates';
import { ProjectEnvironmentManager } from '~/projects/environment-variables';
import { getProcessTempDir } from '~/config/lace-dir';
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
  private _id: string;
  private _projectData: ProjectData; // 👈 NEW: Cache the project data
  private _promptTemplateManager: PromptTemplateManager;
  private _environmentManager: ProjectEnvironmentManager;

  constructor(projectData: ProjectData) {
    this._id = projectData.id;
    this._projectData = projectData; // 👈 NEW: Store the data
    this._promptTemplateManager = new PromptTemplateManager();
    this._environmentManager = new ProjectEnvironmentManager();
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

    // Auto-create a default session (no provider info needed at session level)
    try {
      Session.create({
        name: 'Main Session',
        description: 'Default session for project',
        projectId: projectData.id,
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
  getPromptTemplateManager(): PromptTemplateManager {
    return this._promptTemplateManager;
  }

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

  // Prompt Templates Management
  savePromptTemplate(template: PromptTemplate): void {
    this._promptTemplateManager.saveTemplate(template);
  }

  createPromptTemplate(config: {
    id: string;
    name: string;
    description?: string;
    content: string;
    variables?: string[];
    parentTemplateId?: string;
    isDefault?: boolean;
  }): PromptTemplate {
    const template = new PromptTemplate({
      ...config,
      description: config.description || '',
      variables: config.variables || [],
      projectId: this._id,
    });
    this._promptTemplateManager.saveTemplate(template);
    return template;
  }

  getPromptTemplate(templateId: string): PromptTemplate | undefined {
    return this._promptTemplateManager.getTemplate(this._id, templateId);
  }

  getAllPromptTemplates(): PromptTemplate[] {
    return this._promptTemplateManager.getTemplatesForProject(this._id);
  }

  renderPromptTemplate(templateId: string, variables: Record<string, string>): string {
    return this._promptTemplateManager.renderTemplate(this._id, templateId, variables);
  }

  deletePromptTemplate(templateId: string): boolean {
    return this._promptTemplateManager.deleteTemplate(this._id, templateId);
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

  private static generateNameFromDirectory(workingDirectory: string): string {
    const cleanPath = workingDirectory.replace(/[/\\]+$/, '');
    const dirName = basename(cleanPath);
    return dirName || 'root';
  }
}
