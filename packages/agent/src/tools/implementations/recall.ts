// ABOUTME: The `recall` built-in tool — episodic memory search and read
// ABOUTME: Two actions: search (FTS over transcripts) and read (expand a hit with context)

import { z } from 'zod';
import { Tool } from '../tool';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';
import { getRecallIndex } from '../../storage/recall/index-db';
import { redact } from '../../storage/recall/redact';
import { eventToRow, type RecallRow } from '../../storage/recall/event-to-row';
import { readAllSessionEventLines } from '../../storage/event-log';
import { getSessionDir, readSessionMeta } from '../../storage/session-store';
import type { TypedDurableEvent } from '../../storage/event-types';

// Flat schema with an `action` enum discriminator. Per-action required-field
// checks happen at runtime in executeValidated. The flat shape is required
// because lace's tool-catalog JSON-Schema conversion (Tool#inputSchema) only
// accepts an object-typed top-level schema; a zod discriminatedUnion compiles
// to an anyOf and is rejected at "Invalid schema structure for tool recall".
const recallSchema = z.object({
  action: z.enum(['search', 'read']),
  // search fields
  query: z.string().min(1).optional(),
  persona: z.union([z.string(), z.array(z.string())]).optional(),
  session_id: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
  // read fields
  event_id: z.string().min(1).optional(),
  context: z.number().int().nonnegative().max(50).optional(),
  full: z.boolean().optional(),
});

export type RecallInput = z.infer<typeof recallSchema>;
export type RecallSearchInput = RecallInput & { action: 'search'; query: string };
export type RecallReadInput = RecallInput & { action: 'read'; event_id: string };

const RECALL_DESCRIPTION = [
  'Search your own past lace session transcripts — your episodic memory.',
  'Lexical search returns short previews of matching events; use `read` to expand any hit',
  'into surrounding context. This is a record of what happened, not the current state of the',
  'world; re-check live for facts that can change.',
  '',
  'Actions: `search`, `read`.',
].join('\n');

// Truncation caps, calibrated for a 200k-token main context per spec §Truncation.
const BASE_CONTENT_CAP = 10_000;
const CONTEXT_TOOL_CALL_CAP = 500;

type SearchHitRow = {
  event_id: string;
  session_id: string;
  ts: string;
  persona: string | null;
  kind: string;
  preview: string;
};

export class RecallTool extends Tool {
  name = 'recall';
  description = RECALL_DESCRIPTION;
  schema = recallSchema;
  annotations: ToolAnnotations = {
    title: 'Recall past session events',
    safeInternal: true,
    readOnlySafe: true,
  };

  protected async executeValidated(args: RecallInput, context: ToolContext): Promise<ToolResult> {
    if (args.action === 'search') {
      if (args.query === undefined) {
        return this.createResult({
          error: '`search` action requires a `query` field (non-empty string).',
        });
      }
      return this.search({ ...args, action: 'search', query: args.query }, context);
    }
    if (args.event_id === undefined) {
      return this.createResult({
        error: '`read` action requires an `event_id` field (format `<session_id>:<eventSeq>`).',
      });
    }
    return this.read({ ...args, action: 'read', event_id: args.event_id }, context);
  }

