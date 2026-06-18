# Tool-Result Capping Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Cap how much a single tool result contributes to the live context AND the durable transcript, so an oversized MCP/exec/tool result can no longer balloon the session toward the context window.

**Architecture:** A single chokepoint in the conversation runner, where every tool result already converges (`executeToolCall` → `coreResult`). Results at or below a ride-whole budget pass through untouched. Larger results are spilled in full to a per-session sidecar file and replaced — in both the live provider message and the durable `tool_use` event — with a small head+tail digest plus an exact-byte elision marker. A new `read_tool_result` tool pages the spilled remainder by head/tail/grep. Numbers mirror serf (`agent/job_shell.go`, `agent/job_output_digest.go`): ride-whole 8 KB, ~2 KB digest.

**Tech Stack:** TypeScript, vitest, zod. All work in `packages/agent`.

**Conventions:** Files start with `// ABOUTME:`. Strict TS, no `any`. Real fs in tests (tempdir). TDD: failing test first. Run `npx vitest run <file>` from `packages/agent`.

---

## Constants (shared)

- `TOOL_RESULT_RIDE_WHOLE_BYTES = 8 * 1024` — a result whose text content is ≤ this rides back whole; no spill, no digest.
- `TOOL_RESULT_DIGEST_HALF_BYTES = 1024` — when over the ride-whole budget, keep this many bytes from the head and from the tail (≈ 2 KB digest), each trimmed to a line boundary.

---

### Task 1: Tool-result digest (pure function)

**Files:**
- Create: `packages/agent/src/tools/result-digest.ts`
- Test: `packages/agent/src/tools/__tests__/result-digest.test.ts`

