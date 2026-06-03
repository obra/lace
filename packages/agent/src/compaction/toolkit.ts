// ABOUTME: Compaction toolkit — shared utilities for strategy implementations
// ABOUTME: Currently exports mergePreservedAdjacent for replay-legality enforcement.
// NOTE: Broader toolkit promotion (splitAtTailBoundary, demuxByTrack, buildPreservedTail,
// buildPreservedWithPrefix, renderCompactionPrefix, Slack renderer) is deferred until a
// second strategy needs these primitives (YAGNI — refactoring compact() internals risks
// changing its output, and nothing here yet consumes those functions).

// Replay-legality merge for preserved[] — message-builder replay does NOT repair
// same-role adjacency.
type Block = { type: string; [k: string]: unknown };

export interface PreservedEntry {
  role: string;
  content: string | Block[];
  toolCalls?: unknown[];
  toolResults?: unknown[];
}

function isEmpty(e: PreservedEntry): boolean {
  const hasTool = (e.toolCalls?.length ?? 0) > 0 || (e.toolResults?.length ?? 0) > 0;
  if (hasTool) return false;
  if (typeof e.content === 'string') return e.content.trim().length === 0;
  return e.content.length === 0;
}

function mergeContent(
  a: PreservedEntry['content'],
  b: PreservedEntry['content']
): PreservedEntry['content'] {
  if (typeof a === 'string' && typeof b === 'string')
    return a.trim() && b.trim() ? `${a}\n${b}` : a.trim() ? a : b;
  const arr = (c: PreservedEntry['content']): Block[] =>
    typeof c === 'string' ? (c.trim() ? [{ type: 'text', text: c }] : []) : c;
  return [...arr(a), ...arr(b)];
}

function mergeInto(a: PreservedEntry, b: PreservedEntry): PreservedEntry {
  return {
    role: a.role,
    content: mergeContent(a.content, b.content),
    toolCalls: [...(a.toolCalls ?? []), ...(b.toolCalls ?? [])],
    toolResults: [...(a.toolResults ?? []), ...(b.toolResults ?? [])],
  };
}

/**
 * Drop empties, merge consecutive same-role entries, ensure the first entry is
 * user-role. Returns [] when nothing remains (caller → noop). Idempotent.
 * Image/resource blocks are preserved verbatim (carried in the Block[] content).
 */
export function mergePreservedAdjacent(entries: PreservedEntry[]): PreservedEntry[] {
  const out: PreservedEntry[] = [];
  for (const raw of entries) {
    if (isEmpty(raw)) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === raw.role) out[out.length - 1] = mergeInto(prev, raw);
    else out.push({ ...raw });
  }
  // Ensure leading user-role: merge a leading assistant forward, else drop it.
  while (out.length > 0 && out[0].role !== 'user') {
    if (out.length === 1) {
      out.shift();
      break;
    }
    const merged = mergeInto({ ...out[1], role: out[1].role }, out[0]);
    out.splice(0, 2, { ...merged, role: out[1].role });
  }
  return out;
}
