import { readFileSync } from 'node:fs';
import { isAbsolute as isAbsolutePath, join, resolve as resolvePath } from 'node:path';

type ToolUseEvent = {
  type?: string;
  data?: {
    name?: string;
    input?: { path?: unknown };
    result?: { outcome?: string };
  };
};

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function absolutePath(workDir: string, raw: string): string {
  return isAbsolutePath(raw) ? raw : resolvePath(workDir, raw);
}

export function deriveFilesReadFromDurableEvents(sessionDir: string, workDir: string): Set<string> {
  const eventsPath = join(sessionDir, 'events.jsonl');
  let raw = '';
  try {
    raw = readFileSync(eventsPath, 'utf8');
  } catch {
    return new Set();
  }

  const read = new Set<string>();
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as ToolUseEvent;
      if (parsed.type !== 'tool_use') continue;
      if (parsed.data?.name !== 'file_read') continue;
      if (parsed.data?.result?.outcome !== 'completed') continue;
      const p = toNonEmptyString(parsed.data?.input?.path);
      if (!p) continue;
      read.add(absolutePath(workDir, p));
    } catch {
      // ignore malformed lines
    }
  }

  return read;
}

export function deriveFilesWrittenFromDurableEvents(
  sessionDir: string,
  workDir: string
): Set<string> {
  const eventsPath = join(sessionDir, 'events.jsonl');
  let raw = '';
  try {
    raw = readFileSync(eventsPath, 'utf8');
  } catch {
    return new Set();
  }

  const written = new Set<string>();
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as ToolUseEvent;
      if (parsed.type !== 'tool_use') continue;
      const name = parsed.data?.name;
      if (name !== 'file_write' && name !== 'file_edit') continue;
      if (parsed.data?.result?.outcome !== 'completed') continue;
      const p = toNonEmptyString(parsed.data?.input?.path);
      if (!p) continue;
      written.add(absolutePath(workDir, p));
    } catch {
      // ignore malformed lines
    }
  }

  return written;
}

export function deriveCheckpointFilesFromDurableEvents(
  sessionDir: string,
  workDir: string
): Set<string> {
  const files = new Set<string>();
  for (const p of deriveFilesReadFromDurableEvents(sessionDir, workDir)) files.add(p);
  for (const p of deriveFilesWrittenFromDurableEvents(sessionDir, workDir)) files.add(p);
  return files;
}
