// ABOUTME: Project class for managing AI coding projects with working directories and configurations
// ABOUTME: Provides high-level interface for project CRUD operations and session management

import { randomUUID } from 'crypto';
import { basename } from 'path';
import { getPersistence, ProjectData, SessionData } from '~/persistence/database';
import { logger } from '~/utils/logger';
import { ThreadManager } from '~/threads/thread-manager';
import type { SessionConfiguration } from '~/sessions/session-config';
import { Session } from '~/sessions/session';
import { PromptTemplateManager, PromptTemplate } from '~/projects/prompt-templates';
import { ProjectEnvironmentManager } from '~/projects/environment-variables';
import { TokenBudgetManager } from '~/token-management/token-budget-manager';

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
  private _promptTemplateManager: PromptTemplateManager;
  private _environmentManager: ProjectEnvironmentManager;
  private _tokenBudgetManager: TokenBudgetManager | null = null;

  constructor(projectId: string) {
    this._id = projectId;
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
    const project = new Project(projectData.id);

    // Automatically create a default session with coordinator agent for the new project
    const sessionOptions: {
      name: string;
      projectId: string;
      provider?: string;
      model?: string;
    } = {
      name: `Session ${new Date().toLocaleString()}`,
      projectId: projectData.id,
    };

    // Let Session.create() handle provider/model defaults unless overridden
    if (configuration.provider) {
      sessionOptions.provider = configuration.provider as string;
    }
    if (configuration.model) {
      sessionOptions.model = configuration.model as string;
    }

    const session = Session.create(sessionOptions);

    logger.info('Default session with coordinator agent created for new project', {
      projectId: projectData.id,
      sessionId: session.getId(),
    });

    return project;
  }

  static getAll(): ProjectInfo[] {
    const persistence = getPersistence();
    const projects = persistence.loadAllProjects();

    return projects.map((project) => {
      // Create a temporary Project instance to get session count
      const projectInstance = new Project(project.id);
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

    return new Project(projectId);
  }

  getId(): string {
    return this._id;
  }

  getInfo(): ProjectInfo | null {
    const persistence = getPersistence();
    const projectData = persistence.loadProject(this._id);

    if (!projectData) {
      return null;
    }

    return {
      id: projectData.id,
      name: projectData.name,
      description: projectData.description,
      workingDirectory: projectData.workingDirectory,
      isArchived: projectData.isArchived,
      createdAt: projectData.createdAt,
      lastUsedAt: projectData.lastUsedAt,
      sessionCount: this.getSessionCount(),
    };
  }

  getName(): string {
    const info = this.getInfo();
    return info?.name || 'Unknown Project';
  }

  getWorkingDirectory(): string {
    const info = this.getInfo();
    return info?.workingDirectory || process.cwd();
  }

  getConfiguration(): Record<string, unknown> {
    const persistence = getPersistence();
    const projectData = persistence.loadProject(this._id);
    // Don't close the global persistence - it's managed by the persistence system

    return projectData?.configuration || {};
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
    // Don't close the global persistence - it's managed by the persistence system

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

  getTokenBudgetManager(): TokenBudgetManager | null {
    return this._tokenBudgetManager;
  }

  setTokenBudgetManager(manager: TokenBudgetManager | null): void {
    this._tokenBudgetManager = manager;
  }

  createTokenBudgetManager(config: {
    maxTokens: number;
    warningThreshold?: number;
    reserveTokens?: number;
  }): TokenBudgetManager {
    const manager = new TokenBudgetManager({
      maxTokens: config.maxTokens,
      warningThreshold: config.warningThreshold || 0.8,
      reserveTokens: config.reserveTokens || 0,
    });
    this._tokenBudgetManager = manager;
    return manager;
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

  private static generateNameFromDirectory(workingDirectory: string): string {
    const cleanPath = workingDirectory.replace(/[/\\]+$/, '');
    const dirName = basename(cleanPath);
    return dirName || 'root';
  }
}
