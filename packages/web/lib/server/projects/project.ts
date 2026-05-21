// ABOUTME: Web-owned Project class for managing projects, env vars, and MCP config
// ABOUTME: Persists to LACE_WEB_DIR/projects.json (backward incompatible with agent projects)

import { randomUUID } from 'crypto';
import { basename } from 'path';
import { accessSync, constants, existsSync, statSync } from 'fs';
import type { MCPServerConfig } from '@lace/web/types/core';
import { normalizeMcpServerConfig } from '@lace/web/lib/server/mcp-config-normalization';
import { ProjectStore, type ProjectRecord } from './project-store';

type ProjectData = {
  id: string;
  name: string;
  description: string;
  workingDirectory: string;
  configuration: Record<string, unknown>;
  environmentVariables: Record<string, string>;
  environmentEncryptedKeys: Set<string>;
  mcpServers: Record<string, MCPServerConfig>;
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
    environmentVariables: record.environmentVariables ?? {},
    environmentEncryptedKeys: new Set(record.environmentEncryptedKeys ?? []),
    mcpServers: (record.mcpServers ?? {}) as Record<string, MCPServerConfig>,
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
    environmentVariables: data.environmentVariables ?? {},
    environmentEncryptedKeys: [...(data.environmentEncryptedKeys ?? new Set())],
    mcpServers: data.mcpServers ?? {},
    isArchived: data.isArchived,
    createdAt: data.createdAt.toISOString(),
    lastUsedAt: data.lastUsedAt.toISOString(),
  };
}

function assertValidWorkingDirectory(workingDirectory: string): void {
  if (!workingDirectory || workingDirectory.trim() === '') {
    throw new Error(
      'Project workingDirectory cannot be empty. This usually means tempDir was accessed before beforeEach ran.'
    );
  }

  if (!existsSync(workingDirectory)) {
    throw new Error(
      `Project workingDirectory does not exist: ${workingDirectory}. ` +
        'In tests, use a temp directory from setupWebTest().'
    );
  }

  const stats = statSync(workingDirectory);
  if (!stats.isDirectory()) {
    throw new Error(`Project workingDirectory is not a directory: ${workingDirectory}`);
  }

  try {
    accessSync(workingDirectory, constants.W_OK);
  } catch {
    throw new Error(`Project workingDirectory is not writable: ${workingDirectory}`);
  }
}

function isValidEnvironmentVariableName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

function encryptValue(value: string): string {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  return `encrypted:${encoded}`;
}

function decryptValue(value: string): string {
  if (!value.startsWith('encrypted:')) return value;
  const encoded = value.substring('encrypted:'.length);
  return Buffer.from(encoded, 'base64').toString('utf8');
}

export class Project {
  private readonly id: string;
  private data: ProjectData;

  constructor(projectData: ProjectData) {
    this.id = projectData.id;
    this.data = projectData;
  }

  static create(
    name: string,
    workingDirectory: string,
    description = '',
    configuration: Record<string, unknown> = {}
  ): Project {
    assertValidWorkingDirectory(workingDirectory);

    const projectName = name.trim() || Project.generateNameFromDirectory(workingDirectory);

    const projectData: ProjectData = {
      id: randomUUID(),
      name: projectName,
      description,
      workingDirectory,
      configuration,
      environmentVariables: {},
      environmentEncryptedKeys: new Set<string>(),
      mcpServers: {},
      isArchived: false,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    };

    const store = new ProjectStore();
    store.upsert(projectRecordFromData(projectData));

    return new Project(projectData);
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
    return this.id;
  }

  getInfo(): ProjectInfo {
    return {
      id: this.data.id,
      name: this.data.name,
      description: this.data.description,
      workingDirectory: this.data.workingDirectory,
      isArchived: this.data.isArchived,
      createdAt: this.data.createdAt,
      lastUsedAt: this.data.lastUsedAt,
    };
  }

  getName(): string {
    return this.data.name;
  }

  getWorkingDirectory(): string {
    return this.data.workingDirectory;
  }

  getConfiguration(): Record<string, unknown> {
    return this.data.configuration || {};
  }

  updateInfo(updates: {
    name?: string;
    description?: string;
    workingDirectory?: string;
    configuration?: Record<string, unknown>;
    isArchived?: boolean;
  }): void {
    const updatesWithTimestamp = {
      ...updates,
      lastUsedAt: new Date(),
    };

    if (updatesWithTimestamp.workingDirectory) {
      assertValidWorkingDirectory(updatesWithTimestamp.workingDirectory);
    }

    this.data = {
      ...this.data,
      ...updatesWithTimestamp,
    };

    const store = new ProjectStore();
    store.upsert(projectRecordFromData(this.data));
  }