  private async search(args: RecallSearchInput, _context: ToolContext): Promise<ToolResult> {
    const db = getRecallIndex();

    const where: string[] = ['content MATCH ?'];
    const params: unknown[] = [args.query];

    if (args.persona !== undefined) {
      const personas = Array.isArray(args.persona) ? args.persona : [args.persona];
      // Empty array would produce invalid SQL — treat as "no persona filter"
      if (personas.length > 0) {
        where.push(`persona IN (${personas.map(() => '?').join(',')})`);
        params.push(...personas);
      }
    }
    if (args.session_id !== undefined) {
      where.push('session_id = ?');
      params.push(args.session_id);
    }
    if (args.since !== undefined) {
      where.push('ts >= ?');
      params.push(args.since);
    }
    if (args.until !== undefined) {
      where.push('ts <= ?');
      params.push(args.until);
    }

    const limit = args.limit ?? 10;
    const sql =
      `SELECT event_id, session_id, ts, persona, kind, ` +
      `snippet(events, 5, '', '', '...', 32) AS preview ` +
      `FROM events WHERE ${where.join(' AND ')} ORDER BY rank LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as SearchHitRow[];
    const hits = rows.map((r) => ({ ...r, preview: redact(r.preview) }));

    if (hits.length === 0) {
      const personaPart =
        args.persona !== undefined ? ` (persona=${JSON.stringify(args.persona)})` : '';
      return this.createResult({
        hits: [],
        hint: `0 hits for query=${JSON.stringify(args.query)}${personaPart}. Try: drop the persona filter, widen the time range, or check spelling.`,
      });
    }

    return this.createResult({ hits });
  }

  private async read(args: RecallReadInput, _context: ToolContext): Promise<ToolResult> {
    const match = /^([^:]+):(\d+)$/.exec(args.event_id);
    if (!match) {
      return this.createResult({
        error: `event_id ${JSON.stringify(args.event_id)} malformed; expected <session_id>:<eventSeq>`,
      });
    }
    const sessionId = match[1];
    const targetSeq = parseInt(match[2], 10);
    const context = args.context ?? 5;
    const full = args.full ?? false;
    const lowSeq = Math.max(1, targetSeq - context);
    const highSeq = targetSeq + context;

    // Read events from the JSONL transcripts (FTS is for search; sequential
    // range reads go to disk via the dual-layout reader). The session id maps
    // to its legacy <laceDir>/agent-sessions/<sessionId> directory, which is
    // also where meta.json lives — readAllSessionEventLines handles both
    // legacy and new-layout files.
    const sessionDir = getSessionDir(sessionId);
    let lines: string[];
    try {
      lines = readAllSessionEventLines(sessionDir);
    } catch {
      lines = [];
    }

    const inRange: TypedDurableEvent[] = [];
    let totalForSession = 0;
    for (const line of lines) {
      let ev: TypedDurableEvent;
      try {
        ev = JSON.parse(line) as TypedDurableEvent;
      } catch {
        continue;
      }
      if (typeof ev.eventSeq !== 'number') continue;
      totalForSession++;
      if (ev.eventSeq < lowSeq || ev.eventSeq > highSeq) continue;
      inRange.push(ev);
    }

    if (inRange.length === 0) {
      return this.createResult({
        error: `event_id ${JSON.stringify(args.event_id)} not found.`,
        hint:
          totalForSession > 0
            ? `Session ${sessionId} has ${totalForSession} events.`
            : `No events found for session ${sessionId}.`,
      });
    }

    // Persona comes from meta.json; one read per request, no caching needed.
    const persona = readPersonaForSessionDir(sessionDir);

    inRange.sort((a, b) => a.eventSeq - b.eventSeq);

    const events = inRange.map((ev) => {
      const row = eventToRow(ev, { sessionId, persona });
      if (!row) {
        // Non-indexable event inside the requested window (turn_start, job_*,
        // permission_*, etc.) — surface it minimally so the agent sees the
        // boundary without crashing.
        return {
          event_id: `${sessionId}:${ev.eventSeq}`,
          session_id: sessionId,
          ts: ev.timestamp,
          persona,
          kind: ev.type,
          content: '',
        };
      }
      return applyTruncation(row, args.event_id, full);
    });

    return this.createResult({ events });
  }
}

function readPersonaForSessionDir(sessionDir: string): string | null {
  try {
    return readSessionMeta(sessionDir).persona ?? null;
  } catch {
    return null;
  }
}

function applyTruncation(
  row: RecallRow,
  targetEventId: string,
  full: boolean
): RecallRow & { content: string } {
  const isTarget = row.event_id === targetEventId;
  const isToolCall = row.kind === 'tool_call';
  let content = redact(row.content);
  // Spec §Truncation: target is always full (capped at 10k); context user/
  // assistant/notification events get the same 10k cap; context tool_calls
  // get a 500-char cap unless `full: true` is requested.
  const cap = full || isTarget || !isToolCall ? BASE_CONTENT_CAP : CONTEXT_TOOL_CALL_CAP;
  if (content.length > cap) {
    const overflow = content.length - cap;
    content = `${content.slice(0, cap)}... [truncated, ${overflow} more chars]`;
  }
  return { ...row, content };
}
