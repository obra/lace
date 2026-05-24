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
// Every string-typed input on this tool must reject the empty string. An empty
// string would silently bind to ' = ?' in SQL and match nothing (or — in the
// persona case — produce an `IN ('')` clause that suppresses real hits without
// signalling the bad input). The .min(1) blocks the model from constructing a
// filter that always returns zero hits while looking syntactically valid.
const personaElem = z.string().min(1, 'persona name must be non-empty');

const recallSchema = z.object({
  action: z.enum(['search', 'read']),
  // search fields
  query: z.string().min(1).optional(),
  persona: z.union([personaElem, z.array(personaElem)]).optional(),
  session_id: z.string().min(1, 'session_id must be non-empty').optional(),
  since: z.string().min(1, 'since must be non-empty').optional(),
  until: z.string().min(1, 'until must be non-empty').optional(),
  limit: z.number().int().positive().max(100).optional(),
  // 'relevance' (default) sorts by FTS rank; 'recent' sorts by timestamp DESC.
  // When you want the latest mentions of a term (rather than the most
  // textually-relevant), pass `order: 'recent'`.
  order: z.enum(['relevance', 'recent']).optional(),
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
  '',
  '`search.order` defaults to `relevance` (FTS rank). Pass `order: "recent"` when you want',
  'the most recent mentions of a term (e.g. "what\'s the last thing I said about compaction?").',
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
      return this.withErrorEnvelope('search', () =>
        this.search({ ...args, action: 'search', query: args.query as string }, context)
      );
    }
    if (args.event_id === undefined) {
      return this.createResult({
        error: '`read` action requires an `event_id` field (format `<session_id>:<eventSeq>`).',
      });
    }
    return this.withErrorEnvelope('read', () =>
      this.read({ ...args, action: 'read', event_id: args.event_id as string }, context)
    );
  }

  /**
   * Wraps a search/read implementation so any unexpected throw — SessionStorageError
   * from agentSessionsDir(), filesystem ENOENT escapes, SQLite SqliteError, etc. —
   * surfaces as the standard {error, ...} JSON envelope rather than escaping the
   * tool wrapper as raw "ValidationError: ..." text (spec §Failure modes A2).
   * Error messages are redacted because user-supplied strings (event_id, query)
   * may have been interpolated into them and could carry leaked secrets.
   */
  private async withErrorEnvelope(
    action: 'search' | 'read',
    fn: () => Promise<ToolResult>
  ): Promise<ToolResult> {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.createResult({
        error: redact(`${action}: ${message}`),
      });
    }
  }

  private async search(args: RecallSearchInput, _context: ToolContext): Promise<ToolResult> {
    const db = getRecallIndex();

    const where: string[] = ['content MATCH ?'];
    const params: unknown[] = [args.query];

    // Tracks what we ACTUALLY applied (after stripping empties / empty array).
    // The 0-hit hint reads this — not the raw input — so we never tell the
    // caller "I filtered by persona=X" when the filter was a no-op.
    let appliedPersonaFilter: string[] | null = null;
    if (args.persona !== undefined) {
      // Defense in depth: the zod schema already rejects empty-string elements,
      // but if a caller bypasses validation (or the schema rule regresses) an
      // empty `''` would bind into `persona IN ('')` and suppress real hits.
      // Strip empties here too so the SQL is always shaped from real values.
      const personas = (Array.isArray(args.persona) ? args.persona : [args.persona]).filter(
        (p) => p.length > 0
      );
      // Empty array would produce invalid SQL — treat as "no persona filter"
      if (personas.length > 0) {
        where.push(`persona IN (${personas.map(() => '?').join(',')})`);
        params.push(...personas);
        appliedPersonaFilter = personas;
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
    const order = args.order ?? 'relevance';
    const orderBy = order === 'recent' ? 'ts DESC' : 'rank';
    const sql =
      `SELECT event_id, session_id, ts, persona, kind, ` +
      `snippet(events, 5, '', '', '...', 32) AS preview ` +
      `FROM events WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ?`;
    params.push(limit);

    let rows: SearchHitRow[];
    try {
      rows = db.prepare(sql).all(...params) as SearchHitRow[];
    } catch (err) {
      // FTS5 has its own query syntax: bareword AND/OR/NOT/NEAR are operators,
      // a leading '-' is "exclude", '"' opens a phrase, '*' is a prefix marker,
      // ':' selects a column. Any of those — and a bunch of punctuation
      // combinations — can throw SqliteError mid-prepare. Surface the failure
      // as a zero-hit envelope with a hint so the conversation turn doesn't
      // crash. (User-supplied strings get redacted here too — see I1.)
      const message = err instanceof Error ? err.message : String(err);
      return this.createResult({
        hits: [],
        hint:
          `FTS5 syntax error on query=${JSON.stringify(redact(args.query))}: ${redact(message)}. ` +
          `Try removing quotes, parentheses, leading '-', '*' or ':', or operator keywords ` +
          `(AND/OR/NOT/NEAR). Plain words and phrases work best.`,
      });
    }
    const hits = rows.map((r) => ({ ...r, preview: redact(r.preview) }));

    if (hits.length === 0) {
      const personaPart = appliedPersonaFilter
        ? ` (persona=${redact(JSON.stringify(appliedPersonaFilter))})`
        : '';
      return this.createResult({
        hits: [],
        hint: `0 hits for query=${redact(JSON.stringify(args.query))}${personaPart}. Try: drop the persona filter, widen the time range, or check spelling.`,
      });
    }

    return this.createResult({ hits });
  }

  private async read(args: RecallReadInput, _context: ToolContext): Promise<ToolResult> {
    // Every user-supplied string that lands in an error envelope or hint
    // must pass through redact() — see spec §Redaction. The raw input may
    // itself contain a leaked secret (the model just hallucinated an
    // event_id that includes one) and we must not echo it back unfiltered.
    const safeEventId = redact(args.event_id);
    const match = /^([^:]+):(\d+)$/.exec(args.event_id);
    if (!match) {
      return this.createResult({
        error: `event_id ${JSON.stringify(safeEventId)} malformed; expected <session_id>:<eventSeq>`,
      });
    }
    const sessionId = match[1];
    // Validate the session_id shape BEFORE calling getSessionDir — that helper
    // delegates to asSessionId() which throws a ZodError on non-sess_<uuid>
    // input. An unguarded ZodError bubbles out of executeValidated, where the
    // Tool.execute wrapper turns it into a "ValidationError: …" text result
    // instead of the JSON {error, …} envelope every other recall failure
    // uses. Mirror the SessionIdSchema regex in @lace/ent-protocol so the
    // checks stay in sync. Note: no /i flag — `asSessionId` is case-sensitive
    // and we must match it exactly, otherwise an uppercase UUID slips past
    // our guard and triggers the same ZodError this check exists to prevent.
    if (!/^sess_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sessionId)) {
      return this.createResult({
        error: `event_id ${JSON.stringify(safeEventId)} has malformed session_id; expected sess_<uuid>:<eventSeq>`,
      });
    }
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
      // Spec says JSONL is source of truth. When read finds zero events on
      // disk we still check the FTS index: if FTS knows about this session
      // the transcript was moved or pruned and the agent needs to know its
      // memory and its index disagree. The hint surfaces the divergence
      // without falling back to redacted-but-disk-missing content (option B
      // in the I4 bug report — simplicity over fallback).
      const ftsCount = countFtsEventsForSession(sessionId);
      let hint: string;
      if (totalForSession > 0) {
        hint = `Session ${sessionId} has ${totalForSession} events on disk.`;
      } else if (ftsCount > 0) {
        hint = `Session ${sessionId} has 0 events on disk but ${ftsCount} events in the index. Transcripts may have been moved or deleted.`;
      } else {
        hint = `No events found for session ${sessionId}.`;
      }
      return this.createResult({
        error: `event_id ${JSON.stringify(safeEventId)} not found.`,
        hint,
      });
    }

    inRange.sort((a, b) => a.eventSeq - b.eventSeq);

    // The target event_id must actually be on disk. If the requested seq is
    // missing from inRange — even when neighbors exist — that's a divergence
    // between the agent's recollection of an event_id and the JSONL source of
    // truth. Returning the neighbors as success would silently mask the bad
    // event_id and let downstream reasoning hang facts on a wrong seq.
    const targetExists = inRange.some((ev) => ev.eventSeq === targetSeq);
    if (!targetExists) {
      const hint =
        inRange.length > 0
          ? `Session has ${inRange.length} nearby events (seqs ${inRange[0].eventSeq}..${inRange[inRange.length - 1].eventSeq}) but no event at ${targetSeq}.`
          : `No events found near seq ${targetSeq} in session.`;
      return this.createResult({
        error: `event_id ${JSON.stringify(safeEventId)} not found.`,
        hint,
      });
    }

    // Persona comes from meta.json; one read per request, no caching needed.
    const persona = readPersonaForSessionDir(sessionDir);

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
      return applyTruncation(row, ev.eventSeq, targetSeq, full);
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

function countFtsEventsForSession(sessionId: string): number {
  try {
    const db = getRecallIndex();
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM events WHERE session_id = ?`)
      .get(sessionId) as { n?: number } | undefined;
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

function applyTruncation(
  row: RecallRow,
  rowEventSeq: number,
  targetSeq: number,
  full: boolean
): RecallRow & { content: string } {
  // Compare by integer eventSeq, NOT by event_id string equality. The caller
  // may supply `${sessionId}:01` for what we store as `${sessionId}:1`; a
  // string-equal check demotes the target to the context-tool-call cap (500),
  // silently truncating the very event the caller asked for.
  const isTarget = rowEventSeq === targetSeq;
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
