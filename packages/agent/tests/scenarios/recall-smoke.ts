// ABOUTME: End-to-end smoke for the recall tool — real laceDir, real Session.create,
// ABOUTME: real appendDurableEvent write-through, real SQLite FTS, real RecallTool.

// Per feedback_smoke_vs_tests: passing unit tests do NOT prove the feature works.
// Phase 5.2 once shipped a write-through that silently no-op'd in production
// because the unit fixture differed from the on-disk shape. This script stands up
// an actual lace state directory, seeds events through the real append path, and
// drives the real tool. No mocks, no stubs. Exits non-zero on the first failure.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// IMPORTANT: set LACE_DIR before importing any lace module that reads it.
const laceDir = mkdtempSync(join(tmpdir(), 'recall-smoke-'));
process.env.LACE_DIR = laceDir;

// Dynamic imports so the env var is in place before module-init code runs.
const { getSessionDir, writeSessionMeta, writeSessionState, ensureSessionFiles } = await import(
  '../../src/storage/session-store.js'
);
const { appendDurableEvent, invalidatePersonaCache } = await import(
  '../../src/storage/event-log.js'
);
const { getRecallIndex, closeRecallIndex } = await import('../../src/storage/recall/index-db.js');
const { RecallTool } = await import('../../src/tools/implementations/recall.js');
const toolTypes = await import('../../src/tools/types.js');

type ToolContext = import('../../src/tools/types.js').ToolContext;
type ToolResult = import('../../src/tools/types.js').ToolResult;
void toolTypes; // satisfy lint — used only for type imports above

function makeCtx(): ToolContext {
  return { signal: new AbortController().signal } as ToolContext;
}

function parsePayload(result: ToolResult): Record<string, unknown> {
  assert.equal(result.content.length, 1, 'tool result should have one block');
  const first = result.content[0];
  assert.equal(first.type, 'text', 'tool result block should be text');
  if (first.type !== 'text') throw new Error('unreachable');
  return JSON.parse(first.text) as Record<string, unknown>;
}

function step(label: string): void {
  console.log(`\n=== ${label} ===`);
}

