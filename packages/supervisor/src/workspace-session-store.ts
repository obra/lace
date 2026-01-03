import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type WorkspaceSessionRecord = {
  workspaceSessionId: string;
  workDir: string;
  sessionIds: string[];
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
      sessionIds: [],
      createdAt: now,
      lastUsedAt: now,
    };

    this.recordsById.set(workspaceSessionId, record);
    this.save();
    return record;
  }

  addSessionId(workspaceSessionId: string, sessionId: string): void {
    this.loadIfNeeded();

    const record = this.recordsById.get(workspaceSessionId);
    if (!record) {
      throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    }

    if (!record.sessionIds.includes(sessionId)) {
      record.sessionIds.push(sessionId);
    }

    record.lastUsedAt = new Date().toISOString();
    this.save();
  }

  touch(workspaceSessionId: string): void {
    this.loadIfNeeded();

    const record = this.recordsById.get(workspaceSessionId);
    if (!record) return;

    record.lastUsedAt = new Date().toISOString();
    this.save();
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
        'sessionIds' in item &&
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
