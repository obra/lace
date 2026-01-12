import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteJson } from './atomic-write';

export type CheckpointMeta = {
  checkpointId: string;
  created: string;
  eventSeq: number;
  label?: string;
  files: string[];
};

function checkpointsDir(sessionDir: string): string {
  const dir = path.join(sessionDir, 'checkpoints');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function checkpointDir(sessionDir: string, checkpointId: string): string {
  const dir = path.join(checkpointsDir(sessionDir), checkpointId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function checkpointFilesDir(sessionDir: string, checkpointId: string): string {
  const dir = path.join(checkpointDir(sessionDir, checkpointId), 'files');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function checkpointMetaPath(sessionDir: string, checkpointId: string): string {
  return path.join(checkpointDir(sessionDir, checkpointId), 'meta.json');
}

function safeRelativePath(workDir: string, absolutePath: string): string | null {
  const rel = path.relative(workDir, absolutePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel;
}

export function writeCheckpoint(
  sessionDir: string,
  options: {
    workDir: string;
    checkpointId: string;
    eventSeq: number;
    label?: string;
    files: Set<string>;
  }
): CheckpointMeta {
  const created = new Date().toISOString();
  const destFilesDir = checkpointFilesDir(sessionDir, options.checkpointId);

  const files: string[] = [];
  for (const absolute of options.files) {
    const rel = safeRelativePath(options.workDir, absolute);
    if (!rel) continue;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolute);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    const destPath = path.join(destFilesDir, rel);
    fs.mkdirSync(path.dirname(destPath), { recursive: true, mode: 0o700 });
    fs.copyFileSync(absolute, destPath);
    files.push(rel);
  }

  const meta: CheckpointMeta = {
    checkpointId: options.checkpointId,
    created,
    eventSeq: options.eventSeq,
    ...(options.label ? { label: options.label } : {}),
    files: files.sort(),
  };

  atomicWriteJson(checkpointMetaPath(sessionDir, options.checkpointId), meta, { mode: 0o600 });

  return meta;
}

export function readCheckpointMeta(sessionDir: string, checkpointId: string): CheckpointMeta {
  return JSON.parse(
    fs.readFileSync(checkpointMetaPath(sessionDir, checkpointId), 'utf8')
  ) as CheckpointMeta;
}

export function findCheckpointByEventSeq(
  sessionDir: string,
  eventSeq: number
): CheckpointMeta | null {
  const dir = checkpointsDir(sessionDir);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const meta = readCheckpointMeta(sessionDir, entry.name);
      if (meta.eventSeq === eventSeq) return meta;
    } catch {
      // ignore
    }
  }
  return null;
}

export function restoreCheckpointFiles(
  sessionDir: string,
  options: { workDir: string; checkpointId: string }
): { filesRestored: string[] } {
  const meta = readCheckpointMeta(sessionDir, options.checkpointId);
  const srcFilesDir = checkpointFilesDir(sessionDir, options.checkpointId);

  for (const rel of meta.files) {
    const srcPath = path.join(srcFilesDir, rel);
    const destPath = path.join(options.workDir, rel);
    fs.mkdirSync(path.dirname(destPath), { recursive: true, mode: 0o700 });
    fs.copyFileSync(srcPath, destPath);
  }

  return { filesRestored: meta.files };
}
