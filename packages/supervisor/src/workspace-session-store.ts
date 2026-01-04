import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type WorkspaceSessionRecord = {
  workspaceSessionId: string;
  workDir: string;
  projectId?: string;
  name?: string;
  agents: Array<{
    sessionId: string;
    name?: string;
    connectionId?: string;
    modelId?: string;
    createdAt: string;
    lastUsedAt: string;
  }>;
  createdAt: string;
  lastUsedAt: string;
};

export class WorkspaceSessionStore {
  private readonly filePath: string;
  private loaded = false;
  private readonly recordsById = new Map<string, WorkspaceSessionRecord>();

  constructor(laceDir: string) {
    this.filePath = join(laceDir, 'supervisor', 'workspace-sessions.json');
  }

  createWorkspaceSessionId(): string {
    return `ws_${randomUUID()}`;
  }

  list(): WorkspaceSessionRecord[] {
    this.loadIfNeeded();
    return Array.from(this.recordsById.values());
  }

  get(workspaceSessionId: string): WorkspaceSessionRecord | undefined {
    this.loadIfNeeded();
    return this.recordsById.get(workspaceSessionId);
  }

  create(workspaceSessionId: string, workDir: string): WorkspaceSessionRecord {
    this.loadIfNeeded();

    const now = new Date().toISOString();
    const record: WorkspaceSessionRecord = {
      workspaceSessionId,
      workDir,
      agents: [],
      createdAt: now,
      lastUsedAt: now,
    };

    this.recordsById.set(workspaceSessionId, record);
    this.save();
    return record;
  }

  update(
    workspaceSessionId: string,
    updates: Partial<Pick<WorkspaceSessionRecord, 'projectId' | 'name'>>
  ): void {
    this.loadIfNeeded();

    const record = this.recordsById.get(workspaceSessionId);
    if (!record) {
      throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    }

    if (typeof updates.projectId === 'string') record.projectId = updates.projectId;
    if (typeof updates.name === 'string') record.name = updates.name;

    record.lastUsedAt = new Date().toISOString();
    this.save();
  }

  upsertAgent(
    workspaceSessionId: string,
    params: {
      sessionId: string;
      name?: string;
      connectionId?: string;
      modelId?: string;
    }
  ): void {
    this.loadIfNeeded();

    const record = this.recordsById.get(workspaceSessionId);
    if (!record) {
      throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    }

    const now = new Date().toISOString();
    const existing = record.agents.find((a) => a.sessionId === params.sessionId);

    if (existing) {
      if (typeof params.name === 'string') existing.name = params.name;
      if (typeof params.connectionId === 'string') existing.connectionId = params.connectionId;
      if (typeof params.modelId === 'string') existing.modelId = params.modelId;
      existing.lastUsedAt = now;
    } else {
      record.agents.push({
        sessionId: params.sessionId,
        ...(typeof params.name === 'string' ? { name: params.name } : {}),
        ...(typeof params.connectionId === 'string' ? { connectionId: params.connectionId } : {}),
        ...(typeof params.modelId === 'string' ? { modelId: params.modelId } : {}),
        createdAt: now,
        lastUsedAt: now,
      });
    }

    record.lastUsedAt = now;
    this.save();
  }

  touch(workspaceSessionId: string): void {
    this.loadIfNeeded();

    const record = this.recordsById.get(workspaceSessionId);
    if (!record) return;

    record.lastUsedAt = new Date().toISOString();
    this.save();
  }

  delete(workspaceSessionId: string): boolean {
    this.loadIfNeeded();
    const existed = this.recordsById.delete(workspaceSessionId);
    if (existed) this.save();
    return existed;
  }

  private loadIfNeeded(): void {
    if (this.loaded) return;
    this.loaded = true;

    if (!existsSync(this.filePath)) return;

    const raw = readFileSync(this.filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error(`Invalid supervisor workspace session store format: ${this.filePath}`);
    }

    for (const item of parsed) {
      if (
        typeof item === 'object' &&
        item !== null &&
        'workspaceSessionId' in item &&
        'workDir' in item &&
        'agents' in item &&
        'createdAt' in item &&
        'lastUsedAt' in item
      ) {
        const record = item as WorkspaceSessionRecord;
        this.recordsById.set(record.workspaceSessionId, record);
      }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.list(), null, 2), 'utf8');
  }
}