let failed = false;
try {
  console.log(`laceDir: ${laceDir}`);

  // ---- 1. Create the session -------------------------------------------------
  step('1. Session.create');
  const sessionId = `sess_${randomUUID()}`;
  const sessionDir = getSessionDir(sessionId);
  writeSessionMeta(sessionDir, {
    sessionId,
    workDir: laceDir,
    created: new Date().toISOString(),
    persona: 'smoke-test',
  });
  writeSessionState(sessionDir, {
    nextEventSeq: 1,
    nextStreamSeq: 1,
    config: {},
  });
  ensureSessionFiles(sessionDir);
  const session = { sessionId, sessionDir };
  console.log(`  sessionId: ${session.sessionId}`);
  console.log(`  sessionDir: ${session.sessionDir}`);
  // The persona cache may have been populated with a stale "null" earlier in
  // the process — clear it now that meta.json exists.
  invalidatePersonaCache(session.sessionDir);

  // ---- 2. Seed events via the REAL append path -------------------------------
  step('2. Seed events via appendDurableEvent (write-through to FTS)');
  let state = { nextEventSeq: 1, nextStreamSeq: 1 } as {
    nextEventSeq: number;
    nextStreamSeq: number;
  };

  const append = (event: { type: string; data: Record<string, unknown> }): void => {
    const r = appendDurableEvent(session.sessionDir, state, event);
    state = r.nextState;
    console.log(`  appended eventSeq=${r.written.eventSeq} type=${r.written.type}`);
  };

  append({
    type: 'prompt',
    data: {
      type: 'prompt',
      content: [{ type: 'text', text: 'the secret password is opensesame' }],
    },
  });
  append({
    type: 'prompt',
    data: {
      type: 'prompt',
      content: [{ type: 'text', text: 'remind me about the deploy' }],
    },
  });
  append({
    type: 'message',
    data: {
      type: 'message',
      content: [{ type: 'text', text: 'understood; the password is opensesame' }],
    },
  });
  append({
    type: 'message',
    data: {
      type: 'message',
      content: [{ type: 'text', text: "I'll remind you" }],
    },
  });
  append({
    type: 'tool_use',
    data: {
      type: 'tool_use',
      toolCallId: 'tc_bash_1',
      name: 'bash',
      input: { command: 'ls /tmp' },
      result: { content: [{ type: 'text', text: 'file1\nfile2' }] },
    },
  });
  append({
    type: 'tool_use',
    data: {
      type: 'tool_use',
      toolCallId: 'tc_bash_2',
      name: 'bash',
      input: { command: 'env | grep AWS' },
      result: {
        content: [
          {
            type: 'text',
            text: 'export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
          },
        ],
      },
    },
  });

  // ---- 3. Verify write-through landed in FTS ---------------------------------
  step('3. Verify FTS row count for the session');
  const db = getRecallIndex();
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM events WHERE session_id = ?')
    .get(session.sessionId) as { n: number };
  console.log(`  FTS rows for session: ${row.n}`);
  assert.equal(
    row.n,
    6,
    `expected 6 FTS rows from write-through, got ${row.n} — phase 5.2 write-through may be silently no-op'ing`
  );

  // ---- 4. Verify search works ------------------------------------------------
  step('4a. search for "opensesame"');
  const tool = new RecallTool();
  const searchPwResult = await tool.execute({ action: 'search', query: 'opensesame' }, makeCtx());
  const searchPw = parsePayload(searchPwResult);
  const pwHits = searchPw.hits as Array<Record<string, unknown>> | undefined;
  assert.ok(Array.isArray(pwHits), 'search should return a hits array');
  console.log(`  hits: ${pwHits!.length}`);
  for (const h of pwHits!) console.log(`    ${JSON.stringify(h)}`);
  assert.equal(pwHits!.length, 2, `expected 2 hits for "opensesame", got ${pwHits!.length}`);
  const kinds = pwHits!.map((h) => h.kind).sort();
  assert.deepEqual(kinds, ['assistant_text', 'user_message']);

  step('4b. search for "AWS_ACCESS_KEY_ID"');
  const searchAwsResult = await tool.execute(
    { action: 'search', query: 'AWS_ACCESS_KEY_ID' },
    makeCtx()
  );
  const searchAws = parsePayload(searchAwsResult);
  const awsHits = searchAws.hits as Array<Record<string, unknown>> | undefined;
  assert.ok(Array.isArray(awsHits) && awsHits.length >= 1, 'expected at least one AWS hit');
  const awsHit = awsHits!.find((h) => h.kind === 'tool_call');
  assert.ok(awsHit, 'expected a tool_call hit for AWS_ACCESS_KEY_ID');
  const awsPreview = awsHit!.preview as string;
  console.log(`  preview: ${awsPreview}`);
  assert.ok(
    awsPreview.includes('<REDACTED:aws-access-key>'),
    `preview should be redacted; got: ${awsPreview}`
  );
  assert.ok(
    !awsPreview.includes('AKIAIOSFODNN7EXAMPLE'),
    `preview leaked raw AWS key; got: ${awsPreview}`
  );

  const awsEventId = awsHit!.event_id as string;
  console.log(`  awsEventId: ${awsEventId}`);

  // ---- 5. Verify read works --------------------------------------------------
  // We need a target with 2 events before AND 2 events after to verify the
  // context window math. The AWS event is at seq=6 (last seeded), so we use
  // the message at seq=3 as the read target — seqs 1..5 ⇒ 5 events.
  // We still cover redaction in `content` (not just preview) by doing a
  // separate read of the AWS event_id in step 5b below.
  const readTargetId = `${session.sessionId}:3`;
  step(`5a. read middle event (${readTargetId}) with context=2`);
  const readResult = await tool.execute(
    { action: 'read', event_id: readTargetId, context: 2 },
    makeCtx()
  );
  const readPayload = parsePayload(readResult);
  const events = readPayload.events as
    | Array<{ event_id: string; kind: string; content: string }>
    | undefined;
  assert.ok(Array.isArray(events), 'read should return an events array');
  console.log(`  returned ${events!.length} events`);
  for (const e of events!) {
    console.log(
      `    ${e.event_id} kind=${e.kind} content[0..120]=${e.content.slice(0, 120).replace(/\n/g, ' ')}`
    );
  }
  assert.equal(
    events!.length,
    5,
    `expected 5 events (target + 2 before + 2 after), got ${events!.length}`
  );

  // Order: eventSeq ascending
  const seqs = events!.map((e) => Number(e.event_id.split(':')[1]));
  assert.deepEqual(seqs, [1, 2, 3, 4, 5], `expected seqs 1..5, got ${seqs.join(',')}`);

  // Context tool_call (the short ls /tmp one at seq=5) should come through
  // full — far below the 500-char context-tool-call cap.
  const ctxToolCall = events!.find((e) => e.kind === 'tool_call');
  assert.ok(ctxToolCall, 'expected the bash tool_call (seq 5) in the context window');
  console.log(`  context tool_call content: ${ctxToolCall!.content}`);
  assert.ok(
    ctxToolCall!.content.includes('ls /tmp') && ctxToolCall!.content.includes('file1'),
    `context tool_call should include its full short content; got: ${ctxToolCall!.content}`
  );
  assert.ok(
    !ctxToolCall!.content.includes('[truncated'),
    `short context tool_call should not be truncation-marked; got: ${ctxToolCall!.content}`
  );

  // ---- 5b. Redaction in read content ----------------------------------------
  step('5b. read AWS event and verify redaction in content');
  const awsReadResult = await tool.execute(
    { action: 'read', event_id: awsEventId, context: 1 },
    makeCtx()
  );
  const awsReadPayload = parsePayload(awsReadResult);
  const awsReadEvents = awsReadPayload.events as
    | Array<{ event_id: string; kind: string; content: string }>
    | undefined;
  assert.ok(Array.isArray(awsReadEvents), 'aws read should return events');
  const awsTarget = awsReadEvents!.find((e) => e.event_id === awsEventId);
  assert.ok(awsTarget, 'aws target event present');
  console.log(`  aws content: ${awsTarget!.content}`);
  assert.ok(
    awsTarget!.content.includes('<REDACTED:aws-access-key>'),
    `target content should be redacted; got: ${awsTarget!.content}`
  );
  assert.ok(
    !awsTarget!.content.includes('AKIAIOSFODNN7EXAMPLE'),
    `target content leaked raw key; got: ${awsTarget!.content}`
  );

  // ---- 6. Verify read with full=true -----------------------------------------
  step('6. read middle event with full=true');
  const readFullResult = await tool.execute(
    { action: 'read', event_id: readTargetId, context: 2, full: true },
    makeCtx()
  );
  const readFullPayload = parsePayload(readFullResult);
  const fullEvents = readFullPayload.events as
    | Array<{ event_id: string; kind: string; content: string }>
    | undefined;
  assert.ok(Array.isArray(fullEvents), 'read full should return an events array');
  assert.equal(
    fullEvents!.length,
    5,
    `expected 5 events with full=true, got ${fullEvents!.length}`
  );
  for (const e of fullEvents!) {
    assert.ok(
      !e.content.includes('[truncated'),
      `with full=true no event should be truncation-marked; got: ${e.content}`
    );
  }
  // Redaction still applies with full=true — re-read the AWS event to check.
  const awsFullResult = await tool.execute(
    { action: 'read', event_id: awsEventId, context: 0, full: true },
    makeCtx()
  );
  const awsFullPayload = parsePayload(awsFullResult);
  const awsFullEvents = awsFullPayload.events as
    | Array<{ event_id: string; content: string }>
    | undefined;
  const awsFullTarget = awsFullEvents!.find((e) => e.event_id === awsEventId);
  assert.ok(awsFullTarget, 'full=true target present');
  assert.ok(
    awsFullTarget!.content.includes('<REDACTED:aws-access-key>'),
    'redaction still applies with full=true'
  );
  console.log(`  all 5 events returned, none truncated, redaction intact under full=true`);

  // ---- 7. Verify error paths -------------------------------------------------
  step('7a. read with bogus event_id');
  // Use a well-formed-but-unknown sess_<uuid>; sessionId validation rejects
  // malformed ids and would surface as a non-JSON ValidationError block here.
  const bogusSessionId = `sess_${randomUUID()}`;
  const bogusResult = await tool.execute(
    { action: 'read', event_id: `${bogusSessionId}:999` },
    makeCtx()
  );
  const bogusPayload = parsePayload(bogusResult);
  console.log(`  payload: ${JSON.stringify(bogusPayload)}`);
  assert.ok(typeof bogusPayload.error === 'string', 'bogus event_id should produce an error field');
  assert.ok(
    (bogusPayload.error as string).toLowerCase().includes('not found') ||
      typeof bogusPayload.hint === 'string',
    'bogus event_id error should include a not-found hint'
  );

  step('7b. search with no matches');
  const noMatchResult = await tool.execute(
    { action: 'search', query: 'xyznevermatches' },
    makeCtx()
  );
  const noMatchPayload = parsePayload(noMatchResult);
  console.log(`  payload: ${JSON.stringify(noMatchPayload)}`);
  const noMatchHits = noMatchPayload.hits as unknown[];
  assert.deepEqual(noMatchHits, [], 'no-match search should return empty hits');
  assert.equal(typeof noMatchPayload.hint, 'string', 'no-match search should include a hint');

  step('SUMMARY');
  console.log('OK');
} catch (err) {
  failed = true;
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`\n=== SUMMARY ===\nFAIL: ${msg}`);
} finally {
  try {
    closeRecallIndex();
  } catch (err) {
    console.error('closeRecallIndex error (ignored):', err);
  }
  try {
    rmSync(laceDir, { recursive: true, force: true });
  } catch (err) {
    console.error('rmSync error (ignored):', err);
  }
}

process.exit(failed ? 1 : 0);
