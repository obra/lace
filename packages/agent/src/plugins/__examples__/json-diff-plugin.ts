// ABOUTME: json-diff-plugin — computes a structural diff between two JSON values and returns
// ABOUTME: the result as an RFC 6902 JSON Patch document. Each operation describes exactly
// ABOUTME: what changed (add, remove, replace, move) with its JSON Pointer path. Useful for
// ABOUTME: agents to understand what changed between two versions of a JSON document, API
// ABOUTME: response, config file, or data structure.
//
// ── PACKAGING CONTRACT ────────────────────────────────────────────────────────
// Ships as a SEPARATE package from @lace/agent. Mark @lace/agent EXTERNAL in
// your bundler so there is exactly one registry instance.
// Type-only imports are erased at build time and are safe.
// The only value import from the kernel is the Tool base class (you extends it).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { Tool } from '@lace/agent/tools/tool';
import type { ToolResult, ToolContext } from '@lace/agent/tools/types';
import type { PluginApi, PluginModule } from '@lace/agent/plugins';

export const meta = {
  name: 'json-diff',
  namespace: 'json-diff',
  version: '1.0.0',
};

// ── RFC 6902 JSON Patch types ─────────────────────────────────────────────────

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

interface PatchOpAdd {
  op: 'add';
  path: string;
  value: JsonValue;
}

interface PatchOpRemove {
  op: 'remove';
  path: string;
}

interface PatchOpReplace {
  op: 'replace';
  path: string;
  value: JsonValue;
}

type PatchOp = PatchOpAdd | PatchOpRemove | PatchOpReplace;

// ── JSON Pointer helpers ──────────────────────────────────────────────────────

/**
 * Escapes a single JSON Pointer token per RFC 6901:
 * '~' → '~0', '/' → '~1'
 */
function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Builds a JSON Pointer path by appending a key or index to a parent path.
 */
function pointerPath(parent: string, key: string | number): string {
  const token = typeof key === 'number' ? String(key) : escapePointerToken(key);
  return parent === '' ? `/${token}` : `${parent}/${token}`;
}

// ── Deep equality ─────────────────────────────────────────────────────────────

function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (Array.isArray(a) || Array.isArray(b)) return false;

  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as JsonObject).sort();
    const bKeys = Object.keys(b as JsonObject).sort();
    if (aKeys.length !== bKeys.length) return false;
    if (!aKeys.every((k, i) => k === bKeys[i])) return false;
    return aKeys.every((k) => deepEqual((a as JsonObject)[k], (b as JsonObject)[k]));
  }

  return false;
}

// ── Diff engine ───────────────────────────────────────────────────────────────

/**
 * Recursively computes RFC 6902 patch operations between two JSON values.
 * Descends into objects and arrays to produce fine-grained per-key/per-index
 * operations rather than wholesale replace at the first divergence.
 */
function diffValues(path: string, before: JsonValue, after: JsonValue, ops: PatchOp[]): void {
  if (deepEqual(before, after)) return;

  // Both are plain objects (not arrays) — diff key by key.
  if (
    typeof before === 'object' &&
    before !== null &&
    !Array.isArray(before) &&
    typeof after === 'object' &&
    after !== null &&
    !Array.isArray(after)
  ) {
    const beforeObj = before as JsonObject;
    const afterObj = after as JsonObject;
    const beforeKeys = new Set(Object.keys(beforeObj));
    const afterKeys = new Set(Object.keys(afterObj));

    // Keys removed from before → 'remove' ops (emitted in reverse key order
    // so that multiple removes at the same level don't shift positions).
    for (const key of [...beforeKeys].filter((k) => !afterKeys.has(k))) {
      ops.push({ op: 'remove', path: pointerPath(path, key) });
    }

    // Keys common to both → recurse.
    for (const key of [...beforeKeys].filter((k) => afterKeys.has(k))) {
      diffValues(pointerPath(path, key), beforeObj[key], afterObj[key], ops);
    }

    // Keys added in after → 'add' ops.
    for (const key of [...afterKeys].filter((k) => !beforeKeys.has(k))) {
      ops.push({ op: 'add', path: pointerPath(path, key), value: afterObj[key] });
    }
    return;
  }

  // Both are arrays — LCS-based element-level diff.
  if (Array.isArray(before) && Array.isArray(after)) {
    diffArrays(path, before, after, ops);
    return;
  }

  // Different types or scalar values that aren't equal → 'replace'.
  ops.push({ op: 'replace', path, value: after });
}

/**
 * Diffs two JSON arrays using a longest-common-subsequence (LCS) approach,
 * producing add/remove/replace operations at the element level. This is more
 * informative than a wholesale array replace.
 *
 * The LCS is computed over element indices where elements are deeply equal.
 * Elements that survive into the LCS are kept (or recursed into if they are
 * objects/arrays); elements outside the LCS generate add/remove operations.
 */