  updateConfiguration(updates: Record<string, unknown>): void {
    const currentConfig = this.getConfiguration();
    this.updateInfo({ configuration: { ...currentConfig, ...updates } });
  }

  archive(): void {
    this.updateInfo({ isArchived: true });
  }

  unarchive(): void {
    this.updateInfo({ isArchived: false });
  }

  delete(): void {
    const store = new ProjectStore();
    store.delete(this.id);
  }

  // Environment variables (web-owned)
  setEnvironmentVariables(
    variables: Record<string, string>,
    options?: { encrypt?: string[] }
  ): void {
    for (const key of Object.keys(variables)) {
      if (!isValidEnvironmentVariableName(key)) {
        throw new Error(`Invalid environment variable name: ${key}`);
      }
    }

    const encryptedKeys = new Set<string>();
    const processed: Record<string, string> = { ...variables };

    if (options?.encrypt) {
      for (const key of options.encrypt) {
        if (key in processed) {
          processed[key] = encryptValue(processed[key]);
          encryptedKeys.add(key);
        }
      }
    }

    this.data = {
      ...this.data,
      environmentVariables: processed,
      environmentEncryptedKeys: encryptedKeys,
      lastUsedAt: new Date(),
    };

    const store = new ProjectStore();
    store.upsert(projectRecordFromData(this.data));
  }

  getEnvironmentVariables(): Record<string, string> {
    const encryptedKeys = this.data.environmentEncryptedKeys ?? new Set<string>();
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(this.data.environmentVariables ?? {})) {
      result[key] = encryptedKeys.has(key) ? decryptValue(value) : value;
    }

    return result;
  }

  deleteEnvironmentVariable(key: string): void {
    const current = { ...(this.data.environmentVariables ?? {}) };
    delete current[key];

    const encryptedKeys = new Set(this.data.environmentEncryptedKeys ?? new Set<string>());
    encryptedKeys.delete(key);

    this.data = {
      ...this.data,
      environmentVariables: current,
      environmentEncryptedKeys: encryptedKeys,
      lastUsedAt: new Date(),
    };

    const store = new ProjectStore();
    store.upsert(projectRecordFromData(this.data));
  }

  // MCP servers (web-owned per-project config)
  getMCPServers(): Record<string, MCPServerConfig> {
    return this.data.mcpServers ?? {};
  }

  getMCPServer(serverId: string): MCPServerConfig | null {
    const servers = this.getMCPServers();
    return servers[serverId] || null;
  }

  addMCPServer(serverId: string, serverConfig: MCPServerConfig): void {
    const servers = this.getMCPServers();
    if (servers[serverId]) {
      throw new Error(`MCP server '${serverId}' already exists in project`);
    }
    const normalizedServerConfig = normalizeMcpServerConfig(serverConfig, 'project');
    this.data = {
      ...this.data,
      mcpServers: { ...servers, [serverId]: normalizedServerConfig },
      lastUsedAt: new Date(),
    };
    const store = new ProjectStore();
    store.upsert(projectRecordFromData(this.data));
  }

  updateMCPServer(serverId: string, serverConfig: MCPServerConfig): void {
    const servers = this.getMCPServers();
    if (!servers[serverId]) {
      throw new Error(`MCP server '${serverId}' not found in project`);
    }
    const normalizedServerConfig = normalizeMcpServerConfig(serverConfig, 'project');
    this.data = {
      ...this.data,
      mcpServers: { ...servers, [serverId]: normalizedServerConfig },
      lastUsedAt: new Date(),
    };
    const store = new ProjectStore();
    store.upsert(projectRecordFromData(this.data));
  }

  deleteMCPServer(serverId: string): void {
    const servers = { ...this.getMCPServers() };
    delete servers[serverId];
    this.data = { ...this.data, mcpServers: servers, lastUsedAt: new Date() };
    const store = new ProjectStore();
    store.upsert(projectRecordFromData(this.data));
  }

  private static generateNameFromDirectory(workingDirectory: string): string {
    const cleanPath = workingDirectory.replace(/[/\\]+$/, '');
    const dirName = basename(cleanPath);
    return dirName || 'root';
  }
}
