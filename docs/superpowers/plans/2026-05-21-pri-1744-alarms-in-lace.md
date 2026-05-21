# PRI-1744: Alarms in lace + unified notification injection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the alarm subsystem from sen-core into lace as per-session `alarms.json` snapshot storage + a per-process scheduler. Replace the existing `<background-job-notification>` machinery with a single `injectNotification` utility that writes `context_injected` events with `priority='immediate'`. Add `<notification kind="alarm-fired" | "job-{completed,failed,cancelled,progress}" | "subagent-exited">` as the unified agent-facing shape.

**Architecture:** No new ent-protocol surface. The existing `context_injected` `DurableEvent` carries every notification. The conversation runner's existing immediate-inject pickup loop (`runner.ts:71-90, 217-227`) folds them into the next turn as `role: 'user'` messages. The runner's watermark init changes from "latest seq" to "last `turn_end` seq" so events written between turns are picked up. Scheduler lives in the lace process; `injectNotification` triggers an internal turn when called against the active session and the agent is idle. Subagent graceful exit scans its `alarms.json` and writes a `subagent-exited` notification into the parent's `events.jsonl` if pending alarms exist.

**Tech Stack:** TypeScript 5.6+ strict, Node 20.18+, Vitest, JSON snapshot + `atomicWriteJson`, `@lace/ent-protocol` zod schemas, `appendDurableEvent` for cross-process event writes.

**Repos touched:**
- Lace worktree: `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/lace-worktrees/pri-1744-alarms-spec/` (branch `pri-1744-alarms-spec`).
- Sen-core: `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2/` (branch off `main`: `pri-1744-alarms-in-lace`).

**Spec:** `docs/superpowers/specs/2026-05-21-pri-1744-alarms-in-lace.md`

**Pre-flight (run once at execution start):**

```bash
cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/lace-worktrees/pri-1744-alarms-spec
git fetch origin && git pull --ff-only origin pri-1744-alarms-spec
npm install
npm run lint
npm run test 2>&1 | tail -20
```

All lint and existing tests must be green before starting. Same checks for sen-core when Phase 7 begins.

---

## File map (lace)

**Create:**
- `packages/agent/src/alarms/types.ts`
- `packages/agent/src/alarms/cron.ts`
- `packages/agent/src/alarms/alarm-store.ts`
- `packages/agent/src/alarms/alarm-scheduler.ts`
- `packages/agent/src/alarms/index.ts`
- `packages/agent/src/alarms/__tests__/cron.test.ts`
- `packages/agent/src/alarms/__tests__/alarm-store.test.ts`
- `packages/agent/src/alarms/__tests__/alarm-scheduler.test.ts`
- `packages/agent/src/notifications/inject-notification.ts`
- `packages/agent/src/notifications/notification-wrapper.ts`
- `packages/agent/src/notifications/composers.ts`
- `packages/agent/src/notifications/index.ts`
- `packages/agent/src/notifications/__tests__/notification-wrapper.test.ts`
- `packages/agent/src/notifications/__tests__/composers.test.ts`
- `packages/agent/src/notifications/__tests__/inject-notification.test.ts`
- `packages/agent/src/tools/implementations/schedule_alarm.ts`
- `packages/agent/src/tools/implementations/cancel_alarm.ts`
- `packages/agent/src/tools/implementations/list_alarms.ts`
- `packages/agent/src/tools/implementations/__tests__/schedule_alarm.test.ts`
- `packages/agent/src/tools/implementations/__tests__/cancel_alarm.test.ts`
- `packages/agent/src/tools/implementations/__tests__/list_alarms.test.ts`
- `packages/agent/src/__tests__/alarms.fire-delivery.e2e.test.ts`
- `packages/agent/src/__tests__/alarms.idle-wake.e2e.test.ts`
- `packages/agent/src/__tests__/alarms.restart-recovery.e2e.test.ts`
- `packages/agent/src/__tests__/alarms.cron-reschedule.e2e.test.ts`
- `packages/agent/src/__tests__/alarms.subagent-exit-graceful.e2e.test.ts`
- `packages/agent/src/__tests__/alarms.subagent-exit-no-pending.e2e.test.ts`
- `docs/features/alarms.md`
- `docs/features/notifications.md`

**Modify:**
- `packages/agent/src/storage/event-log.ts` — add `findLastTurnEndEventSeq` helper.
- `packages/agent/src/storage/session-store.ts` — extend `SessionMeta` with optional `parent`; export `agentSessionsDir`.
- `packages/agent/src/core/conversation/runner.ts` — change initial `lastSeenEventSeq` to use `findLastTurnEndEventSeq`.
- `packages/agent/src/core/conversation/__tests__/runner.context-inject.test.ts` — extend with "between turns" coverage.
- `packages/agent/src/tools/types.ts` — add `alarmScheduler?`, `activeSessionId?`, `activeSessionDir?` to `ToolContext`.
- `packages/agent/src/tools/executor.ts` — add three new tools to `LACE_BUILTIN_TOOL_NAMES`; register them.
- `packages/agent/src/tools/implementations/index.ts` — export the three new tools.
- `packages/agent/src/server-types.ts` — add `alarmScheduler` field to `AgentServerState`.
- `packages/agent/src/server.ts` — instantiate scheduler, plumb into `ToolContext`, register graceful-shutdown hook.
- `packages/agent/src/jobs/job-manager.ts` — delete `notificationQueue`, `queueNotification`, `getNotificationQueue`, `flushNotifications`; rewrite `fanout` to call `injectNotification` directly.
- `packages/agent/src/jobs/job-notifications.ts` — rewrite `createQueueJobNotification` to call `injectNotification` with composed bodies.
- `packages/agent/src/jobs/format-notification.ts` — **delete** (replaced by composers).
- `packages/agent/src/jobs/__tests__/format-notification.test.ts` (if it exists) — **delete**.
- `packages/agent/src/rpc/handlers/prompt.ts:102-111` — delete the `flushNotifications`/prepend block.
- `packages/agent/src/rpc/handlers/session.ts` — accept `parent` in `session/new` params; persist to meta.
- `packages/agent/src/jobs/subagent-job.ts` — pass `parent` in the `session/new` call against the subagent process.
- `packages/ent-protocol/src/schemas/methods.ts` — add optional `parent` to `SessionNewParamsSchema`.

## File map (sen-core, in `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2/`)

**Delete:**
- `src/alarms/store.ts`
- `src/alarms/scheduler-service.ts`
- `src/alarms/tools.ts`
- `src/alarms/cron.ts`
- `src/alarms/types.ts`
- `mcp-servers/scheduler.ts`
- `tests/automated/alarms/` (directory)

**Modify:**
- `src/main.ts` — remove alarm/scheduler block (~lines 574-590) and imports.
- `src/slack/envelope.ts` — remove `formatAlarm`, `isInboundAlarm` branch in `formatEnvelope`. Type narrows to `InboundSlackMessage`.
- `src/slack/types.ts` — drop `InboundAlarm` re-export and `isInboundAlarm`; `InboundItem` collapses to `InboundSlackMessage`.
- `src/ambient/inbox-dispatcher.ts` — remove alarm-handling branches (if any explicit ones exist). Verify; may already be type-driven.
- `templates/agent-personas/core.md` — remove the `scheduler:` MCP block.

---

## Phase 1 — Notification core (wrapper + composers + injector)

Building this first lets later phases (alarms, job-notification refactor) share a tested foundation.

### Task 1: `<notification>` wrapper utility (failing test first)

**Files:**
- Create: `packages/agent/src/notifications/notification-wrapper.ts`
- Create: `packages/agent/src/notifications/__tests__/notification-wrapper.test.ts`

- [ ] **Step 1:** Write the failing test. Create `packages/agent/src/notifications/__tests__/notification-wrapper.test.ts`:

```ts
// ABOUTME: Unit tests for buildNotification — wrapper element, attribute escaping,
// ABOUTME: identifier preservation, body passed through verbatim.

import { describe, it, expect } from 'vitest';
import { buildNotification } from '../notification-wrapper';

describe('buildNotification', () => {
  it('wraps body in <notification kind="..."> with no attrs', () => {
    expect(buildNotification({ kind: 'alarm-fired', body: 'Hello.' })).toBe(
      '<notification kind="alarm-fired">\nHello.\n</notification>'
    );
  });

  it('serializes identifiers as XML attributes in order', () => {
    const out = buildNotification({
      kind: 'job-completed',
      identifiers: { 'job-id': 'job_xyz', persona: 'shell' },
      body: 'Done.',
    });
    expect(out).toBe('<notification kind="job-completed" job-id="job_xyz" persona="shell">\nDone.\n</notification>');
  });

  it('escapes attribute values', () => {
    const out = buildNotification({
      kind: 'alarm-fired',
      identifiers: { 'alarm-id': 'a&b"<c>' },
      body: 'x',
    });
    expect(out).toContain('alarm-id="a&amp;b&quot;&lt;c&gt;"');
  });

  it('drops empty-string identifiers (e.g. missing persona)', () => {
    const out = buildNotification({
      kind: 'subagent-exited',
      identifiers: { 'subagent-session-id': 'sess_a', persona: '' },
      body: 'b',
    });
    expect(out).toBe('<notification kind="subagent-exited" subagent-session-id="sess_a">\nb\n</notification>');
  });
});
```

- [ ] **Step 2:** Run; confirm FAIL.

```bash
npx vitest --run packages/agent/src/notifications/__tests__/notification-wrapper.test.ts
```

- [ ] **Step 3:** Create `packages/agent/src/notifications/notification-wrapper.ts`:

```ts
// ABOUTME: Single source of truth for the <notification kind="..."> wrapper used by
// ABOUTME: every lace-side agent-facing notification (alarm-fired, job-*, subagent-exited).

export type NotificationKind =
  | 'alarm-fired'
  | 'job-completed'
  | 'job-failed'
  | 'job-cancelled'
  | 'job-progress'
  | 'subagent-exited';

export interface BuildNotificationOptions {
  kind: NotificationKind;
  identifiers?: Record<string, string>;
  body: string;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildNotification(opts: BuildNotificationOptions): string {
  const attrs: string[] = [`kind="${escapeXmlAttr(opts.kind)}"`];
  if (opts.identifiers) {
    for (const [k, v] of Object.entries(opts.identifiers)) {
      if (v === '') continue;
      attrs.push(`${k}="${escapeXmlAttr(v)}"`);
    }
  }
  return `<notification ${attrs.join(' ')}>\n${opts.body}\n</notification>`;
}
```

- [ ] **Step 4:** Run and verify PASS. Commit.

```bash
npx vitest --run packages/agent/src/notifications/__tests__/notification-wrapper.test.ts
git add packages/agent/src/notifications/notification-wrapper.ts packages/agent/src/notifications/__tests__/notification-wrapper.test.ts
git commit -m "feat(notifications): unified <notification> wrapper utility (PRI-1744)"
```

---

### Task 2: Body composers (failing test first)

**Files:**
- Create: `packages/agent/src/notifications/composers.ts`
- Create: `packages/agent/src/notifications/__tests__/composers.test.ts`

- [ ] **Step 1:** Write the failing test. Composers are pure functions; snapshot-style assertions verify the exact prose.

