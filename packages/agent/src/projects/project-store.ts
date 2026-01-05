// ABOUTME: File-backed project registry stored in LACE_DIR/projects.json
// ABOUTME: Replaces SQLite-backed project persistence for web/supervisor runtime

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { z } from 'zod';
import { getLaceDir } from '@lace/agent/config/lace-dir';

const ProjectRecordSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    workingDirectory: z.string().min(1),
    configuration: z.record(z.unknown()),
    isArchived: z.boolean(),
    createdAt: z.string().min(1),
    lastUsedAt: z.string().min(1),
  })
  .strict();

const ProjectStoreSchema = z.array(ProjectRecordSchema);

export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

export class ProjectStore {
  private readonly filePath: string;

  constructor() {
    this.filePath = join(getLaceDir(), 'projects.json');
  }

  loadAll(): ProjectRecord[] {
    if (!existsSync(this.filePath)) return [];
    const raw = readFileSync(this.filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const result = ProjectStoreSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid projects store format: ${this.filePath}`);
    }
    return result.data;
  }

  load(id: string): ProjectRecord | null {
    return this.loadAll().find((p) => p.id === id) ?? null;
  }

  upsert(record: ProjectRecord): void {
    const next = this.loadAll();
    const idx = next.findIndex((p) => p.id === record.id);
    if (idx >= 0) next[idx] = record;
    else next.push(record);
    this.saveAll(next);
  }

  delete(id: string): void {
    const next = this.loadAll().filter((p) => p.id !== id);
    this.saveAll(next);
  }

  private saveAll(records: ProjectRecord[]): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });

    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(records, null, 2), { mode: 0o600 });
    renameSync(tempPath, this.filePath);
  }
}
