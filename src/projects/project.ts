// ABOUTME: Project class for managing AI coding projects with working directories and configurations
// ABOUTME: Provides high-level interface for project CRUD operations and session management

import { randomUUID } from 'crypto';
import { getPersistence, ProjectData } from '~/persistence/database';
import { logger } from '~/utils/logger';
import { Session } from '~/sessions/session';

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

  constructor(projectId: string) {
    this._id = projectId;
  }

  static create(
    name: string,
    workingDirectory: string,
    description = '',
    configuration: Record<string, unknown> = {}
  ): Project {
    const persistence = getPersistence();

    const projectData: ProjectData = {
      id: randomUUID(),
      name,
      description,
      workingDirectory,
      configuration,
      isArchived: false,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    };

    persistence.saveProject(projectData);
    persistence.close();

    logger.info('Project created', { projectId: projectData.id, name, workingDirectory });
    return new Project(projectData.id, actualDbPath);
  }

  static getAll(dbPath?: string): ProjectInfo[] {
    const persistence = new DatabasePersistence(dbPath || getLaceDbPath());
    const projects = persistence.loadAllProjects();
    persistence.close();

    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      workingDirectory: project.workingDirectory,
      isArchived: project.isArchived,
      createdAt: project.createdAt,
      lastUsedAt: project.lastUsedAt,
      // TODO: Add session count when we implement session counting
      sessionCount: 0,
    }));
  }

  static getById(projectId: string, dbPath?: string): Project | null {
    const persistence = new DatabasePersistence(dbPath || getLaceDbPath());
    const projectData = persistence.loadProject(projectId);
    persistence.close();

    if (!projectData) {
      return null;
    }

    return new Project(projectId, dbPath);
  }

  getId(): string {
    return this._id;
  }

  getInfo(): ProjectInfo | null {
    const persistence = new DatabasePersistence(this._dbPath);
    const projectData = persistence.loadProject(this._id);
    persistence.close();

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
      // TODO: Add session count when we implement session counting
      sessionCount: 0,
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
    const persistence = new DatabasePersistence(this._dbPath);
    const projectData = persistence.loadProject(this._id);
    persistence.close();

    return projectData?.configuration || {};
  }

  updateInfo(updates: {
    name?: string;
    description?: string;
    workingDirectory?: string;
    configuration?: Record<string, unknown>;
    isArchived?: boolean;
  }): void {
    const persistence = new DatabasePersistence(this._dbPath);

    // Always update lastUsedAt when project is modified
    const updatesWithTimestamp = {
      ...updates,
      lastUsedAt: new Date(),
    };

    persistence.updateProject(this._id, updatesWithTimestamp);
    persistence.close();

    logger.info('Project updated', { projectId: this._id, updates });
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
    const persistence = new DatabasePersistence(this._dbPath);

    // Delete all sessions in this project first using Session class
    const sessionData = persistence.loadSessionsByProject(this._id);
    for (const sessionInfo of sessionData) {
      const session = Session.getById(sessionInfo.id as any, this._dbPath);
      if (session) {
        session.destroy();
      }
    }

    // Then delete the project
    persistence.deleteProject(this._id);
    persistence.close();

    logger.info('Project deleted', { projectId: this._id });
  }

  touchLastUsed(): void {
    this.updateInfo({ lastUsedAt: new Date() });
  }

  // TODO: Add methods for session management when Session class is updated
  // getSessions(): Session[]
  // createSession(name: string, configuration?: Record<string, unknown>): Session
  // getSessionCount(): number
}
