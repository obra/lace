// ABOUTME: File-backed project registry stored in LACE_WEB_DIR/projects.json
// ABOUTME: Web-owned project persistence (not shared with the agent)

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { z } from 'zod';
import { getLaceWebDir } from '@lace/web/lib/server/web-data-dir';

const McpServerConfigSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),
    tools: z.record(z.string(), z.enum(['allow', 'ask', 'deny', 'disable'])).optional(),
  })
  .strict();

const ProjectRecordSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    workingDirectory: z.string().min(1),
    configuration: z.record(z.unknown()),
    environmentVariables: z.record(z.string()).optional(),
    environmentEncryptedKeys: z.array(z.string()).optional(),
    mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
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
    this.filePath = join(getLaceWebDir(), 'projects.json');
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