```ts
// ABOUTME: Unit tests for body composers — pure functions producing prose bodies
// ABOUTME: for each notification kind. Snapshots locked to the bodies in the spec.

import { describe, it, expect } from 'vitest';
import {
  composeAlarmFiredBody,
  composeJobCompletedBody,
  composeJobFailedBody,
  composeJobCancelledBody,
  composeJobProgressBody,
  composeSubagentExitedBody,
} from '../composers';

describe('composers', () => {
  it('alarm-fired: cron alarm', () => {
    expect(
      composeAlarmFiredBody({
        kind: 'cron',
        schedule: '0 9 * * *',
        timezone: 'America/Los_Angeles',
        prompt: 'Time to check the test status board',
      })
    ).toBe(
      'The cron alarm you scheduled (0 9 * * * in America/Los_Angeles) just fired. The note you left for your future self: "Time to check the test status board". Call list_alarms() to see other pending alarms.'
    );
  });

  it('alarm-fired: one-shot alarm', () => {
    expect(
      composeAlarmFiredBody({
        kind: 'once',
        schedule: '2026-05-22T17:00:00Z',
        timezone: 'UTC',
        prompt: 'Check the deploy',
      })
    ).toBe(
      'The one-shot alarm you scheduled for 2026-05-22T17:00:00Z just fired. The note you left for your future self: "Check the deploy". Call list_alarms() to see other pending alarms.'
    );
  });

  it('job-completed: shell exit 0', () => {
    expect(
      composeJobCompletedBody({
        jobId: 'job_xyz',
        jobType: 'bash',
        exitCode: 0,
        durationMs: 12300,
        outputBytes: 15234,
        lastLines: ['build finished in 5.2s'],
      })
    ).toBe(
      'Your background job completed successfully (exit code 0) after 12.3 seconds, writing 15,234 bytes of output. The last line was: "build finished in 5.2s". Call job_output(jobId="job_xyz") to read the full output.'
    );
  });

  it('job-completed: delegate adds resume hint', () => {
    const body = composeJobCompletedBody({
      jobId: 'job_xyz',
      jobType: 'delegate',
      exitCode: 0,
      durationMs: 12300,
      outputBytes: 15234,
      lastLines: ['ok'],
    });
    expect(body).toContain('To continue this conversation thread, call delegate(resume="job_xyz", prompt="your message").');
  });

  it('job-failed: includes exit code', () => {
    const body = composeJobFailedBody({
      jobId: 'job_q',
      jobType: 'bash',
      exitCode: 2,
      durationMs: 3000,
      outputBytes: 100,
      lastLines: ['error: thing went wrong'],
    });
    expect(body).toContain('exit code 2');
    expect(body).toContain('Call job_output(jobId="job_q")');
  });

  it('job-cancelled: includes reason', () => {
    const body = composeJobCancelledBody({
      jobId: 'job_q',
      jobType: 'bash',
      durationMs: 1500,
      outputBytes: 50,
      lastLines: [],
      reason: 'user requested cancel',
    });
    expect(body).toContain('was cancelled');
    expect(body).toContain('user requested cancel');
  });

  it('job-progress: includes delta + tail lines', () => {
    const body = composeJobProgressBody({
      jobId: 'job_xyz',
      durationMs: 5 * 60_000 + 12_000,
      outputBytes: 142_330,
      deltaBytes: 8_210,
      lastLines: ['building target...', 'built dist/cli.js in 3.1s', 'built dist/main.js in 5.2s'],
    });
    expect(body).toBe(
      'Your background job has been running for 5m 12.0s and has written 142,330 bytes (+8,210 since last update). Recent output:\n  building target...\n  built dist/cli.js in 3.1s\n  built dist/main.js in 5.2s\nCall job_output(jobId="job_xyz") to check current output.'
    );
  });

  it('subagent-exited: one pending alarm', () => {
    expect(
      composeSubagentExitedBody({
        persona: 'sen-box',
        pendingAlarms: [
          { id: 'alarm_z1z2', kind: 'once', schedule: '2026-05-22T17:00:00Z', prompt: 'Check on the running git operation' },
        ],
      })
    ).toBe(
      'Your sen-box subagent exited gracefully but had 1 pending alarm that won\'t fire now: alarm_z1z2 was a one-shot scheduled for 2026-05-22T17:00:00Z with the prompt "Check on the running git operation".'
    );
  });

  it('subagent-exited: multiple pending alarms', () => {
    const body = composeSubagentExitedBody({
      persona: 'sen-box',
      pendingAlarms: [
        { id: 'alarm_a', kind: 'once', schedule: '2026-05-22T17:00:00Z', prompt: 'A' },
        { id: 'alarm_b', kind: 'cron', schedule: '0 9 * * *', prompt: 'B' },
      ],
    });
    expect(body).toContain('Your sen-box subagent exited gracefully but had 2 pending alarms that won\'t fire now:');
    expect(body).toContain('  alarm_a was a one-shot scheduled for 2026-05-22T17:00:00Z with the prompt "A".');
    expect(body).toContain('  alarm_b was a cron (0 9 * * *) with the prompt "B".');
  });
});
```

- [ ] **Step 2:** Run; confirm FAIL.

- [ ] **Step 3:** Create `packages/agent/src/notifications/composers.ts`:

```ts
// ABOUTME: Pure body-composer functions for each notification kind. No side effects.
// ABOUTME: Output strings are wrapped by buildNotification in inject-notification.ts.

const MAX_LINE_LENGTH = 200;

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} seconds`;
  const mins = Math.floor(ms / 60_000);
  const secs = (ms % 60_000) / 1000;
  return `${mins}m ${secs.toFixed(1)}s`;
}

function formatBytes(bytes: number): string {
  return bytes.toLocaleString('en-US');
}

function truncate(line: string, maxLen = MAX_LINE_LENGTH): string {
  return line.length <= maxLen ? line : line.slice(0, maxLen - 3) + '...';
}

export interface AlarmFiredCompose {
  kind: 'cron' | 'once';
  schedule: string;
  timezone: string;
  prompt: string;
}

export function composeAlarmFiredBody(a: AlarmFiredCompose): string {
  const head =
    a.kind === 'cron'
      ? `The cron alarm you scheduled (${a.schedule} in ${a.timezone}) just fired.`
      : `The one-shot alarm you scheduled for ${a.schedule} just fired.`;
  return `${head} The note you left for your future self: "${a.prompt}". Call list_alarms() to see other pending alarms.`;
}

export interface JobCompletedCompose {
  jobId: string;
  jobType: 'bash' | 'delegate';
  exitCode: number;
  durationMs: number;
  outputBytes: number;
  lastLines: string[];
}

export function composeJobCompletedBody(j: JobCompletedCompose): string {
  const trailing = trailingLineHint(j.lastLines);
  const base = `Your background job completed successfully (exit code ${j.exitCode}) after ${formatDuration(j.durationMs)}, writing ${formatBytes(j.outputBytes)} bytes of output.${trailing} Call job_output(jobId="${j.jobId}") to read the full output.`;
  if (j.jobType === 'delegate') {
    return `${base} To continue this conversation thread, call delegate(resume="${j.jobId}", prompt="your message").`;
  }
  return base;
}

export interface JobFailedCompose extends JobCompletedCompose {}

export function composeJobFailedBody(j: JobFailedCompose): string {
  const trailing = trailingLineHint(j.lastLines);
  const base = `Your background job failed (exit code ${j.exitCode}) after ${formatDuration(j.durationMs)}, writing ${formatBytes(j.outputBytes)} bytes of output.${trailing} Call job_output(jobId="${j.jobId}") to read the full output.`;
  if (j.jobType === 'delegate') {
    return `${base} To continue this conversation thread, call delegate(resume="${j.jobId}", prompt="your message").`;
  }
  return base;
}

export interface JobCancelledCompose {
  jobId: string;
  jobType: 'bash' | 'delegate';
  durationMs: number;
  outputBytes: number;
  lastLines: string[];
  reason?: string;
}

export function composeJobCancelledBody(j: JobCancelledCompose): string {
  const trailing = trailingLineHint(j.lastLines);
  const reasonText = j.reason ? ` Reason: ${j.reason}.` : '';
  return `Your background job was cancelled after ${formatDuration(j.durationMs)}, having written ${formatBytes(j.outputBytes)} bytes of output.${reasonText}${trailing} Call job_output(jobId="${j.jobId}") to read the full output.`;
}

export interface JobProgressCompose {
  jobId: string;
  durationMs: number;
  outputBytes: number;
  deltaBytes: number;
  lastLines: string[];
}

export function composeJobProgressBody(j: JobProgressCompose): string {
  const head = `Your background job has been running for ${formatDuration(j.durationMs)} and has written ${formatBytes(j.outputBytes)} bytes (+${formatBytes(j.deltaBytes)} since last update).`;
  if (j.lastLines.length === 0) {
    return `${head} Call job_output(jobId="${j.jobId}") to check current output.`;
  }
  const lines = j.lastLines.map((l) => `  ${truncate(l)}`).join('\n');
  return `${head} Recent output:\n${lines}\nCall job_output(jobId="${j.jobId}") to check current output.`;
}

function trailingLineHint(lines: string[]): string {
  if (lines.length === 0) return '';
  const last = truncate(lines[lines.length - 1]);
  return ` The last line was: "${last}".`;
}

export interface SubagentPendingAlarm {
  id: string;
  kind: 'cron' | 'once';
  schedule: string;
  prompt: string;
}

export interface SubagentExitedCompose {
  persona: string;
  pendingAlarms: SubagentPendingAlarm[];
}

export function composeSubagentExitedBody(s: SubagentExitedCompose): string {
  const personaWord = s.persona.length > 0 ? `${s.persona} ` : '';
  const n = s.pendingAlarms.length;
  const head = `Your ${personaWord}subagent exited gracefully but had ${n} pending alarm${n === 1 ? '' : 's'} that won't fire now`;
  if (n === 1) {
    const a = s.pendingAlarms[0];
    return `${head}: ${formatPendingAlarm(a, /*inline*/ true)}`;
  }
  const lines = s.pendingAlarms.map((a) => `  ${formatPendingAlarm(a, /*inline*/ false)}`).join('\n');
  return `${head}:\n${lines}`;
}

function formatPendingAlarm(a: SubagentPendingAlarm, inline: boolean): string {
  const desc =
    a.kind === 'cron'
      ? `was a cron (${a.schedule})`
      : `was a one-shot scheduled for ${a.schedule}`;
  return `${a.id} ${desc} with the prompt "${a.prompt}".`;
}
```

- [ ] **Step 4:** Run; verify PASS. Commit.

```bash
npx vitest --run packages/agent/src/notifications/__tests__/composers.test.ts
git add packages/agent/src/notifications/composers.ts packages/agent/src/notifications/__tests__/composers.test.ts
git commit -m "feat(notifications): per-kind body composers (PRI-1744)"
```

---

### Task 3: `injectNotification` utility (failing test first)

**Files:**
- Create: `packages/agent/src/notifications/inject-notification.ts`
- Create: `packages/agent/src/notifications/index.ts`
- Create: `packages/agent/src/notifications/__tests__/inject-notification.test.ts`

- [ ] **Step 1:** Write the failing test:

```ts
// ABOUTME: Unit tests for injectNotification — writes context_injected event with
// ABOUTME: priority='immediate' and triggers idle-wake when targeting active session.

import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { injectNotification } from '../inject-notification';

function tempSessionDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'lace-inject-test-'));
  mkdirSync(root, { recursive: true });
  return root;
}