The function digests a single string. Line-align the head/tail cuts (don't split mid-line). The marker must state the exact elided byte count and how to recover.

```ts
// ABOUTME: Pure head+tail digest for oversized tool-result text. Keeps the result
// ABOUTME: navigable in context while the full payload lives in a sidecar.

export const TOOL_RESULT_RIDE_WHOLE_BYTES = 8 * 1024;
export const TOOL_RESULT_DIGEST_HALF_BYTES = 1024;

export interface ToolResultDigest {
  text: string;        // either the whole input (ride-whole) or head+marker+tail
  elidedBytes: number; // 0 when ridden whole
  totalBytes: number;  // byte length of the full input
}

export function digestToolResultText(
  full: string,
  toolCallId: string,
  opts?: { rideWholeBytes?: number; digestHalfBytes?: number }
): ToolResultDigest {
  const rideWhole = opts?.rideWholeBytes ?? TOOL_RESULT_RIDE_WHOLE_BYTES;
  const half = opts?.digestHalfBytes ?? TOOL_RESULT_DIGEST_HALF_BYTES;
  const totalBytes = Buffer.byteLength(full, 'utf8');
  if (totalBytes <= rideWhole) return { text: full, elidedBytes: 0, totalBytes };

  const buf = Buffer.from(full, 'utf8');
  // Head: first `half` bytes, trimmed back to the last newline so we don't cut a line.
  let headEnd = Math.min(half, buf.length);
  const lastNlInHead = buf.lastIndexOf(0x0a, headEnd - 1);
  if (lastNlInHead > 0) headEnd = lastNlInHead + 1;
  // Tail: last `half` bytes, trimmed forward to the first newline.
  let tailStart = Math.max(buf.length - half, headEnd);
  const firstNlInTail = buf.indexOf(0x0a, tailStart);
  if (firstNlInTail >= 0 && firstNlInTail + 1 < buf.length) tailStart = firstNlInTail + 1;

  const head = buf.subarray(0, headEnd).toString('utf8');
  const tail = buf.subarray(tailStart).toString('utf8');
  const elidedBytes = totalBytes - Buffer.byteLength(head, 'utf8') - Buffer.byteLength(tail, 'utf8');
  const marker =
    `\n…[${elidedBytes} bytes elided of ${totalBytes} total — recover with ` +
    `read_tool_result(tool_call_id="${toolCallId}", head_lines=…, tail_lines=…, grep="…")]…\n`;
  return { text: head + marker + tail, elidedBytes, totalBytes };
}
```

- [ ] **Step 1: Write failing tests.** Cover: (a) input ≤ 8 KB returns unchanged, `elidedBytes === 0`; (b) input > 8 KB returns head+marker+tail, `text` length far smaller than input, marker contains the exact `elidedBytes` and the `toolCallId`; (c) head/tail cuts land on line boundaries (no partial line at the head end or tail start); (d) multibyte UTF-8 near the cut does not produce broken output (use a string with `é`/emoji near the boundary; assert the result round-trips as valid UTF-8 — `Buffer.from(result.text,'utf8').toString('utf8')` equals itself). 
- [ ] **Step 2:** Run `npx vitest run src/tools/__tests__/result-digest.test.ts` — fails (module missing).
- [ ] **Step 3:** Implement `result-digest.ts` as above.
- [ ] **Step 4:** Run the test — passes.
- [ ] **Step 5:** Commit.

---

### Task 2: Tool-result sidecar store

**Files:**
- Create: `packages/agent/src/storage/tool-result-store.ts`
- Test: `packages/agent/src/storage/__tests__/tool-result-store.test.ts`

Stores the full result under `<sessionDir>/tool-results/<toolCallId>.txt` and reads it back with head/tail/grep slicing. Use `getSessionDir(sessionId)` from `session-store.ts` to resolve the dir. Sanitize `toolCallId` to a safe filename (allow `[A-Za-z0-9_-]`, reject/replace others) to prevent path traversal.

```ts
// ABOUTME: Per-session sidecar for full tool-result payloads that were digested
// ABOUTME: out of the live context; read back by head/tail/grep via read_tool_result.

export function writeToolResultSidecar(sessionId: string, toolCallId: string, full: string): void
export interface SidecarSlice { content: string; totalBytes: number; lineCount: number; matchedLines?: number }
export function readToolResultSidecar(
  sessionId: string,
  toolCallId: string,
  opts: { headLines?: number; tailLines?: number; grep?: string }
): SidecarSlice  // throws a clear Error if the sidecar is absent
```

Slicing semantics: if `grep` is set, return only matching lines (plain substring match, capped at a sane max e.g. 500 lines, note when capped); otherwise return the first `headLines` and/or last `tailLines` (default to a modest head, e.g. 200 lines, when none given). Always report `totalBytes` and `lineCount` of the full file.

- [ ] **Step 1:** Write failing tests (tempdir + `LACE_DIR`): write a 50 KB multi-line payload, then read back head-only, tail-only, grep, and the absent-sidecar error path. Assert filename sanitization (a `toolCallId` with `../` does not escape the dir).
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — passes.
- [ ] **Step 5:** Commit.

---

### Task 3: `read_tool_result` tool

**Files:**
- Create: `packages/agent/src/tools/implementations/read_tool_result.ts`
- Modify: `packages/agent/src/tools/builtins.ts` (register the tool in `registerBuiltinTools`)
- Test: `packages/agent/src/tools/__tests__/read-tool-result.test.ts`

Model on `JobOutputTool` (`implementations/job_output.ts`). zod schema `{ tool_call_id: NonEmptyString, head_lines?: int>=0, tail_lines?: int>=0, grep?: string }` `.strict()`. Resolve the session from `context.activeSessionId` (fail with a clear message if absent). Call `readToolResultSidecar`. Return the slice as a text `ToolResult`, prefixed with a one-line header stating total bytes/lines and what slice was returned. Mark `readOnlySafe: true`, `safeInternal: true`. Write a description that tells the model this fetches the full output of a previously-digested tool result, and to prefer `grep` for large outputs.

- [ ] **Step 1:** Write failing tests: seed a sidecar via Task 2, build a `ToolContext` with `activeSessionId`, call the tool with head/tail/grep, assert the returned content; assert the missing-`activeSessionId` and missing-sidecar failure paths return `status:'failed'` with a clear message (not a throw).
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement + register in `builtins.ts`.
- [ ] **Step 4:** Run — passes. Also run `src/tools/builtins.test.ts` to confirm registration didn't break the builtin set (update its expected-tool list/count if it pins one).
- [ ] **Step 5:** Commit.

---

### Task 4: Runner integration (the chokepoint)

**Files:**
- Modify: `packages/agent/src/core/conversation/runner.ts` (in `executeToolCall`, right after `executeToolByName` returns `coreResult` at ~line 1619, before `protocolResult` is built and before the return)
- Test: `packages/agent/src/core/conversation/__tests__/` — add `runner-tool-result-cap.test.ts` (match the dir convention used by existing runner tests; if runner tests live elsewhere, co-locate there)

Apply capping to `coreResult` so BOTH downstream consumers — the durable `tool_use` event (built from `protocolToolResultFromCore(coreResult)`) and the `providerMessages` append (`{ role:'user', content:'', toolResults:[result.coreResult] }`) — carry the digested content. Do NOT digest the `read_tool_result` tool's own output (it is already bounded by its args; digesting it would defeat paging) — skip by tool name.

Logic:
1. Concatenate the text of `coreResult.content` text blocks → `fullText`. (Leave non-text blocks, e.g. images, untouched and unmeasured.)
2. `const digest = digestToolResultText(fullText, toolCallId)`.
3. If `digest.elidedBytes > 0`: `writeToolResultSidecar(sessionId, toolCallId, fullText)` and replace `coreResult.content`'s text blocks with a single `{ type:'text', text: digest.text }` (preserving any non-text blocks). Leave `status` unchanged.
4. If `elidedBytes === 0`: leave `coreResult` untouched.

`sessionId` is in scope in `executeToolCall` (it is a param). Guard: if `sessionId` is missing/empty, skip the spill and just inline-truncate (don't lose the cap, but don't write a stray file) — or assert it's present; pick the safe option and note it.

- [ ] **Step 1:** Write a failing test that drives `executeToolCall` (or the smallest runner seam that exercises this branch) with a stubbed `toolExecutor.execute` returning a >8 KB text result, and asserts: (a) the `coreResult.content` text returned/appended is the digest (small, contains the marker), (b) a sidecar file exists with the full text, (c) a ≤8 KB result is passed through unchanged. If `executeToolCall` is private/hard to call directly, test through the existing runner test harness used by other runner tests, or temporarily expose a thin internal seam — prefer reusing an existing harness.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement the capping block.
- [ ] **Step 4:** Run — passes.
- [ ] **Step 5:** Run the broader suites: `npx vitest run src/core src/tools src/storage` — all green. Then `npm run typecheck` and `npm run lint`.
- [ ] **Step 6:** Commit.

---

## Out of scope (note as follow-ups, do not build)

- Sidecar retention/eviction (serf drops the middle past a retention cap). v1 keeps the full spill; disk is cheaper than context. Revisit if session dirs grow unbounded.
- Digesting non-text content blocks (images).
- A separate, larger inline budget for bounded delegate *reports* (serf's `shellInlineOutputBytes = 64 KB`); not needed for the general raw-result cap.

## Self-review checklist (run before final commit)

- Every oversized result path writes the sidecar AND digests both the live message and the durable event.
- `read_tool_result` is excluded from re-digestion.
- No placeholder text, no `any`, line-aligned cuts, UTF-8 safe.
- Builtin registration test updated if it pins the tool set.