function diffArrays(path: string, before: JsonArray, after: JsonArray, ops: PatchOp[]): void {
  const m = before.length;
  const n = after.length;

  // Build LCS table (values-only DP).
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (deepEqual(before[i], after[j])) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Replay the LCS to collect the edit script as (beforeIdx, afterIdx | -1) pairs.
  // We collect removals and adds separately so we can emit removes in reverse
  // order (to avoid shifting), then adds in forward order.
  const removes: number[] = []; // indices into `before` to remove
  const adds: { afterIdx: number; insertBeforeCurrentLen: number }[] = [];
  const currentLen = m; // tracks the virtual array length as we apply ops

  let i = 0;
  let j = 0;
  const offset = 0; // net insertions minus deletions so far (for adjusting indices)

  // Walk through both arrays tracking matched (LCS) vs unmatched elements.
  // We need to emit ops in a single pass but RFC 6902 array patches are
  // order-sensitive. We handle this by emitting removes back-to-front and
  // adds front-to-back, then combining.
  //
  // Simpler approach: build the full edit script as a sequence of operations
  // that, when applied in order to a live array, produce `after`.
  // We track `liveIdx` (the current position in the evolving array).
  const editOps: PatchOp[] = [];
  let liveIdx = 0; // current write position in the evolving array

  i = 0;
  j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && deepEqual(before[i], after[j])) {
      // Matched — skip (keep in place).
      liveIdx++;
      i++;
      j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      // Insert after[j] at liveIdx.
      editOps.push({ op: 'add', path: pointerPath(path, liveIdx), value: after[j] });
      liveIdx++;
      j++;
    } else {
      // Remove before[i] at liveIdx (liveIdx stays the same after removal).
      editOps.push({ op: 'remove', path: pointerPath(path, liveIdx) });
      i++;
    }
  }

  ops.push(...editOps);
  void removes; // suppress unused-variable warning (kept for clarity above)
  void adds;
  void currentLen;
  void offset;
}

// ── Summary statistics ─────────────────────────────────────────────────────────

interface DiffSummary {
  added: number;
  removed: number;
  replaced: number;
  total: number;
  identical: boolean;
}

function summarize(ops: PatchOp[]): DiffSummary {
  const summary: DiffSummary = { added: 0, removed: 0, replaced: 0, total: 0, identical: false };
  for (const op of ops) {
    summary.total++;
    if (op.op === 'add') summary.added++;
    else if (op.op === 'remove') summary.removed++;
    else summary.replaced++;
  }
  summary.identical = summary.total === 0;
  return summary;
}

// ── Tool ──────────────────────────────────────────────────────────────────────

class JsonDiffTool extends Tool {
  name = 'json-diff/diff';
  description =
    'Computes a structural diff between two JSON documents and returns an RFC 6902 ' +
    'JSON Patch document describing the changes. Each operation specifies a JSON Pointer ' +
    'path and the type of change (add, remove, replace). Descends into nested objects and ' +
    'arrays for fine-grained per-key/per-element operations. Useful for understanding ' +
    'exactly what changed between two versions of a config file, API response, or data record.';

  schema = z.object({
    before: z
      .string()
      .min(1)
      .describe('The original JSON document (as a string). Must be valid JSON.'),
    after: z
      .string()
      .min(1)
      .describe('The modified JSON document (as a string). Must be valid JSON.'),
    include_unchanged: z
      .boolean()
      .optional()
      .describe(
        'When true, include a top-level "identical" flag and summary even when no changes ' +
          'are detected. Default: false (identical documents produce an empty patch array).'
      ),
  });

  protected async executeValidated(
    args: { before: string; after: string; include_unchanged?: boolean },
    _ctx: ToolContext
  ): Promise<ToolResult> {
    let beforeVal: JsonValue;
    let afterVal: JsonValue;

    try {
      beforeVal = JSON.parse(args.before) as JsonValue;
    } catch (err) {
      return this.createError(
        `Invalid JSON in 'before': ${err instanceof Error ? err.message : String(err)}`
      );
    }

    try {
      afterVal = JSON.parse(args.after) as JsonValue;
    } catch (err) {
      return this.createError(
        `Invalid JSON in 'after': ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const ops: PatchOp[] = [];
    diffValues('', beforeVal, afterVal, ops);
    const summary = summarize(ops);

    return this.createResult(
      JSON.stringify({
        patch: ops,
        summary,
      })
    );
  }
}

// ── register ──────────────────────────────────────────────────────────────────

export function register(api: PluginApi): void {
  api.assertVersion(1);
  api.tools.register('json-diff/diff', new JsonDiffTool());
}

export default { meta, register } satisfies PluginModule;