function readEventsJsonl(dir: string): Array<{ type: string; data: Record<string, unknown> }> {
  try {
    return readFileSync(join(dir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

describe('injectNotification', () => {
  it('appends a context_injected event with priority=immediate', () => {
    const dir = tempSessionDir();
    injectNotification({
      sessionDir: dir,
      kind: 'alarm-fired',
      identifiers: { 'alarm-id': 'alarm_abc' },
      body: 'fired',
    });
    const events = readEventsJsonl(dir);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('context_injected');
    expect((events[0].data as { priority?: string }).priority).toBe('immediate');
    const content = (events[0].data as { content: Array<{ text: string }> }).content;
    expect(content[0].text).toContain('<notification kind="alarm-fired" alarm-id="alarm_abc">');
    expect(content[0].text).toContain('fired');
  });

  it('triggers idle-wake when target is active and no turn is in flight', () => {
    const dir = tempSessionDir();
    const triggerInternalTurn = vi.fn();
    injectNotification({
      sessionDir: dir,
      kind: 'job-completed',
      identifiers: { 'job-id': 'job_x' },
      body: 'done',
      idleWake: {
        isActive: (d) => d === dir,
        hasActiveTurn: () => false,
        triggerInternalTurn,
      },
    });
    expect(triggerInternalTurn).toHaveBeenCalledTimes(1);
  });

  it('does NOT trigger idle-wake when a turn is in flight', () => {
    const dir = tempSessionDir();
    const triggerInternalTurn = vi.fn();
    injectNotification({
      sessionDir: dir,
      kind: 'job-progress',
      identifiers: { 'job-id': 'job_x' },
      body: 'running',
      idleWake: {
        isActive: (d) => d === dir,
        hasActiveTurn: () => true,
        triggerInternalTurn,
      },
    });
    expect(triggerInternalTurn).not.toHaveBeenCalled();
  });

  it('does NOT trigger idle-wake when target is not the active session', () => {
    const dir = tempSessionDir();
    const triggerInternalTurn = vi.fn();
    injectNotification({
      sessionDir: dir,
      kind: 'subagent-exited',
      identifiers: { 'subagent-session-id': 'sess_x' },
      body: 'gone',
      idleWake: {
        isActive: () => false,
        hasActiveTurn: () => false,
        triggerInternalTurn,
      },
    });
    expect(triggerInternalTurn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** Run; confirm FAIL.

- [ ] **Step 3:** Create `packages/agent/src/notifications/inject-notification.ts`:

```ts
// ABOUTME: injectNotification — the single utility for writing agent-facing
// ABOUTME: <notification> blocks into a session's events.jsonl as a context_injected
// ABOUTME: durable event with priority='immediate'. Optionally triggers an internal
// ABOUTME: turn when the target is the active session and the agent is idle.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendDurableEvent } from '../storage/event-log';
import type { SessionState } from '../storage/session-store';
import { buildNotification, type NotificationKind } from './notification-wrapper';

export interface IdleWakeHooks {
  /** Is `sessionDir` the current lace process's active session? */
  isActive: (sessionDir: string) => boolean;
  /** Is the agent currently in a turn? */
  hasActiveTurn: () => boolean;
  /** Kick the agent to run one internal turn so it picks up the just-written event. */
  triggerInternalTurn: () => void;
}

export interface InjectNotificationOptions {
  sessionDir: string;
  kind: NotificationKind;
  identifiers?: Record<string, string>;
  body: string;
  /** Optional — omit for cross-process writes (e.g. subagent → parent). */
  idleWake?: IdleWakeHooks;
}

function readSessionStateBestEffort(sessionDir: string): SessionState {
  try {
    const parsed = JSON.parse(readFileSync(join(sessionDir, 'state.json'), 'utf8')) as Partial<SessionState>;
    return {
      nextEventSeq: typeof parsed.nextEventSeq === 'number' ? parsed.nextEventSeq : 1,
      nextStreamSeq: typeof parsed.nextStreamSeq === 'number' ? parsed.nextStreamSeq : 1,
    };
  } catch {
    return { nextEventSeq: 1, nextStreamSeq: 1 };
  }
}

export function injectNotification(opts: InjectNotificationOptions): void {
  const text = buildNotification({ kind: opts.kind, ...(opts.identifiers ? { identifiers: opts.identifiers } : {}), body: opts.body });
  const state = readSessionStateBestEffort(opts.sessionDir);
  appendDurableEvent(opts.sessionDir, state, {
    type: 'context_injected',
    data: {
      content: [{ type: 'text', text }],
      priority: 'immediate',
    },
  });
  // We intentionally do not rewrite state.json: appendDurableEvent's nextState
  // is purely a sequence accounting; the runner's authoritative position is
  // recomputed via deriveNextEventSeqFromEventLog. For cross-process writes
  // (subagent → parent), the parent's process owns state.json and will
  // observe the new eventSeq on its next read.

  if (
    opts.idleWake &&
    opts.idleWake.isActive(opts.sessionDir) &&
    !opts.idleWake.hasActiveTurn()
  ) {
    opts.idleWake.triggerInternalTurn();
  }
}
```

- [ ] **Step 4:** Create `packages/agent/src/notifications/index.ts`:

```ts
export { buildNotification } from './notification-wrapper';
export type { NotificationKind } from './notification-wrapper';
export { injectNotification } from './inject-notification';
export type { InjectNotificationOptions, IdleWakeHooks } from './inject-notification';
export * from './composers';
```

- [ ] **Step 5:** Run; verify PASS. Commit.

```bash
npx vitest --run packages/agent/src/notifications/
git add packages/agent/src/notifications/
git commit -m "feat(notifications): injectNotification utility with idle-wake hook (PRI-1744)"
```

---

## Phase 2 — Conversation runner watermark fix

### Task 4: `findLastTurnEndEventSeq` helper

**Files:**
- Modify: `packages/agent/src/storage/event-log.ts`

- [ ] **Step 1:** Open `packages/agent/src/storage/event-log.ts`. After `deriveNextEventSeqFromEventLog` (around line 33), add:

```ts
/**
 * Find the eventSeq of the most recent `turn_end` event in the log, or `null`
 * if no turn has completed yet. Used by the conversation runner to compute its
 * initial immediate-inject watermark — any context_injected event newer than
 * the last turn_end is unprocessed.
 */
export function findLastTurnEndEventSeq(sessionDir: string): number | null {
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  let raw = '';
  try {
    raw = fs.readFileSync(eventsPath, 'utf8');
  } catch {
    return null;
  }
  let last: number | null = null;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Partial<DurableEvent>;
      if (parsed.type !== 'turn_end') continue;
      if (typeof parsed.eventSeq !== 'number') continue;
      if (last === null || parsed.eventSeq > last) last = parsed.eventSeq;
    } catch {
      // ignore malformed line
    }
  }
  return last;
}
```

- [ ] **Step 2:** Quick unit test in the existing `event-log` test file (find with `ls packages/agent/src/storage/__tests__/`); add:

```ts
it('findLastTurnEndEventSeq returns null on empty log and the latest turn_end seq otherwise', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lace-evt-'));
  expect(findLastTurnEndEventSeq(dir)).toBeNull();

  let state: SessionState = { nextEventSeq: 1, nextStreamSeq: 1 };
  ({ nextState: state } = appendDurableEvent(dir, state, { type: 'prompt', data: {} }));
  ({ nextState: state } = appendDurableEvent(dir, state, { type: 'turn_end', data: { stopReason: 'end_turn' } }));
  ({ nextState: state } = appendDurableEvent(dir, state, { type: 'context_injected', data: { priority: 'immediate', content: [] } }));
  expect(findLastTurnEndEventSeq(dir)).toBe(2);
});
```

(Adapt the import block to match the existing test file's helpers.)

- [ ] **Step 3:** Run; verify pass.

```bash
npx vitest --run packages/agent/src/storage/
```

- [ ] **Step 4:** Commit.

```bash
git add packages/agent/src/storage/event-log.ts packages/agent/src/storage/__tests__/
git commit -m "feat(events): findLastTurnEndEventSeq helper (PRI-1744)"
```

---

### Task 5: Runner uses `findLastTurnEndEventSeq` for initial watermark

**Files:**
- Modify: `packages/agent/src/core/conversation/runner.ts`
- Modify: `packages/agent/src/core/conversation/__tests__/runner.context-inject.test.ts`

- [ ] **Step 1:** Extend the existing runner test first. Open `packages/agent/src/core/conversation/__tests__/runner.context-inject.test.ts`, add a new test that:

1. Sets up a session dir with: prompt → turn_start → ... → turn_end (seq T).
2. Appends a `context_injected priority='immediate'` event at seq T+1 (representing a between-turn inject).
3. Writes a new prompt event at seq T+2 and starts `runner.run()` against it.
4. Asserts the provider received both the new prompt AND the injection from seq T+1 as `role: 'user'` messages.

(Pattern after the existing tests in the file. Use the same mock provider hooks.)

- [ ] **Step 2:** Run; confirm FAIL (current runner snapshots watermark at "latest" and misses the between-turn inject).

```bash
npx vitest --run packages/agent/src/core/conversation/__tests__/runner.context-inject.test.ts
```

- [ ] **Step 3:** Open `packages/agent/src/core/conversation/runner.ts` line 197. Change:

```ts
// BEFORE
let lastSeenEventSeq = deriveNextEventSeqFromEventLog(sessionDir) - 1;

// AFTER
let lastSeenEventSeq = findLastTurnEndEventSeq(sessionDir) ?? 0;
```

Add the import to the existing `findLastTurnEndEventSeq` from `'../../storage/event-log'`.

- [ ] **Step 4:** Run the new + all existing runner tests; verify all PASS.

```bash
npx vitest --run packages/agent/src/core/conversation/
```

- [ ] **Step 5:** Commit.

```bash
git add packages/agent/src/core/conversation/runner.ts packages/agent/src/core/conversation/__tests__/runner.context-inject.test.ts
git commit -m "fix(runner): pick up immediate context_injected events written between turns (PRI-1744)"
```

---

## Phase 3 — Alarm core (types, store, cron, scheduler)

### Task 6: Alarm types

**Files:**
- Create: `packages/agent/src/alarms/types.ts`

- [ ] **Step 1:** Create the file:

```ts
// ABOUTME: Alarm row shape persisted in alarms.json and the in-memory snapshot
// ABOUTME: format consumed by AlarmStore + AlarmScheduler.

export type AlarmKind = 'cron' | 'once';

export type AlarmStatus = 'pending' | 'firing' | 'fired' | 'cancelled';

export interface AlarmRow {
  id: string;            // alarm_<12hex>
  kind: AlarmKind;
  schedule: string;      // cron expr for cron, ISO-8601 for once
  timezone: string;
  prompt: string;
  status: AlarmStatus;
  next_fire_at: number;  // epoch ms
  created_at: number;    // epoch ms
  fired_at: number | null;
}

export interface AlarmsSnapshot {
  alarms: AlarmRow[];
}

export const MAX_ACTIVE_ALARMS = 50;
```

- [ ] **Step 2:** Commit.

```bash
git add packages/agent/src/alarms/types.ts
git commit -m "feat(alarms): row + snapshot types (PRI-1744)"
```

---

### Task 7: Port cron utilities into lace

**Files:**
- Create: `packages/agent/src/alarms/cron.ts`
- Create: `packages/agent/src/alarms/__tests__/cron.test.ts`

- [ ] **Step 1:** Copy `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2/src/alarms/cron.ts` to `packages/agent/src/alarms/cron.ts`. Replace the leading ABOUTME with:

```ts
// ABOUTME: Cron + one-shot fire-time math. Ported verbatim from sen-core-v2/src/alarms/cron.ts.
// ABOUTME: Exports computeNextCronFire, computeNextOnceFire, assertValidIanaTimezone, assertValidCronMinInterval.
```

Leave logic untouched. No internal imports to adjust.

- [ ] **Step 2:** Copy `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2/tests/automated/alarms/cron.test.ts` to `packages/agent/src/alarms/__tests__/cron.test.ts`. Adjust imports:

```ts
import {
  computeNextCronFire,
  computeNextOnceFire,
  assertValidIanaTimezone,
  assertValidCronMinInterval,
} from '../cron';
```

- [ ] **Step 3:** Run + commit.

```bash
npx vitest --run packages/agent/src/alarms/__tests__/cron.test.ts
git add packages/agent/src/alarms/cron.ts packages/agent/src/alarms/__tests__/cron.test.ts
git commit -m "feat(alarms): port cron utilities from sen-core (PRI-1744)"
```

---

### Task 8: AlarmStore (snapshot JSON, atomic rewrite)

**Files:**
- Create: `packages/agent/src/alarms/__tests__/alarm-store.test.ts`
- Create: `packages/agent/src/alarms/alarm-store.ts`

- [ ] **Step 1:** Failing test:

```ts
// ABOUTME: Unit tests for AlarmStore — single-snapshot JSON storage, in-memory mirror,
// ABOUTME: atomic rewrite via atomicWriteJson on every change, MAX_ACTIVE_ALARMS cap.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { AlarmStore } from '../alarm-store';
import { MAX_ACTIVE_ALARMS } from '../types';

function tempSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'lace-alarmstore-'));
}

describe('AlarmStore', () => {
  it('insert returns pending row and writes snapshot', () => {
    const dir = tempSessionDir();
    const s = new AlarmStore(dir);
    const row = s.insert({
      kind: 'once', schedule: '2030-01-01T00:00:00Z', timezone: 'UTC',
      prompt: 'p', next_fire_at: 1, now: 0,
    });
    expect(row.status).toBe('pending');
    const raw = JSON.parse(readFileSync(join(dir, 'alarms.json'), 'utf8'));
    expect(raw.alarms).toHaveLength(1);
    expect(raw.alarms[0].id).toBe(row.id);
  });

  it('rehydrates from snapshot', () => {
    const dir = tempSessionDir();
    const s1 = new AlarmStore(dir);
    s1.insert({ kind: 'once', schedule: '2030-01-01T00:00:00Z', timezone: 'UTC', prompt: 'p', next_fire_at: 1, now: 0 });
    const s2 = new AlarmStore(dir);
    expect(s2.listActive()).toHaveLength(1);
  });

  it('claim transitions pending → firing exactly once', () => {
    const dir = tempSessionDir();
    const s = new AlarmStore(dir);
    const row = s.insert({ kind: 'once', schedule: '2030-01-01T00:00:00Z', timezone: 'UTC', prompt: 'p', next_fire_at: 1, now: 0 });
    expect(s.claim(row.id)).toBe(true);
    expect(s.claim(row.id)).toBe(false);
    expect(s.get(row.id)?.status).toBe('firing');
  });

  it('cancel returns structured reasons', () => {
    const dir = tempSessionDir();
    const s = new AlarmStore(dir);
    expect(s.cancel('alarm_nope').cancelled).toBe(false);
    const row = s.insert({ kind: 'once', schedule: '2030-01-01T00:00:00Z', timezone: 'UTC', prompt: 'p', next_fire_at: 1, now: 0 });
    s.claim(row.id);
    const denied = s.cancel(row.id);
    expect(denied.cancelled).toBe(false);
    if (!denied.cancelled) expect(denied.reason).toBe('firing');
  });

  it('countActive enforces MAX_ACTIVE_ALARMS', () => {
    const dir = tempSessionDir();
    const s = new AlarmStore(dir);
    for (let i = 0; i < MAX_ACTIVE_ALARMS; i++) {
      s.insert({ kind: 'once', schedule: '2030-01-01T00:00:00Z', timezone: 'UTC', prompt: `p${i}`, next_fire_at: i, now: 0 });
    }
    expect(s.countActive()).toBe(MAX_ACTIVE_ALARMS);
  });

  it('repairFiringOnBoot demotes firing rows back to pending', () => {
    const dir = tempSessionDir();
    const s1 = new AlarmStore(dir);
    const row = s1.insert({ kind: 'once', schedule: '2030-01-01T00:00:00Z', timezone: 'UTC', prompt: 'p', next_fire_at: 1, now: 0 });
    s1.claim(row.id);
    const s2 = new AlarmStore(dir);
    s2.repairFiringOnBoot();
    expect(s2.get(row.id)?.status).toBe('pending');
  });
});
```

- [ ] **Step 2:** Run; confirm FAIL.

- [ ] **Step 3:** Create `packages/agent/src/alarms/alarm-store.ts`:

```ts
// ABOUTME: Per-session AlarmStore. Single alarms.json snapshot, atomically rewritten
// ABOUTME: on every change via atomicWriteJson. In-memory Map mirrors the snapshot.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { atomicWriteJson } from '../storage/atomic-write';
import type { AlarmKind, AlarmRow, AlarmsSnapshot } from './types';
import { MAX_ACTIVE_ALARMS } from './types';

export interface InsertAlarmArgs {
  kind: AlarmKind;
  schedule: string;
  timezone: string;
  prompt: string;
  next_fire_at: number;
  now: number;
}

export type CancelResult =
  | { cancelled: true }
  | { cancelled: false; reason: 'not_found' | 'already_fired' | 'already_cancelled' | 'firing' };

const FILE_NAME = 'alarms.json';

export class AlarmStore {
  private readonly path: string;
  private alarms = new Map<string, AlarmRow>();

  constructor(sessionDir: string) {
    mkdirSync(sessionDir, { recursive: true });
    this.path = join(sessionDir, FILE_NAME);
    this.load();
  }

  private load(): void {
    this.alarms.clear();
    if (!existsSync(this.path)) return;
    try {
      const snap = JSON.parse(readFileSync(this.path, 'utf8')) as AlarmsSnapshot;
      for (const row of snap.alarms) {
        if (typeof row.id !== 'string') continue;
        this.alarms.set(row.id, row);
      }
    } catch {
      // corrupted snapshot — treat as empty
    }
  }

  private persist(): void {
    const snap: AlarmsSnapshot = { alarms: [...this.alarms.values()] };
    atomicWriteJson(this.path, snap, { mode: 0o600 });
  }

  insert(args: InsertAlarmArgs): AlarmRow {
    const id = `alarm_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const row: AlarmRow = {
      id,
      kind: args.kind,
      schedule: args.schedule,
      timezone: args.timezone,
      prompt: args.prompt,
      status: 'pending',
      next_fire_at: args.next_fire_at,
      created_at: args.now,
      fired_at: null,
    };
    this.alarms.set(id, row);
    this.persist();
    return row;
  }

  get(id: string): AlarmRow | null {
    return this.alarms.get(id) ?? null;
  }

  claim(id: string): boolean {
    const row = this.alarms.get(id);
    if (!row || row.status !== 'pending') return false;
    this.alarms.set(id, { ...row, status: 'firing' });
    this.persist();
    return true;
  }

  markFired(id: string, firedAt: number): void {
    const row = this.alarms.get(id);
    if (!row) return;
    this.alarms.set(id, { ...row, status: 'fired', fired_at: firedAt });
    this.persist();
  }

  rescheduleCron(id: string, nextFireAt: number, firedAt: number): void {
    const row = this.alarms.get(id);
    if (!row) return;
    this.alarms.set(id, { ...row, status: 'pending', next_fire_at: nextFireAt, fired_at: firedAt });
    this.persist();
  }

  rescheduleStale(id: string, nextFireAt: number): void {
    const row = this.alarms.get(id);
    if (!row || row.status !== 'pending' || row.kind !== 'cron') return;
    this.alarms.set(id, { ...row, next_fire_at: nextFireAt });
    this.persist();
  }

  cancel(id: string): CancelResult {
    const row = this.alarms.get(id);
    if (!row) return { cancelled: false, reason: 'not_found' };
    if (row.status === 'fired') return { cancelled: false, reason: 'already_fired' };
    if (row.status === 'cancelled') return { cancelled: false, reason: 'already_cancelled' };
    if (row.status === 'firing') return { cancelled: false, reason: 'firing' };
    this.alarms.set(id, { ...row, status: 'cancelled' });
    this.persist();
    return { cancelled: true };
  }

  listActive(): AlarmRow[] {
    return [...this.alarms.values()]
      .filter((r) => r.status === 'pending' || r.status === 'firing')
      .sort((a, b) => a.next_fire_at - b.next_fire_at);
  }

  listPending(): AlarmRow[] {
    return [...this.alarms.values()]
      .filter((r) => r.status === 'pending')
      .sort((a, b) => a.next_fire_at - b.next_fire_at);
  }

  countActive(): number {
    return this.listActive().length;
  }

  soonestPending(): AlarmRow | null {
    return this.listPending()[0] ?? null;
  }

  staleRecurring(cutoff: number): AlarmRow[] {
    return [...this.alarms.values()]
      .filter((r) => r.status === 'pending' && r.kind === 'cron' && r.next_fire_at < cutoff)
      .sort((a, b) => a.next_fire_at - b.next_fire_at);
  }

  /** On boot, any 'firing' row is interpreted as "crashed mid-fire" and demoted to pending. */
  repairFiringOnBoot(): void {
    let changed = false;
    for (const [id, row] of this.alarms) {
      if (row.status === 'firing') {
        this.alarms.set(id, { ...row, status: 'pending' });
        changed = true;
      }
    }
    if (changed) this.persist();
  }
}

export { MAX_ACTIVE_ALARMS };
```

- [ ] **Step 4:** Run; verify PASS. Commit.

```bash
npx vitest --run packages/agent/src/alarms/__tests__/alarm-store.test.ts
git add packages/agent/src/alarms/alarm-store.ts packages/agent/src/alarms/__tests__/alarm-store.test.ts
git commit -m "feat(alarms): per-session AlarmStore with atomic JSON snapshot (PRI-1744)"
```

---

### Task 9: AlarmScheduler (per-process, single-session)

**Files:**
- Create: `packages/agent/src/alarms/__tests__/alarm-scheduler.test.ts`
- Create: `packages/agent/src/alarms/alarm-scheduler.ts`
- Create: `packages/agent/src/alarms/index.ts`

- [ ] **Step 1:** Failing test:

```ts
// ABOUTME: Unit tests for AlarmScheduler — fires due alarms, reschedules cron,
// ABOUTME: notify() wakes the loop, stale-recurring sweep on boot, calls injectNotification.

import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { AlarmScheduler } from '../alarm-scheduler';
import { AlarmStore } from '../alarm-store';

function setupDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lace-sched-'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('AlarmScheduler', () => {
  it('fires due one-shot and calls notifier', async () => {
    const sessionDir = setupDir();
    const store = new AlarmStore(sessionDir);
    store.insert({ kind: 'once', schedule: '2030-01-01T00:00:01Z', timezone: 'UTC', prompt: 'p', next_fire_at: 100, now: 0 });
    const notify = vi.fn();
    const sched = new AlarmScheduler({
      sessionDir,
      store,
      now: () => 1000,
      jitterMaxMs: 0,
      randomFn: () => 0,
      notifier: notify,
    });
    sched.bootRecover();
    await sched.tickForTest();
    expect(notify).toHaveBeenCalledTimes(1);
    const arg = notify.mock.calls[0][0];
    expect(arg.row.id).toMatch(/^alarm_/);
    expect(store.get(arg.row.id)?.status).toBe('fired');
  });

  it('cron reschedules to next jittered occurrence', async () => {
    const sessionDir = setupDir();
    const store = new AlarmStore(sessionDir);
    store.insert({ kind: 'cron', schedule: '0 9 * * *', timezone: 'UTC', prompt: 'p',
                   next_fire_at: Date.parse('2030-01-01T09:00:00Z'), now: 0 });
    const sched = new AlarmScheduler({
      sessionDir,
      store,
      now: () => Date.parse('2030-01-01T09:00:01Z'),
      jitterMaxMs: 0,
      randomFn: () => 0,
      notifier: vi.fn(),
    });
    sched.bootRecover();
    await sched.tickForTest();
    const pending = store.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].next_fire_at).toBe(Date.parse('2030-01-02T09:00:00Z'));
  });

  it('notify wakes the loop', () => {
    const sessionDir = setupDir();
    const sched = new AlarmScheduler({
      sessionDir,
      store: new AlarmStore(sessionDir),
      now: () => 0,
      jitterMaxMs: 0,
      randomFn: () => 0,
      notifier: vi.fn(),
    });
    const woken = vi.fn();
    sched.onNotifyForTest(woken);
    sched.notify();
    expect(woken).toHaveBeenCalled();
  });

  it('boot repairs firing → pending', () => {
    const sessionDir = setupDir();
    const store = new AlarmStore(sessionDir);
    const row = store.insert({ kind: 'once', schedule: '2030-01-01T00:00:00Z', timezone: 'UTC', prompt: 'p', next_fire_at: 1, now: 0 });
    store.claim(row.id);
    const sched = new AlarmScheduler({
      sessionDir,
      store,
      now: () => 0,
      jitterMaxMs: 0,
      randomFn: () => 0,
      notifier: vi.fn(),
    });
    sched.bootRecover();
    expect(store.get(row.id)?.status).toBe('pending');
  });
});
```

- [ ] **Step 2:** Run; confirm FAIL.

- [ ] **Step 3:** Create `packages/agent/src/alarms/alarm-scheduler.ts`:

```ts
// ABOUTME: Single-loop per-process alarm scheduler for one session. Owns the in-memory
// ABOUTME: min-heap of pending alarms; sleeps until due or notify(); fires through the
// ABOUTME: injected notifier (which calls injectNotification in production).

import { computeNextCronFire } from './cron';
import type { AlarmStore } from './alarm-store';
import type { AlarmRow } from './types';

const BACKSTOP_POLL_MS = 5000;
const STALENESS_WINDOW_MS = 60_000;

export interface SchedulerNotifierArg {
  row: AlarmRow;
  firedAt: number;
}

export interface SchedulerDependencies {
  sessionDir: string;
  store: AlarmStore;
  now: () => number;
  jitterMaxMs: number;
  notifier: (arg: SchedulerNotifierArg) => void;
  randomFn?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  onError?: (err: unknown) => void;
}

interface HeapEntry {
  alarmId: string;
  next_fire_at: number;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = (): void => {
      clearTimeout(t);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class AlarmScheduler {
  private readonly deps: Required<Omit<SchedulerDependencies, 'onError' | 'sleep' | 'randomFn'>> & {
    onError?: (e: unknown) => void;
    sleep: (ms: number, signal: AbortSignal) => Promise<void>;
    randomFn: () => number;
  };
  private heap: HeapEntry[] = [];
  private running = false;
  private stopController: AbortController | null = null;
  private wakeResolve: (() => void) | null = null;
  private testNotifyHook: (() => void) | null = null;

  constructor(deps: SchedulerDependencies) {
    this.deps = {
      sessionDir: deps.sessionDir,
      store: deps.store,
      now: deps.now,
      jitterMaxMs: deps.jitterMaxMs,
      notifier: deps.notifier,
      onError: deps.onError,
      sleep: deps.sleep ?? defaultSleep,
      randomFn: deps.randomFn ?? Math.random,
    };
  }

  /** Read snapshot, demote firing→pending, run stale-recurring sweep, populate heap. */
  bootRecover(): void {
    this.deps.store.repairFiringOnBoot();
    this.runStaleSweep();
    this.heap = this.deps.store.listPending().map((row) => ({ alarmId: row.id, next_fire_at: row.next_fire_at }));
    this.heap.sort((a, b) => a.next_fire_at - b.next_fire_at);
  }

  enqueue(row: AlarmRow): void {
    this.heap.push({ alarmId: row.id, next_fire_at: row.next_fire_at });
    this.heap.sort((a, b) => a.next_fire_at - b.next_fire_at);
    this.notify();
  }

  notify(): void {
    if (this.wakeResolve) {
      const r = this.wakeResolve;
      this.wakeResolve = null;
      r();
    }
    if (this.testNotifyHook) this.testNotifyHook();
  }

  onNotifyForTest(cb: () => void): void {
    this.testNotifyHook = cb;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.bootRecover();
    this.running = true;
    this.stopController = new AbortController();
    const signal = this.stopController.signal;
    try {
      while (!signal.aborted) {
        try {
          await this.tick(signal);
        } catch (err) {
          if (signal.aborted) break;
          this.deps.onError?.(err);
          try {
            await this.deps.sleep(BACKSTOP_POLL_MS, signal);
          } catch {
            break;
          }
        }
      }
    } finally {
      this.running = false;
      this.stopController = null;
      this.wakeResolve = null;
    }
  }

  async stop(): Promise<void> {
    this.stopController?.abort();
    this.notify();
  }

  async tickForTest(): Promise<void> {
    await this.tick(new AbortController().signal, { onceOnly: true });
  }

  private async tick(signal: AbortSignal, opts?: { onceOnly?: boolean }): Promise<void> {
    const soonest = this.heap[0];
    if (!soonest) {
      if (opts?.onceOnly) return;
      await this.sleepOrNotify(BACKSTOP_POLL_MS, signal);
      return;
    }
    const wait = soonest.next_fire_at - this.deps.now();
    if (wait > 0) {
      if (opts?.onceOnly) return;
      await this.sleepOrNotify(Math.min(wait, BACKSTOP_POLL_MS), signal);
      return;
    }
    this.heap.shift();
    this.fire(soonest);
  }

  private fire(entry: HeapEntry): void {
    const row = this.deps.store.get(entry.alarmId);
    if (!row) return;
    if (!this.deps.store.claim(row.id)) return;
    const firedAt = this.deps.now();
    this.deps.notifier({ row, firedAt });
    if (row.kind === 'once') {
      this.deps.store.markFired(row.id, firedAt);
      return;
    }
    try {
      const { jitteredMs } = computeNextCronFire({
        expr: row.schedule,
        timezone: row.timezone,
        after: new Date(firedAt),
        jitterMaxMs: this.deps.jitterMaxMs,
        randomFn: this.deps.randomFn,
      });
      this.deps.store.rescheduleCron(row.id, jitteredMs, firedAt);
      this.heap.push({ alarmId: row.id, next_fire_at: jitteredMs });
      this.heap.sort((a, b) => a.next_fire_at - b.next_fire_at);
    } catch (err) {
      this.deps.onError?.(err);
    }
  }

  private runStaleSweep(): void {
    const cutoff = this.deps.now() - STALENESS_WINDOW_MS;
    for (const row of this.deps.store.staleRecurring(cutoff)) {
      try {
        const { jitteredMs } = computeNextCronFire({
          expr: row.schedule,
          timezone: row.timezone,
          after: new Date(this.deps.now()),
          jitterMaxMs: this.deps.jitterMaxMs,
          randomFn: this.deps.randomFn,
        });
        this.deps.store.rescheduleStale(row.id, jitteredMs);
      } catch (err) {
        this.deps.onError?.(err);
      }
    }
  }

  private async sleepOrNotify(ms: number, signal: AbortSignal): Promise<void> {
    let resolveWake: (() => void) | null = null;
    const notified = new Promise<void>((resolve) => {
      resolveWake = resolve;
      this.wakeResolve = resolve;
    });
    try {
      await Promise.race([this.deps.sleep(ms, signal), notified]);
    } finally {
      if (this.wakeResolve === resolveWake) this.wakeResolve = null;
    }
  }
}
```

- [ ] **Step 4:** Create `packages/agent/src/alarms/index.ts`:

```ts
export * from './types';
export { AlarmStore } from './alarm-store';
export type { CancelResult, InsertAlarmArgs } from './alarm-store';
export { AlarmScheduler } from './alarm-scheduler';
export type { SchedulerDependencies, SchedulerNotifierArg } from './alarm-scheduler';
```

- [ ] **Step 5:** Run; verify PASS. Commit.

```bash
npx vitest --run packages/agent/src/alarms/
git add packages/agent/src/alarms/alarm-scheduler.ts packages/agent/src/alarms/__tests__/alarm-scheduler.test.ts packages/agent/src/alarms/index.ts
git commit -m "feat(alarms): per-process AlarmScheduler with single-session ownership (PRI-1744)"
```

---

## Phase 4 — SessionMeta.parent

### Task 10: Extend `SessionMeta` with optional `parent`

**Files:**
- Modify: `packages/agent/src/storage/session-store.ts`

- [ ] **Step 1:** Open `packages/agent/src/storage/session-store.ts`. Update `SessionMeta`:

```ts
export type SessionMeta = {
  sessionId: string;
  workDir: string;
  created: string;
  parent?: {
    sessionId: string;
    jobId: string;
    personaName?: string;
  };
};
```

Also change `function agentSessionsDir()` to `export function agentSessionsDir()`.

- [ ] **Step 2:** Typecheck.

```bash
npx tsc --noEmit -p packages/agent/tsconfig.json
```

- [ ] **Step 3:** Commit.

```bash
git add packages/agent/src/storage/session-store.ts
git commit -m "feat(session): add optional parent linkage to SessionMeta (PRI-1744)"
```

---

### Task 11: `session/new` accepts `parent`; subagent-spawn passes it

**Files:**
- Modify: `packages/ent-protocol/src/schemas/methods.ts`
- Modify: `packages/agent/src/rpc/handlers/session.ts`
- Modify: `packages/agent/src/jobs/subagent-job.ts`

- [ ] **Step 1:** In `packages/ent-protocol/src/schemas/methods.ts`, find `SessionNewParamsSchema` (around line 182). Add the optional field:

```ts
parent: z
  .object({
    sessionId: SessionIdSchema,
    jobId: NonEmptyStringSchema,
    personaName: z.string().optional(),
  })
  .strict()
  .optional(),
```

- [ ] **Step 2:** In `packages/agent/src/rpc/handlers/session.ts` `session/new` handler (around line 186), update the parsed-params type to include `parent?: {...}` matching the schema. After `writeSessionMeta(sessionDir, { sessionId, workDir: parsed.cwd, created })`, change to:

```ts
writeSessionMeta(sessionDir, {
  sessionId,
  workDir: parsed.cwd,
  created,
  ...(parsed.parent ? { parent: parsed.parent } : {}),
});
```

- [ ] **Step 3:** In `packages/agent/src/jobs/subagent-job.ts`, find the `sessionNew` call against the subagent process (around line 680 — the call that produces `created.sessionId`). Add `parent`:

```ts
const created = await peer.sendRequest('session/new', {
  cwd: ...,
  mcpServers: ...,
  ...(personaName ? { persona: personaName } : {}),
  parent: {
    sessionId: state.activeSession!.meta.sessionId,
    jobId: job.jobId,
    ...(personaName ? { personaName } : {}),
  },
});
```

If `personaName` isn't already in scope at this call site, locate it on the surrounding `job`/options (it's available where `spawnSubagent` is called — thread it through).

- [ ] **Step 4:** Run existing delegate tests.

```bash
npx vitest --run packages/agent/src/__tests__/agent-process.delegate.e2e.test.ts
```

- [ ] **Step 5:** Commit.

```bash
git add packages/ent-protocol/src/schemas/methods.ts packages/agent/src/rpc/handlers/session.ts packages/agent/src/jobs/subagent-job.ts
git commit -m "feat(subagent): persist parent linkage to subagent session meta (PRI-1744)"
```

---

## Phase 5 — Alarm tools

### Task 12: `schedule_alarm` tool (failing test first)

**Files:**
- Create: `packages/agent/src/tools/implementations/__tests__/schedule_alarm.test.ts`
- Create: `packages/agent/src/tools/implementations/schedule_alarm.ts`
- Modify: `packages/agent/src/tools/types.ts`

- [ ] **Step 1:** Extend `ToolContext` first. In `packages/agent/src/tools/types.ts`, add after the `jobManager?: JobManager;` line:

```ts
import type { AlarmScheduler } from '@lace/agent/alarms/alarm-scheduler';
// ...
  alarmScheduler?: AlarmScheduler;
  activeSessionId?: string;
  activeSessionDir?: string;
```

- [ ] **Step 2:** Failing test:

```ts
// ABOUTME: Unit tests for schedule_alarm tool — input validation, cap, success shape.

import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ScheduleAlarmTool } from '../schedule_alarm';
import { AlarmScheduler } from '../../../alarms/alarm-scheduler';
import { AlarmStore } from '../../../alarms/alarm-store';
import { writeSessionMeta } from '../../../storage/session-store';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'lace-sched-tool-'));
  const sessionId = 'sess_a';
  const sessionDir = join(root, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionMeta(sessionDir, { sessionId, workDir: '/tmp', created: new Date().toISOString() });
  const store = new AlarmStore(sessionDir);
  const scheduler = new AlarmScheduler({
    sessionDir, store,
    now: () => Date.parse('2030-01-01T00:00:00Z'),
    jitterMaxMs: 0, randomFn: () => 0,
    notifier: () => undefined,
  });
  return { sessionId, sessionDir, store, scheduler };
}

describe('schedule_alarm', () => {
  it('schedules a one-shot in the future', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { id: 't1', name: 'schedule_alarm', arguments: { kind: 'once', schedule: '2030-01-02T00:00:00Z', prompt: 'p' } },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    expect(result.status).toBe('completed');
    const body = JSON.parse(result.content[0].text);
    expect(body.id).toMatch(/^alarm_/);
    expect(body.next_fire_at_iso).toBe('2030-01-02T00:00:00.000Z');
  });

  it('rejects past one-shot', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { id: 't1', name: 'schedule_alarm', arguments: { kind: 'once', schedule: '2020-01-01T00:00:00Z', prompt: 'p' } },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    expect(result.status).toBe('failed');
  });

  it('rejects when cap is reached', async () => {
    const { sessionId, sessionDir, scheduler, store } = setup();
    for (let i = 0; i < 50; i++) {
      store.insert({ kind: 'once', schedule: '2030-01-02T00:00:00Z', timezone: 'UTC', prompt: `p${i}`,
                     next_fire_at: Date.parse('2030-01-02T00:00:00Z') + i, now: 0 });
    }
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { id: 't1', name: 'schedule_alarm', arguments: { kind: 'once', schedule: '2030-01-02T00:00:00Z', prompt: 'extra' } },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('50');
  });
});
```

- [ ] **Step 3:** Run; confirm FAIL.

- [ ] **Step 4:** Create `packages/agent/src/tools/implementations/schedule_alarm.ts`:

```ts
// ABOUTME: schedule_alarm tool — first-class lace alarm scheduling. Writes to the
// ABOUTME: calling session's alarms.json and registers with the in-process scheduler.

import { z } from 'zod';
import { Tool } from '../tool';
import {
  assertValidCronMinInterval,
  assertValidIanaTimezone,
  computeNextCronFire,
  computeNextOnceFire,
} from '../../alarms/cron';
import { MAX_ACTIVE_ALARMS } from '../../alarms/types';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const scheduleSchema = z
  .object({
    kind: z.enum(['cron', 'once']),
    schedule: z.string().min(1),
    prompt: z.string().min(1),
    timezone: z.string().optional(),
  })
  .strict();

function errorResult(text: string): ToolResult {
  return { status: 'failed', content: [{ type: 'text', text }] };
}

function jsonResult(body: Record<string, unknown>): ToolResult {
  return { status: 'completed', content: [{ type: 'text', text: JSON.stringify(body) }] };
}

export class ScheduleAlarmTool extends Tool {
  name = 'schedule_alarm';
  description =
    "Schedule an alarm that wakes you with a prompt at a future time. kind='cron' for recurring (e.g. '0 9 * * *', min interval 1 hour) or 'once' for an ISO-8601 timestamp in the future. timezone is an IANA name; required for cron. Up to 50 active alarms per session. Use list_alarms / cancel_alarm to manage. Alarms fire only while this lace process is alive.";
  schema = scheduleSchema;
  annotations: ToolAnnotations = {
    title: 'Schedule an alarm',
    safeInternal: true,
  };

  protected async executeValidated(
    args: z.infer<typeof scheduleSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { alarmScheduler, activeSessionId } = context;
    if (!alarmScheduler || !activeSessionId) {
      return errorResult('schedule_alarm requires alarmScheduler + activeSession in context');
    }

    const store = (alarmScheduler as unknown as { deps: { store: import('../../alarms/alarm-store').AlarmStore } }).deps.store;
    if (store.countActive() >= MAX_ACTIVE_ALARMS) {
      return errorResult('Cannot schedule alarm: at the cap of 50 active alarms. Cancel one with cancel_alarm first.');
    }

    const now = Date.now();
    const tz = args.timezone ?? 'UTC';
    let nextFireAt: number;
    try {
      if (args.kind === 'once') {
        if (args.timezone !== undefined) assertValidIanaTimezone(args.timezone);
        nextFireAt = computeNextOnceFire(args.schedule, now);
      } else {
        assertValidIanaTimezone(tz);
        assertValidCronMinInterval(args.schedule, tz);
        const { jitteredMs } = computeNextCronFire({
          expr: args.schedule,
          timezone: tz,
          after: new Date(now),
          jitterMaxMs: 0, // jitter applied at reschedule, not schedule
        });
        nextFireAt = jitteredMs;
      }
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const row = store.insert({
      kind: args.kind,
      schedule: args.schedule,
      timezone: tz,
      prompt: args.prompt,
      next_fire_at: nextFireAt,
      now,
    });
    alarmScheduler.enqueue(row);

    return jsonResult({
      id: row.id,
      kind: row.kind,
      schedule: row.schedule,
      prompt: row.prompt,
      timezone: row.timezone,
      next_fire_at_iso: new Date(row.next_fire_at).toISOString(),
    });
  }
}
```

Note: the access pattern `(alarmScheduler as unknown as { deps: { store } }).deps.store` is a code smell — fix by exposing a public accessor on `AlarmScheduler`:

```ts
// Add to AlarmScheduler:
get store(): AlarmStore { return this.deps.store; }
```

Adjust the tool to use `alarmScheduler.store` instead of the cast.

- [ ] **Step 5:** Run; verify PASS. Commit.

```bash
npx vitest --run packages/agent/src/tools/implementations/__tests__/schedule_alarm.test.ts
git add packages/agent/src/tools/types.ts packages/agent/src/tools/implementations/schedule_alarm.ts packages/agent/src/tools/implementations/__tests__/schedule_alarm.test.ts packages/agent/src/alarms/alarm-scheduler.ts
git commit -m "feat(tools): schedule_alarm built-in (PRI-1744)"
```

---

### Task 13: `cancel_alarm` tool

**Files:**
- Create: `packages/agent/src/tools/implementations/cancel_alarm.ts`
- Create: `packages/agent/src/tools/implementations/__tests__/cancel_alarm.test.ts`

- [ ] **Step 1:** Failing test:

```ts
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { CancelAlarmTool } from '../cancel_alarm';
import { ScheduleAlarmTool } from '../schedule_alarm';
import { AlarmScheduler } from '../../../alarms/alarm-scheduler';
import { AlarmStore } from '../../../alarms/alarm-store';
import { writeSessionMeta } from '../../../storage/session-store';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'lace-cancel-'));
  const sessionId = 'sess_a';
  const sessionDir = join(root, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionMeta(sessionDir, { sessionId, workDir: '/tmp', created: new Date().toISOString() });
  const store = new AlarmStore(sessionDir);
  const scheduler = new AlarmScheduler({ sessionDir, store, now: () => Date.parse('2030-01-01T00:00:00Z'), jitterMaxMs: 0, randomFn: () => 0, notifier: () => undefined });
  return { sessionId, sessionDir, scheduler };
}

