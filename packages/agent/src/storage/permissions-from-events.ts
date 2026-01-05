import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PendingPermissionRecord = {
  toolCallId: string;
  turnId: string;
  turnSeq: number;
  jobId?: string;
  tool: string;
  kind?: string;
  resource: string;
  options: Array<{ optionId: string; label: string }>;
  requestedAt: string;
  input: Record<string, unknown>;
};

type DurableEventLine = {
  type?: string;
  turnId?: unknown;
  turnSeq?: unknown;
  data?: Record<string, unknown>;
};

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function toOptions(value: unknown): Array<{ optionId: string; label: string }> | null {
  if (!Array.isArray(value)) return null;
  const parsed: Array<{ optionId: string; label: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const optionId = toNonEmptyString((item as any).optionId);
    const label = typeof (item as any).label === 'string' ? (item as any).label : null;
    if (!optionId || label === null) return null;
    parsed.push({ optionId, label });
  }
  return parsed;
}

export function derivePendingPermissionsFromDurableEvents(
  sessionDir: string
): PendingPermissionRecord[] {
  const eventsPath = join(sessionDir, 'events.jsonl');
  let raw = '';
  try {
    raw = readFileSync(eventsPath, 'utf8');
  } catch {
    return [];
  }

  const pendingByToolCallId = new Map<string, PendingPermissionRecord>();

  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as DurableEventLine;

      if (parsed.type === 'permission_requested') {
        const turnId = toNonEmptyString(parsed.turnId);
        const turnSeq = toFiniteNumber(parsed.data?.turnSeq);
        const toolCallId = toNonEmptyString(parsed.data?.toolCallId);
        const tool = toNonEmptyString(parsed.data?.tool);
        const resource = toNonEmptyString(parsed.data?.resource);
        const requestedAt = toNonEmptyString(parsed.data?.requestedAt);
        const options = toOptions(parsed.data?.options);
        const input =
          parsed.data?.input && typeof parsed.data.input === 'object'
            ? (parsed.data.input as Record<string, unknown>)
            : null;
        if (!turnId || turnSeq === null || !toolCallId || !tool || !resource || !requestedAt)
          continue;
        if (!options || !input) continue;

        const jobId = toNonEmptyString(parsed.data?.jobId) ?? undefined;
        const kind = toNonEmptyString(parsed.data?.kind) ?? undefined;

        pendingByToolCallId.set(toolCallId, {
          toolCallId,
          turnId,
          turnSeq,
          jobId,
          tool,
          kind,
          resource,
          options,
          requestedAt,
          input,
        });
        continue;
      }

      if (
        parsed.type === 'permission_decided' ||
        parsed.type === 'permission_cancelled' ||
        parsed.type === 'tool_use'
      ) {
        const toolCallId =
          parsed.type === 'tool_use'
            ? toNonEmptyString(parsed.data?.toolCallId)
            : toNonEmptyString(parsed.data?.toolCallId);

        if (toolCallId) pendingByToolCallId.delete(toolCallId);
      }
    } catch {
      // ignore malformed lines
    }
  }

  return [...pendingByToolCallId.values()];
}