describe('cancel_alarm', () => {
  it('cancels a pending alarm', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const sched = new ScheduleAlarmTool();
    const res = await sched.execute(
      { id: 't1', name: 'schedule_alarm', arguments: { kind: 'once', schedule: '2030-01-02T00:00:00Z', prompt: 'p' } },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    const id = JSON.parse(res.content[0].text).id;
    const cancel = new CancelAlarmTool();
    const cres = await cancel.execute(
      { id: 't2', name: 'cancel_alarm', arguments: { id } },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    expect(JSON.parse(cres.content[0].text).cancelled).toBe(true);
  });

  it('returns not_found for unknown id', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const cancel = new CancelAlarmTool();
    const cres = await cancel.execute(
      { id: 't3', name: 'cancel_alarm', arguments: { id: 'alarm_zzz' } },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    const body = JSON.parse(cres.content[0].text);
    expect(body.cancelled).toBe(false);
    expect(body.reason).toBe('not_found');
  });
});
```

- [ ] **Step 2:** Run; fail.

- [ ] **Step 3:** Create `packages/agent/src/tools/implementations/cancel_alarm.ts`:

```ts
// ABOUTME: cancel_alarm tool — cancels a pending alarm by id in the calling session.

import { z } from 'zod';
import { Tool } from '../tool';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const cancelSchema = z.object({ id: z.string().min(1) }).strict();

export class CancelAlarmTool extends Tool {
  name = 'cancel_alarm';
  description =
    'Cancel a pending alarm by id. Returns cancelled:true on success, or cancelled:false with a reason (not_found, already_fired, already_cancelled, firing).';
  schema = cancelSchema;
  annotations: ToolAnnotations = {
    title: 'Cancel an alarm',
    destructiveHint: true,
    safeInternal: true,
  };

  protected async executeValidated(
    args: z.infer<typeof cancelSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { alarmScheduler } = context;
    if (!alarmScheduler) {
      return { status: 'failed', content: [{ type: 'text', text: 'cancel_alarm requires alarmScheduler in context' }] };
    }
    const result = alarmScheduler.store.cancel(args.id);
    return await Promise.resolve({ status: 'completed', content: [{ type: 'text', text: JSON.stringify(result) }] });
  }
}
```

- [ ] **Step 4:** Run + commit.

```bash
npx vitest --run packages/agent/src/tools/implementations/__tests__/cancel_alarm.test.ts
git add packages/agent/src/tools/implementations/cancel_alarm.ts packages/agent/src/tools/implementations/__tests__/cancel_alarm.test.ts
git commit -m "feat(tools): cancel_alarm built-in (PRI-1744)"
```

---

### Task 14: `list_alarms` tool

**Files:**
- Create: `packages/agent/src/tools/implementations/list_alarms.ts`
- Create: `packages/agent/src/tools/implementations/__tests__/list_alarms.test.ts`

- [ ] **Step 1:** Failing test:

```ts
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ListAlarmsTool } from '../list_alarms';
import { ScheduleAlarmTool } from '../schedule_alarm';
import { AlarmScheduler } from '../../../alarms/alarm-scheduler';
import { AlarmStore } from '../../../alarms/alarm-store';
import { writeSessionMeta } from '../../../storage/session-store';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'lace-list-'));
  const sessionId = 'sess_a';
  const sessionDir = join(root, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionMeta(sessionDir, { sessionId, workDir: '/tmp', created: new Date().toISOString() });
  const store = new AlarmStore(sessionDir);
  const scheduler = new AlarmScheduler({ sessionDir, store, now: () => Date.parse('2030-01-01T00:00:00Z'), jitterMaxMs: 0, randomFn: () => 0, notifier: () => undefined });
  return { sessionId, sessionDir, scheduler };
}

describe('list_alarms', () => {
  it('returns pending alarms sorted by next_fire_at', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const sched = new ScheduleAlarmTool();
    await sched.execute(
      { id: 't1', name: 'schedule_alarm', arguments: { kind: 'once', schedule: '2030-01-03T00:00:00Z', prompt: 'b' } },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    await sched.execute(
      { id: 't2', name: 'schedule_alarm', arguments: { kind: 'once', schedule: '2030-01-02T00:00:00Z', prompt: 'a' } },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    const list = new ListAlarmsTool();
    const res = await list.execute(
      { id: 't3', name: 'list_alarms', arguments: {} },
      { signal: new AbortController().signal, alarmScheduler: scheduler, activeSessionId: sessionId, activeSessionDir: sessionDir }
    );
    const body = JSON.parse(res.content[0].text);
    expect(body.alarms.map((a: { prompt: string }) => a.prompt)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2:** Run; fail.

- [ ] **Step 3:** Create `packages/agent/src/tools/implementations/list_alarms.ts`:

```ts
// ABOUTME: list_alarms tool — returns active alarms for the calling session.

import { z } from 'zod';
import { Tool } from '../tool';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const listSchema = z.object({}).strict();

export class ListAlarmsTool extends Tool {
  name = 'list_alarms';
  description = 'List active alarms (pending or firing) for the current session, ordered by next_fire_at ascending.';
  schema = listSchema;
  annotations: ToolAnnotations = {
    title: 'List alarms',
    readOnlyHint: true,
    readOnlySafe: true,
    safeInternal: true,
  };

  protected async executeValidated(
    _args: z.infer<typeof listSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { alarmScheduler } = context;
    if (!alarmScheduler) {
      return { status: 'failed', content: [{ type: 'text', text: 'list_alarms requires alarmScheduler in context' }] };
    }
    const rows = alarmScheduler.store.listActive();
    const alarms = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      schedule: r.schedule,
      prompt: r.prompt,
      timezone: r.timezone,
      status: r.status,
      next_fire_at_iso: new Date(r.next_fire_at).toISOString(),
      created_at_iso: new Date(r.created_at).toISOString(),
    }));
    return await Promise.resolve({ status: 'completed', content: [{ type: 'text', text: JSON.stringify({ alarms }) }] });
  }
}
```

- [ ] **Step 4:** Run + commit.

```bash
npx vitest --run packages/agent/src/tools/implementations/__tests__/list_alarms.test.ts
git add packages/agent/src/tools/implementations/list_alarms.ts packages/agent/src/tools/implementations/__tests__/list_alarms.test.ts
git commit -m "feat(tools): list_alarms built-in (PRI-1744)"
```

---

### Task 15: Register alarm tools as built-ins

**Files:**
- Modify: `packages/agent/src/tools/executor.ts`
- Modify: `packages/agent/src/tools/implementations/index.ts`

- [ ] **Step 1:** Add to `LACE_BUILTIN_TOOL_NAMES` (line 48) the three new names:

```ts
export const LACE_BUILTIN_TOOL_NAMES = [
  'bash',
  'file_read',
  'file_write',
  'file_edit',
  'ripgrep_search',
  'file_find',
  'url_fetch',
  'delegate',
  'job_output',
  'jobs_list',
  'job_kill',
  'job_notify',
  'todo_read',
  'todo_write',
  'use_skill',
  'schedule_alarm',
  'cancel_alarm',
  'list_alarms',
] as const;
```

- [ ] **Step 2:** Find the registration call in `executor.ts` (search for `registerAllAvailableTools` or `registerTool(new JobNotifyTool`). Add the three new tools to the same pattern.

- [ ] **Step 3:** Export from `packages/agent/src/tools/implementations/index.ts`:

```ts
export { ScheduleAlarmTool } from './schedule_alarm';
export { CancelAlarmTool } from './cancel_alarm';
export { ListAlarmsTool } from './list_alarms';
```

- [ ] **Step 4:** Typecheck + run all tool tests.

```bash
npx tsc --noEmit -p packages/agent/tsconfig.json
npx vitest --run packages/agent/src/tools/
```

- [ ] **Step 5:** Commit.

```bash
git add packages/agent/src/tools/executor.ts packages/agent/src/tools/implementations/index.ts
git commit -m "feat(tools): register alarm tools as lace built-ins (PRI-1744)"
```

---

## Phase 6 — Server wiring

### Task 16: Add `alarmScheduler` to `AgentServerState`; wire in `server.ts`

**Files:**
- Modify: `packages/agent/src/server-types.ts`
- Modify: `packages/agent/src/server.ts`

- [ ] **Step 1:** In `packages/agent/src/server-types.ts`, locate `AgentServerState` and add:

```ts
import type { AlarmScheduler } from './alarms/alarm-scheduler';
// inside AgentServerState:
alarmScheduler?: AlarmScheduler;
```

It's optional so the field can be lazy-initialized on first session activation (a fresh server before any session has no scheduler yet).

- [ ] **Step 2:** In `packages/agent/src/server.ts`, after `state.activeSession = ...` assignments in session activation paths (within `rpc/handlers/session.ts` — but the scheduler must live in `server.ts` scope so it can reuse `runExclusive` / `emitSessionUpdate`):

A cleaner placement: instantiate the scheduler in `activateStoredSession` and `session/new` handlers (in `rpc/handlers/session.ts`) right after `state.activeSession` is set. Each lace process has exactly one active session at a time; replacing it on session switch is fine (today's lace doesn't really session-switch within a process, but the code defends against it).

Implement a helper in `server.ts`:

```ts
import { AlarmScheduler } from './alarms/alarm-scheduler';
import { AlarmStore } from './alarms/alarm-store';
import { injectNotification, composeAlarmFiredBody } from './notifications';

function ensureAlarmSchedulerForActiveSession(
  state: AgentServerState,
  runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null }
): void {
  if (!state.activeSession) return;
  if (state.alarmScheduler) {
    void state.alarmScheduler.stop();
  }
  const sessionDir = state.activeSession.dir;
  const sessionId = state.activeSession.meta.sessionId;
  const store = new AlarmStore(sessionDir);
  state.alarmScheduler = new AlarmScheduler({
    sessionDir,
    store,
    now: () => Date.now(),
    jitterMaxMs: Number(process.env.LACE_ALARM_JITTER_MS ?? 60_000),
    notifier: ({ row, firedAt }) => {
      injectNotification({
        sessionDir,
        kind: 'alarm-fired',
        identifiers: { 'alarm-id': row.id },
        body: composeAlarmFiredBody({
          kind: row.kind,
          schedule: row.schedule,
          timezone: row.timezone,
          prompt: row.prompt,
        }),
        idleWake: {
          isActive: (d) => d === state.activeSession?.dir,
          hasActiveTurn: () => !!state.activeTurn,
          triggerInternalTurn: () => {
            if (runPromptInternalRef.current) {
              setImmediate(() => {
                if (!state.activeTurn && state.activeSession && runPromptInternalRef.current) {
                  void runPromptInternalRef.current([]);
                }
              });
            }
          },
        },
      });
      void firedAt;
    },
  });
  void state.alarmScheduler.start();
}
```

Export `ensureAlarmSchedulerForActiveSession`. Call it from `session/new`, `activateStoredSession`, and (defensively) `session/load` and `session/resume` after `state.activeSession` is set.

- [ ] **Step 3:** Thread `alarmScheduler`, `activeSessionId`, `activeSessionDir` into ToolContext. Locate every place ToolContext is built (`grep -rn "signal: AbortSignal" packages/agent/src/ --include="*.ts" | grep -v test | grep ToolContext` or search for `jobManager: state.jobManager`). At each build site, add:

```ts
alarmScheduler: state.alarmScheduler,
...(state.activeSession ? {
  activeSessionId: state.activeSession.meta.sessionId,
  activeSessionDir: state.activeSession.dir,
} : {}),
```

- [ ] **Step 4:** Add a shutdown hook in `server.ts` — when the lace process receives SIGTERM or stdin closes (whichever path the server uses today; search for `process.on('SIGTERM'`, `peer.onClose`, or the existing shutdown sequence), call:

```ts
async function shutdownAlarms(state: AgentServerState): Promise<void> {
  if (state.alarmScheduler) {
    await state.alarmScheduler.stop();
  }
}
```

The subagent-exit-bubble step (Task 18) hangs off this shutdown.

- [ ] **Step 5:** Run all agent tests.

```bash
npx vitest --run packages/agent/src/
```

- [ ] **Step 6:** Commit.

```bash
git add packages/agent/src/server-types.ts packages/agent/src/server.ts packages/agent/src/rpc/handlers/session.ts
git commit -m "feat(server): wire AlarmScheduler per active session (PRI-1744)"
```

---

### Task 17: Subagent graceful-exit courtesy bubble

**Files:**
- Modify: `packages/agent/src/server.ts` (the shutdown path)

- [ ] **Step 1:** Extend the shutdown sequence so, before exit, it:

1. Calls `state.alarmScheduler?.stop()` (already from Task 16).
2. Re-reads `state.activeSession.dir`/`alarms.json` for pending alarms.
3. Reads `state.activeSession.meta.parent`. If present AND there are pending alarms, calls `injectNotification` against the parent's session dir with `kind='subagent-exited'`.

```ts
async function emitSubagentExitedIfNeeded(state: AgentServerState): Promise<void> {
  if (!state.activeSession) return;
  const meta = state.activeSession.meta;
  if (!meta.parent) return;
  const store = new AlarmStore(state.activeSession.dir);
  const pending = store.listPending();
  if (pending.length === 0) return;

  const parentDir = join(agentSessionsDir(), meta.parent.sessionId);
  injectNotification({
    sessionDir: parentDir,
    kind: 'subagent-exited',
    identifiers: {
      'subagent-session-id': meta.sessionId,
      'job-id': meta.parent.jobId,
      persona: meta.parent.personaName ?? '',
    },
    body: composeSubagentExitedBody({
      persona: meta.parent.personaName ?? '',
      pendingAlarms: pending.map((r) => ({
        id: r.id, kind: r.kind, schedule: r.schedule, prompt: r.prompt,
      })),
    }),
    // No idleWake — we're writing to a different process's session.
  });
}
```

Call sequence at shutdown:

```ts
await state.alarmScheduler?.stop();
await emitSubagentExitedIfNeeded(state);
// ... then exit
```

Crash exit path (uncaught exception, SIGKILL) does NOT call this. Only the graceful shutdown handler does. Verify by searching for the existing graceful-shutdown call site (look for SIGTERM/SIGINT handler in `server.ts`).

- [ ] **Step 2:** Commit.

```bash
git add packages/agent/src/server.ts
git commit -m "feat(alarms): subagent graceful-exit notifies parent of pending alarms (PRI-1744)"
```

---

## Phase 7 — Refactor job notifications into the new shape

### Task 18: Rewrite `createQueueJobNotification` to use `injectNotification`

**Files:**
- Modify: `packages/agent/src/jobs/job-notifications.ts`
- Modify: `packages/agent/src/jobs/job-manager.ts`

- [ ] **Step 1:** Open `packages/agent/src/jobs/job-notifications.ts`. The function `createQueueJobNotification` currently composes content via `formatJobNotification` and pushes onto `state.jobManager.notificationQueue` (with a fallback fanout). Rewrite it to compose the body via the new composers and call `injectNotification`:

```ts
import { injectNotification } from '../notifications/inject-notification';
import {
  composeJobCompletedBody,
  composeJobFailedBody,
  composeJobCancelledBody,
  composeJobProgressBody,
} from '../notifications/composers';
import type { NotificationKind } from '../notifications/notification-wrapper';

function jobTypeToKind(type: 'completed' | 'failed' | 'cancelled' | 'progress'): NotificationKind {
  switch (type) {
    case 'completed': return 'job-completed';
    case 'failed': return 'job-failed';
    case 'cancelled': return 'job-cancelled';
    case 'progress': return 'job-progress';
  }
}

export function createQueueJobNotification(
  state: AgentServerState,
  runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null }
) {
  return (job: JobState, type: JobNotificationType, options?: { reason?: string; deltaBytes?: number }) => {
    if (!state.activeSession) return;
    const outputBytes = existsSync(job.outputPath) ? statSync(job.outputPath).size : 0;
    const durationMs = Date.now() - new Date(job.startedAt).getTime();
    const lastLineCount = job.type === 'delegate' ? 8 : type === 'completed' ? 1 : 3;
    const lastLines = getLastLines(job.outputPath, lastLineCount);

    let body: string;
    switch (type) {
      case 'completed':
        body = composeJobCompletedBody({
          jobId: job.jobId,
          jobType: job.type,
          exitCode: job.exitCode ?? 0,
          durationMs,
          outputBytes,
          lastLines,
        });
        break;
      case 'failed':
        body = composeJobFailedBody({
          jobId: job.jobId,
          jobType: job.type,
          exitCode: job.exitCode ?? -1,
          durationMs,
          outputBytes,
          lastLines,
        });
        break;
      case 'cancelled':
        body = composeJobCancelledBody({
          jobId: job.jobId,
          jobType: job.type,
          durationMs,
          outputBytes,
          lastLines,
          ...(options?.reason ? { reason: options.reason } : {}),
        });
        break;
      case 'progress':
        body = composeJobProgressBody({
          jobId: job.jobId,
          durationMs,
          outputBytes,
          deltaBytes: options?.deltaBytes ?? 0,
          lastLines,
        });
        break;
    }

    // Fan out — subscriptions still gate WHO gets notified. If a subscription
    // exists for this jobId, we still call injectNotification once for the
    // active session (the parent that subscribed). With no subscription, we
    // fall back to the always-on path.
    state.jobManager.fanoutToInject(job.jobId, type, () => {
      injectNotification({
        sessionDir: state.activeSession!.dir,
        kind: jobTypeToKind(type),
        identifiers: { 'job-id': job.jobId },
        body,
        idleWake: {
          isActive: (d) => d === state.activeSession?.dir,
          hasActiveTurn: () => !!state.activeTurn,
          triggerInternalTurn: () => {
            if (runPromptInternalRef.current) {
              setImmediate(() => {
                if (!state.activeTurn && state.activeSession && runPromptInternalRef.current) {
                  void runPromptInternalRef.current([]);
                }
              });
            }
          },
        },
      });
    });
  };
}
```

- [ ] **Step 2:** In `packages/agent/src/jobs/job-manager.ts`: replace the `fanout(...)` method that consumed `(notification, fallback)` with `fanoutToInject(jobId, kind, inject)` — keeping the same subscription gating but calling `inject` instead of pushing onto the queue. Delete `notificationQueue`, `queueNotification`, `getNotificationQueue`, `flushNotifications`, `progressBatches`, and the `PendingJobNotification` type (and its export). The progress-batch coalescing (200 ms window) should be preserved, just calling `inject` at flush time instead of `queue.push`.

The cleanest path: rename `fanout` to `fanoutToInject`, change the per-subscription delivery body to call the `inject` callback, and drop the queue infrastructure entirely. The batch-flush helper (`flushProgressBatch`) flips to calling `inject(...)` instead of pushing onto the queue.

- [ ] **Step 3:** Remove `getNotificationQueue` / `flushNotifications` from the `JobManager` API surface. Update the test files that mock these (`runner.test.ts`, `runner.permission-cancelled.test.ts`, etc.) to drop them from the mock.

- [ ] **Step 4:** Run job tests.

```bash
npx vitest --run packages/agent/src/jobs/
```

If existing tests reference `formatJobNotification` directly, port them to compare against composer output (or migrate the test to the composer test file in Phase 1).

- [ ] **Step 5:** Commit.

```bash
git add packages/agent/src/jobs/job-notifications.ts packages/agent/src/jobs/job-manager.ts
git add packages/agent/src/core/conversation/__tests__/*.test.ts
git commit -m "refactor(jobs): route notifications through injectNotification (PRI-1744)"
```

---

### Task 19: Delete the old format-notification module + prompt-injection prepend

**Files:**
- Delete: `packages/agent/src/jobs/format-notification.ts`
- Delete: `packages/agent/src/jobs/__tests__/format-notification.test.ts` (if present)
- Modify: `packages/agent/src/jobs/index.ts` (drop the export)
- Modify: `packages/agent/src/rpc/handlers/prompt.ts:102-111`

- [ ] **Step 1:**

```bash
git rm packages/agent/src/jobs/format-notification.ts
# only if it exists:
git ls-files packages/agent/src/jobs/__tests__/format-notification.test.ts && git rm packages/agent/src/jobs/__tests__/format-notification.test.ts
```

- [ ] **Step 2:** Open `packages/agent/src/jobs/index.ts`, remove `export * from './format-notification';` (or named export). Search-and-fix any imports across the codebase:

```bash
grep -rn "format-notification\|formatJobNotification" packages/agent/src --include="*.ts"
```

Any remaining references must be removed (likely just doc comments in `job_notify.ts`).

- [ ] **Step 3:** Open `packages/agent/src/rpc/handlers/prompt.ts`. Delete lines 102-111 (the `flushNotifications` prepend block) and tidy `promptContent` typing. The prompt content is now just `parsed.content`.

- [ ] **Step 4:** Update `job_notify.ts`'s description string to drop the `<background-job-notification>` reference. Replace with the new shape, e.g.:

```ts
description = `...lace will deliver a <notification kind="job-completed"|"job-failed"|"job-cancelled"|"job-progress" job-id="..."> block on your next turn when the job transitions...`;
```

- [ ] **Step 5:** Search for any test that asserts on `<background-job-notification>` and update it to assert on `<notification kind="job-...">`:

```bash
grep -rn "background-job-notification" packages/agent --include="*.ts" --include="*.test.ts"
```

- [ ] **Step 6:** Run full agent test suite.

```bash
npx vitest --run packages/agent/src/
```

- [ ] **Step 7:** Commit.

```bash
git add -u
git commit -m "refactor(jobs): drop format-notification + prompt-injection prepend (PRI-1744)"
```

---

## Phase 8 — Lace integration tests

These tests use the existing e2e harness. Inspect `packages/agent/src/__tests__/agent-process.e2e.test.ts` and `agent-process.async-workflow.e2e.test.ts` for the boot pattern: spawn the agent binary as a child, attach a JsonRpcPeer over stdio, drive prompts, capture `session/update` notifications. For fake-clock tests, follow the pattern already in unit tests (inject `now`/`sleep` via the AlarmScheduler dependencies — for e2e the scheduler runs against the real clock unless you build a small env-var override).

### Task 20: e2e — alarm fire delivery

**Files:**
- Create: `packages/agent/src/__tests__/alarms.fire-delivery.e2e.test.ts`

- [ ] **Step 1:** Implement the test:

```ts
// ABOUTME: e2e — schedule a one-shot alarm with a near-future fire, advance the
// ABOUTME: real clock briefly, verify <notification kind="alarm-fired"> lands as a
// ABOUTME: context_injected event AND that the next prompt's provider call sees it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startAgentE2E } from './e2e-harness';  // helper from existing tests; adapt names
// (Use the harness functions actually exported from existing e2e tests — likely
// startTestAgent or createAgentTestHarness. Adapt accordingly.)

describe('alarms e2e — fire delivery', () => {
  it('appends context_injected and runner picks it up on next turn', async () => {
    const env = await startAgentE2E({ /* enable mocked provider */ });
    await env.peer.sendRequest('session/prompt', {
      content: [{ type: 'text', text: `Call schedule_alarm with kind=once, schedule=${new Date(Date.now() + 1500).toISOString()}, prompt="ping".` }],
    });
    // Wait ~2.5s for the alarm to fire.
    await new Promise((r) => setTimeout(r, 2500));

    const events = readFileSync(join(env.sessionDir, 'events.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const injected = events.filter((e) => e.type === 'context_injected' && e.data?.priority === 'immediate');
    expect(injected.length).toBeGreaterThan(0);
    const text = (injected[injected.length - 1].data.content[0] as { text: string }).text;
    expect(text).toContain('<notification kind="alarm-fired"');
    expect(text).toContain('ping');

    await env.close();
  });
});
```

The mocked provider should be set up to echo a single text turn so we can observe the conversation runner picking up the injection.

- [ ] **Step 2:** Run + commit.

```bash
npx vitest --run packages/agent/src/__tests__/alarms.fire-delivery.e2e.test.ts
git add packages/agent/src/__tests__/alarms.fire-delivery.e2e.test.ts
git commit -m "test(alarms): e2e fire delivery via context_injected (PRI-1744)"
```

---

### Task 21: e2e — idle wake

**Files:**
- Create: `packages/agent/src/__tests__/alarms.idle-wake.e2e.test.ts`

- [ ] **Step 1:** Schedule an alarm; let the agent finish the scheduling turn and go idle; advance the clock past fire time; verify an internal turn fires (visible because a new `turn_start` event appears in events.jsonl without an external prompt).

- [ ] **Step 2:** Run + commit.

---

### Task 22: e2e — restart recovery

**Files:**
- Create: `packages/agent/src/__tests__/alarms.restart-recovery.e2e.test.ts`

- [ ] **Step 1:** Schedule alarm with fire time ~60s out; close the agent process; restart with the same LACE_DIR; advance clock; verify alarm still fires (boot loads `alarms.json`).

- [ ] **Step 2:** Run + commit.

---

### Task 23: e2e — cron reschedule

**Files:**
- Create: `packages/agent/src/__tests__/alarms.cron-reschedule.e2e.test.ts`

- [ ] **Step 1:** Schedule a cron `* * * * *` (every minute, but disable the 1-hour min-interval check for this test via `LACE_ALARM_JITTER_MS=0` and a test-only schedule). Advance time over two fire boundaries; assert two `<notification kind="alarm-fired">` events.

If the 1-hour min-interval check can't be bypassed in production code, write this test against `AlarmScheduler` directly (not e2e) with fake clock. Acceptable — the cron reschedule logic is unit-testable in Task 9 already.

- [ ] **Step 2:** Run + commit.

---

### Task 24: e2e — subagent graceful exit with pending alarms

**Files:**
- Create: `packages/agent/src/__tests__/alarms.subagent-exit-graceful.e2e.test.ts`

- [ ] **Step 1:** Use the delegate harness (pattern from `agent-process.delegate.e2e.test.ts`):

1. Spawn subagent S via `delegate`.
2. From S, call `schedule_alarm({ kind: 'once', schedule: <far future>, prompt: 'ping' })`.
3. Gracefully end the delegate (the harness's existing close/cancel path — confirm it triggers the subagent's graceful shutdown handler, not a kill).
4. Verify parent's `events.jsonl` gets a `context_injected priority='immediate'` event whose content includes `<notification kind="subagent-exited"`, `subagent-session-id="<S>"`, and the pending alarm description.

- [ ] **Step 2:** Run + commit.

---

### Task 25: e2e — subagent graceful exit with no pending alarms

**Files:**
- Create: `packages/agent/src/__tests__/alarms.subagent-exit-no-pending.e2e.test.ts`

- [ ] **Step 1:** Same as Task 24 but without scheduling an alarm. Verify NO `subagent-exited` notification appears in the parent's events.jsonl.

- [ ] **Step 2:** Run + commit.

---

## Phase 9 — Sen-core changes

Switch to the sen-core repo:

```bash
cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2
git checkout -b pri-1744-alarms-in-lace
```

### Task 26: Delete sen-core alarm modules

**Files:**
- Delete: `src/alarms/store.ts`
- Delete: `src/alarms/scheduler-service.ts`
- Delete: `src/alarms/tools.ts`
- Delete: `src/alarms/cron.ts`
- Delete: `src/alarms/types.ts`
- Delete: `mcp-servers/scheduler.ts`
- Delete: `tests/automated/alarms/` (directory)

- [ ] **Step 1:**

```bash
git rm src/alarms/store.ts src/alarms/scheduler-service.ts src/alarms/tools.ts src/alarms/cron.ts src/alarms/types.ts
git rm mcp-servers/scheduler.ts
git rm -r tests/automated/alarms
```

- [ ] **Step 2:** Search the repo for references:

```bash
grep -rn "AlarmsStore\|SchedulerService\|InboundAlarm\|isInboundAlarm\|src/alarms\|mcp-servers/scheduler" --include="*.ts" --include="*.md"
```

Fix every hit. Expected hits at this point: `src/main.ts` (the alarm wiring block), `src/slack/envelope.ts` (`formatAlarm`), `src/slack/types.ts` (`InboundItem` union), `src/ambient/inbox-dispatcher.ts` (alarm branch, if any), `templates/agent-personas/core.md`.

- [ ] **Step 3:** Don't commit yet — Tasks 27–30 update the remaining files. Commit together.

---

### Task 27: Drop alarm wiring from `src/main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1:** Remove imports for `AlarmsStore`, `SchedulerService`, `resolveAlarmJitterMs` (and any unused `mkdirSync`/`path` after their last user is gone).

- [ ] **Step 2:** Delete lines 571-590 (the entire alarm scheduler block). The surrounding `recentCache`/`rotationTracker` blocks must continue to compile.

- [ ] **Step 3:** Verify `dispatcher.dispatch(alarm)` references are removed (search for `dispatch(alarm)` or `dispatch.*InboundAlarm`).

---

### Task 28: Slack envelope becomes Slack-only

**Files:**
- Modify: `src/slack/envelope.ts`
- Modify: `src/slack/types.ts`

- [ ] **Step 1:** In `src/slack/types.ts`:

```ts
// BEFORE
export type { InboundAlarm } from '../alarms/types.js';
import type { InboundAlarm } from '../alarms/types.js';
export type InboundItem = InboundSlackMessage | InboundAlarm;
export function isInboundAlarm(item: InboundItem): item is InboundAlarm { ... }

// AFTER
// (delete InboundAlarm export, isInboundAlarm)
export type InboundItem = InboundSlackMessage;
```

- [ ] **Step 2:** In `src/slack/envelope.ts`:

- Delete `formatAlarm` (lines ~85-91).
- Delete the `InboundAlarm` import.
- In `formatEnvelope`, remove the `isInboundAlarm(item)` branch. The function becomes a straightforward `formatSlackBatch(items)` wrapper (or inline its logic).

- [ ] **Step 3:** Search for `formatEnvelope` consumers and verify they only pass slack-typed arrays now.

---

### Task 29: Inbox dispatcher is Slack-only

**Files:**
- Modify: `src/ambient/inbox-dispatcher.ts`

- [ ] **Step 1:** Open the file. Find any code path that branches on alarm-vs-slack. Remove. The dispatcher's generic `InboundItem` type now collapses to `InboundSlackMessage`; any type narrowing for alarms goes.

- [ ] **Step 2:** Search for `InboundItem` usages across the codebase. Any consumer that branched on `kind === 'alarm'` (the `isInboundAlarm` guard) gets that branch deleted.

---

### Task 30: Persona MCP cleanup

**Files:**
- Modify: `templates/agent-personas/core.md`

- [ ] **Step 1:** Remove the `scheduler:` block (lines 8-14) from `mcpServers:`. The block after edit:

```yaml
mcpServers:
  knowledge:
    command: ./node_modules/.bin/tsx
    args:
      - ./mcp-servers/knowledge.ts
  scribe:
    command: ./node_modules/.bin/tsx
    args:
      - ./mcp-servers/scribe.ts
    env:
      SEN_INSTANCE_ROOT: ${SEN_INSTANCE_ROOT}
maxTurns: 100
```

- [ ] **Step 2:** Search the persona prose body for any mention of `schedule_alarm` via the scheduler MCP or "@scheduler". Update wording — `schedule_alarm` is now a lace built-in and Ada just calls it directly.

---

### Task 31: Sen-core typecheck, test, commit

- [ ] **Step 1:**

```bash
npm run lint
npm run test 2>&1 | tail -30
```

Expected: passes (alarm test count drops because we removed the suite).

- [ ] **Step 2:** Single squashed commit:

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(alarms): remove sen-core alarm subsystem; lace owns it now

Alarms move into lace as per-session alarms.json + a per-process scheduler.
Sen-core deletes:
- src/alarms/{store,scheduler-service,tools,cron,types}.ts
- mcp-servers/scheduler.ts
- tests/automated/alarms/
- The AlarmsStore + SchedulerService wiring in src/main.ts:574-590
- The <alarm> envelope path in src/slack/envelope.ts
- The InboundAlarm branch in src/slack/types.ts and src/ambient/inbox-dispatcher.ts
- The scheduler MCP entry in templates/agent-personas/core.md

Sen-core's inbox is Slack-only now. Alarms reach Ada via lace's
conversation injection (context_injected priority='immediate') as
<notification kind="alarm-fired"> blocks.

Refs PRI-1744.
EOF
)"
```

- [ ] **Step 3:** Push.

```bash
git push -u origin pri-1744-alarms-in-lace
```

---

## Phase 10 — Documentation

### Task 32: `docs/features/alarms.md`

**Files:**
- Create: `docs/features/alarms.md` (lace worktree)

- [ ] **Step 1:** Create the file:

```markdown
# Alarms

Lace agents can schedule alarms that wake them with a prompt at a future time, either as a cron-recurring schedule or as a one-shot. Alarms are owned per-session: each session has its own `alarms.json` next to `events.jsonl`.

## Tools

Three built-in tools, available to every persona that includes lace built-ins:

| Tool | Purpose |
| --- | --- |
| `schedule_alarm` | Create a new alarm (cron or one-shot) |
| `cancel_alarm` | Cancel a pending alarm by id |
| `list_alarms` | List pending/firing alarms for the current session |

### `schedule_alarm` parameters

- `kind`: `'cron'` or `'once'`
- `schedule`: cron expression (`0 9 * * *`, min interval 1 hour) or ISO-8601 timestamp (`2030-01-01T09:00:00Z`)
- `prompt`: text the alarm fires with — what the agent's future self should be told
- `timezone`: IANA name (required for cron; defaults to UTC for one-shot)

Cap: 50 active alarms per session.

## Fire path

When an alarm fires, lace writes a `context_injected` durable event with `priority='immediate'` to the session's `events.jsonl`. The content is a `<notification kind="alarm-fired" alarm-id="...">…</notification>` block. The conversation runner's existing immediate-inject pickup folds it into the next turn as a `role: 'user'` message.

If the agent is idle when the alarm fires, lace triggers an internal turn so the agent processes the notification immediately.

## Lifetime

Alarms fire only while the owning lace process is alive. There is no cross-process scheduler. Subagent alarms fire only while the subagent's lace process is running. On graceful subagent shutdown with pending alarms, lace writes a `<notification kind="subagent-exited">` block into the parent session — see [notifications.md](./notifications.md).

## Storage

`<LACE_DIR>/agent-sessions/<sessionId>/alarms.json` — single JSON snapshot, atomically rewritten via `atomicWriteJson` on every state change. Bounded (~10 KB at the 50-alarm cap). Boot recovery reads the file and rebuilds the in-memory min-heap.
```

- [ ] **Step 2:** Commit.

```bash
cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/lace-worktrees/pri-1744-alarms-spec
git add docs/features/alarms.md
git commit -m "docs(features): alarm tool surface and storage (PRI-1744)"
```

---

### Task 33: `docs/features/notifications.md`

**Files:**
- Create: `docs/features/notifications.md`

- [ ] **Step 1:** Create the file:

```markdown
# Notifications

Lace delivers agent-facing notifications (alarm fires, background job lifecycle, subagent exit) through a single utility, `injectNotification`, that writes a `context_injected` durable event with `priority='immediate'`. The conversation runner picks it up at the next turn boundary as a `role: 'user'` message.

## Shape

All notifications share one wrapper:

```
<notification kind="..." [identifier-attributes]>
body prose
</notification>
```

- `kind`: discriminator (see "Kinds" below).
- Identifier attributes: machine-parseable identifiers (`alarm-id`, `job-id`, `subagent-session-id`, `persona`).
- Body: prose, not labeled fields. Lists in body get a short prose preamble plus indented bullets. End with the next-step tool-call hint when applicable.

## Kinds

| `kind` | Identifiers | Composer |
| --- | --- | --- |
| `alarm-fired` | `alarm-id` | `composeAlarmFiredBody` |
| `job-completed` | `job-id` | `composeJobCompletedBody` |
| `job-failed` | `job-id` | `composeJobFailedBody` |
| `job-cancelled` | `job-id` | `composeJobCancelledBody` |
| `job-progress` | `job-id` | `composeJobProgressBody` |
| `subagent-exited` | `subagent-session-id`, `job-id`, `persona` | `composeSubagentExitedBody` |

## Adding a new kind

1. Add the kind to `NotificationKind` in `packages/agent/src/notifications/notification-wrapper.ts`.
2. Add a composer to `packages/agent/src/notifications/composers.ts` returning the prose body.
3. Add a snapshot test to `packages/agent/src/notifications/__tests__/composers.test.ts`.
4. Call `injectNotification({ kind, identifiers, body })` from the producing module.

## Body example

```
<notification kind="job-completed" job-id="job_xyz">
Your background job completed successfully (exit code 0) after 12.3 seconds, writing 15,234 bytes of output. The last line was: "build finished in 5.2s". Call job_output(jobId="job_xyz") to read the full output. To continue this conversation thread, call delegate(resume="job_xyz", prompt="your message").
</notification>
```
```

- [ ] **Step 2:** Commit.

```bash
git add docs/features/notifications.md
git commit -m "docs(features): unified notification shape and composer pattern (PRI-1744)"
```

---

## Phase 11 — Final verification

### Task 34: Lace full sweep

- [ ] **Step 1:**

```bash
cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/lace-worktrees/pri-1744-alarms-spec
npm run lint
npm run test 2>&1 | tail -30
git push origin pri-1744-alarms-spec
```

Expected: lint clean, all tests pass.

---

### Task 35: Sen-core full sweep (already done in Task 31; confirm push)

- [ ] **Step 1:**

```bash
cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2
git status
git log --oneline origin/main..HEAD
```

Expected: single commit, pushed.

---

### Task 36: Cross-repo smoke (manual)

- [ ] **Step 1:** Rebuild lace and run sen-core against it:

```bash
cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/lace-worktrees/pri-1744-alarms-spec
npm run build

cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2
# Run sen-core however the existing dev recipe spawns it, pointing SEN_LACE_PATH
# at the rebuilt lace.
```

- [ ] **Step 2:** From the operator side (Slack DM or `sen prompt`):

> Schedule an alarm 60 seconds from now that says "ping".

After ~60s, verify Ada wakes and acknowledges the alarm. Check Ada's session `events.jsonl` for the `<notification kind="alarm-fired">` block.

- [ ] **Step 3:** Verify a delegate sub-job's completion produces a `<notification kind="job-completed">` block (not the old `<background-job-notification>`).

- [ ] **Step 4:** Verify a subagent that schedules an alarm and then exits cleanly produces a `<notification kind="subagent-exited">` in the parent's events.jsonl.

If any step fails, fix in code + tests; don't paper over.

---

## Spec coverage check (self-review)

- **Per-session snapshot storage** → Tasks 6, 8.
- **Per-process scheduler** → Task 9.
- **No if_session_ended** → Tasks 12 (schedule_alarm), 13, 14.
- **`injectNotification` writes context_injected priority='immediate'** → Task 3.
- **Unified `<notification>` shape** → Tasks 1, 2.
- **Runner picks up between-turn injections** → Tasks 4, 5.
- **`subagent-exited` courtesy bubble** → Task 17.
- **`SessionMeta.parent`** → Tasks 10, 11.
- **Sen-core deletions (alarms + InboundAlarm + envelope + dispatcher + persona MCP)** → Tasks 26–30.
- **Job notification refactor → composers + injectNotification** → Tasks 18, 19.
- **Ent-protocol minimal change (only optional `parent` on `session/new`)** → Task 11.
- **Docs (alarms + notifications)** → Tasks 32, 33.
- **Tests (unit + e2e)** → Tasks 1–4, 8, 9, 12–14, 20–25.

No placeholders. Names used across tasks (`AlarmStore`, `AlarmScheduler`, `injectNotification`, `buildNotification`, `composeAlarmFiredBody`/`composeJobCompletedBody`/etc., `ensureAlarmSchedulerForActiveSession`, `emitSubagentExitedIfNeeded`, `findLastTurnEndEventSeq`, `fanoutToInject`) are consistent across definitions and references.
