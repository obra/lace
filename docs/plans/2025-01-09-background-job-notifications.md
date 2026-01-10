# Background Job Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Inject notifications into the agent's conversation when background
jobs complete or reach progress checkpoints.

**Architecture:** Notifications are queued when job events occur and delivered
as user messages at safe injection points (turn boundaries, after tool
completion, when idle). Progress updates are sent at configurable intervals with
a 5-minute default.

**Tech Stack:** TypeScript, Zod schemas, existing job infrastructure in
server.ts

---

## 1. Notification Format

### 1.1 Completion Notification

```xml
<background-job-notification job-id="job_abc123" type="completed">
Status: completed
Exit code: 0
Duration: 12.3s
Output: 2,456 bytes
Last line: "Build successful"

Use job_output tool with jobId "job_abc123" to see full output.
</background-job-notification>
```

### 1.2 Failure Notification

```xml
<background-job-notification job-id="job_abc123" type="failed">
Status: failed
Exit code: 1
Duration: 3.1s
Output: 892 bytes
Last 3 lines:
  src/main.ts:42 - Type error
  src/main.ts:58 - Type error
  Build failed with 2 errors

Use job_output tool with jobId "job_abc123" to see full output.
</background-job-notification>
```

### 1.3 Progress Notification

```xml
<background-job-notification job-id="job_abc123" type="progress">
Status: running
Duration: 5m 0.0s
Output: 15,234 bytes (+2,100 since last update)
Last 3 lines:
  Processing file 45/120...
  Processing file 46/120...
  Processing file 47/120...

Use job_output tool with jobId "job_abc123" to check current output.
</background-job-notification>
```

### 1.4 Cancelled Notification

```xml
<background-job-notification job-id="job_abc123" type="cancelled">
Status: cancelled
Duration: 5.2s
Output: 1,024 bytes
Reason: Session switched

Use job_output tool with jobId "job_abc123" to see captured output.
</background-job-notification>
```

---

## 2. Design Decisions

| Decision                  | Choice                   | Rationale                          |
| ------------------------- | ------------------------ | ---------------------------------- |
| Injection timing          | First safe turn boundary | Never wait for user message        |
| Message type              | User message             | Can't add roles on most providers  |
| Progress trigger          | Parameter on job launch  | Simple, explicit                   |
| Default progress interval | 5 minutes (300000ms)     | Balance between awareness and spam |
| Multi-job batching        | Separate notifications   | Simple                             |
| Last N lines              | 3 lines                  | Good context without overwhelming  |
| Line truncation           | 200 chars                | Prevent massive single-line output |
| Persistence               | Not required             | Don't go out of our way            |

---

## Task 1: Add Notification Queue to State

**Files:**

- Modify: `packages/agent/src/server.ts`

**Step 1: Define notification types**

Add after the `JobState` type definition (~line 220):

```typescript
type JobNotificationType = 'completed' | 'failed' | 'cancelled' | 'progress';

type PendingJobNotification = {
  jobId: string;
  type: JobNotificationType;
  content: string;
  createdAt: number;
};
```

**Step 2: Add queue to AgentServerState**

Add to the `AgentServerState` type:

```typescript
jobNotificationQueue: PendingJobNotification[];
```

**Step 3: Initialize queue in createAgentServerState**

Add to the return object:

```typescript
jobNotificationQueue: [],
```

**Step 4: Commit**

```bash
git add packages/agent/src/server.ts
git commit -m "feat(jobs): add notification queue to agent state"
```

---

## Task 2: Add Progress Interval to Job Schemas

**Files:**

- Modify: `packages/agent/src/tools/implementations/bash.ts`
- Modify: `packages/agent/src/tools/implementations/delegate.ts`
- Create: `packages/agent/src/tools/__tests__/bash-progress.test.ts`

**Step 1: Update bash schema**

Add `progressIntervalMs` parameter:

```typescript
const bashSchema = z.object({
  command: NonEmptyString,
  description: z.string().optional(),
  background: z.boolean().default(false),
  progressIntervalMs: z.number().int().min(5000).max(600000).optional(),
});
```

Update description to document the parameter.

**Step 2: Update delegate schema**

Add same parameter to delegate tool.

**Step 3: Write tests**

Test that schema accepts valid progressIntervalMs values and rejects invalid
ones.

**Step 4: Commit**

```bash
git add packages/agent/src/tools/implementations/bash.ts
git add packages/agent/src/tools/implementations/delegate.ts
git add packages/agent/src/tools/__tests__/bash-progress.test.ts
git commit -m "feat(jobs): add progressIntervalMs parameter to bash and delegate tools"
```

---

## Task 3: Extend JobState for Progress Tracking

**Files:**

- Modify: `packages/agent/src/server.ts`

**Step 1: Add progress fields to JobState**

```typescript
type JobState = {
  // ... existing fields ...

  progressIntervalMs?: number;
  lastProgressAt?: number;
  lastProgressBytes?: number;
};
```

**Step 2: Update \_startShellJob to accept progressIntervalMs**

Pass through from tool args to job state.

**Step 3: Update startSubagentJob similarly**

**Step 4: Commit**

```bash
git add packages/agent/src/server.ts
git commit -m "feat(jobs): extend JobState with progress tracking fields"
```

---

## Task 4: Implement Notification Formatter

**Files:**

- Create: `packages/agent/src/jobs/format-notification.ts`
- Create: `packages/agent/src/jobs/__tests__/format-notification.test.ts`

**Step 1: Write failing tests**

```typescript
describe('formatJobNotification', () => {
  it('formats completed notification', () => {
    const result = formatJobNotification({
      jobId: 'job_abc123',
      type: 'completed',
      exitCode: 0,
      durationMs: 12300,
      outputBytes: 2456,
      lastLines: ['Build successful'],
    });

    expect(result).toContain('<background-job-notification');
    expect(result).toContain('job-id="job_abc123"');
    expect(result).toContain('type="completed"');
    expect(result).toContain('Exit code: 0');
    expect(result).toContain('Duration: 12.3s');
    expect(result).toContain('Output: 2,456 bytes');
  });

  it('formats failed notification with 3 last lines', () => { ... });
  it('formats progress notification with delta bytes', () => { ... });
  it('formats cancelled notification with reason', () => { ... });
  it('truncates lines longer than 200 chars', () => { ... });
  it('formats duration as minutes for long jobs', () => { ... });
});
```

**Step 2: Implement formatJobNotification**

```typescript
export function formatJobNotification(options: {
  jobId: string;
  type: JobNotificationType;
  exitCode?: number;
  durationMs: number;
  outputBytes: number;
  deltaBytes?: number;
  lastLines: string[];
  reason?: string;
}): string {
  // Implementation
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = (ms % 60000) / 1000;
  return `${mins}m ${secs.toFixed(1)}s`;
}

function truncateLine(line: string, maxLen = 200): string {
  if (line.length <= maxLen) return line;
  return line.slice(0, maxLen - 3) + '...';
}
```

**Step 3: Run tests and verify**

**Step 4: Commit**

```bash
git add packages/agent/src/jobs/format-notification.ts
git add packages/agent/src/jobs/__tests__/format-notification.test.ts
git commit -m "feat(jobs): implement notification formatter"
```

---

## Task 5: Generate Completion Notifications

**Files:**

- Modify: `packages/agent/src/server.ts`

**Step 1: Create helper to get last N lines from job output**

```typescript
function getLastLines(outputPath: string, n: number): string[] {
  try {
    const content = readFileSync(outputPath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-n);
  } catch {
    return [];
  }
}
```

**Step 2: Create queueJobNotification helper**

```typescript
function queueJobNotification(
  job: JobState,
  type: JobNotificationType,
  options?: { reason?: string; deltaBytes?: number }
) {
  const outputBytes = existsSync(job.outputPath)
    ? statSync(job.outputPath).size
    : 0;
  const durationMs = Date.now() - new Date(job.startedAt).getTime();
  const lastLines = getLastLines(job.outputPath, type === 'completed' ? 1 : 3);

  const content = formatJobNotification({
    jobId: job.jobId,
    type,
    exitCode: job.exitCode,
    durationMs,
    outputBytes,
    deltaBytes: options?.deltaBytes,
    lastLines,
    reason: options?.reason,
  });

  state.jobNotificationQueue.push({
    jobId: job.jobId,
    type,
    content,
    createdAt: Date.now(),
  });
}
```

**Step 3: Call queueJobNotification in finalizeJob**

When job completes/fails/is cancelled, queue the notification.

**Step 4: Commit**

```bash
git add packages/agent/src/server.ts
git commit -m "feat(jobs): generate completion notifications"
```

---

## Task 6: Implement Notification Injection

**Files:**

- Modify: `packages/agent/src/server.ts`

**Step 1: Create injectPendingNotifications helper**

```typescript
async function injectPendingNotifications(): Promise<boolean> {
  if (state.jobNotificationQueue.length === 0) return false;
  if (!state.activeSession) return false;

  // Drain the queue
  const notifications = state.jobNotificationQueue.splice(0);

  for (const notification of notifications) {
    // Inject as user message via session/prompt internally
    // This triggers the agent to process the notification
    await handleInternalPrompt({
      content: [{ type: 'text', text: notification.content }],
      isSystemNotification: true,
    });
  }

  return true;
}
```

**Step 2: Add injection points**

Call `injectPendingNotifications()` at:

- Start of `session/prompt` handler (before processing user message)
- After tool execution completes (in the tool execution loop)
- When turn ends and agent goes idle

**Step 3: Add tests**

Test that notifications are injected at appropriate times.

**Step 4: Commit**

```bash
git add packages/agent/src/server.ts
git commit -m "feat(jobs): implement notification injection at turn boundaries"
```

---

## Task 7: Implement Progress Timer

**Files:**

- Modify: `packages/agent/src/server.ts`

**Step 1: Set up progress timer on job start**

In `_startShellJob` and `startSubagentJob`, when job has `progressIntervalMs`:

```typescript
const DEFAULT_PROGRESS_INTERVAL = 300000; // 5 minutes

// Use provided interval or default for background jobs
const progressInterval =
  options.progressIntervalMs ??
  (options.background ? DEFAULT_PROGRESS_INTERVAL : undefined);

if (progressInterval) {
  job.progressIntervalMs = progressInterval;
  job.lastProgressAt = Date.now();
  job.lastProgressBytes = 0;

  const timer = setInterval(() => {
    if (job.status !== 'running') {
      clearInterval(timer);
      return;
    }

    const currentBytes = existsSync(job.outputPath)
      ? statSync(job.outputPath).size
      : 0;
    const deltaBytes = currentBytes - (job.lastProgressBytes ?? 0);

    queueJobNotification(job, 'progress', { deltaBytes });

    job.lastProgressAt = Date.now();
    job.lastProgressBytes = currentBytes;
  }, progressInterval);

  job.progressTimer = timer;
}
```

**Step 2: Clear timer on job completion**

In `finalizeJob`, clear the progress timer:

```typescript
if (job.progressTimer) {
  clearInterval(job.progressTimer);
  job.progressTimer = undefined;
}
```

**Step 3: Add progressTimer to JobState type**

```typescript
progressTimer?: ReturnType<typeof setInterval>;
```

**Step 4: Commit**

```bash
git add packages/agent/src/server.ts
git commit -m "feat(jobs): implement progress notification timer"
```

---

## Task 8: E2E Tests for Notifications

**Files:**

- Modify:
  `packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`

**Step 1: Test completion notification injection**

```typescript
it('injects completion notification when background job finishes', async () => {
  // Start agent, spawn background job
  // Wait for job to complete
  // Send another prompt
  // Verify the notification was injected (appears in conversation)
});
```

**Step 2: Test failure notification**

```typescript
it('injects failure notification when background job fails', async () => {
  // Similar but with failing command
});
```

**Step 3: Test progress notification**

```typescript
it('injects progress notification at configured interval', async () => {
  // Start job with short progressIntervalMs (5000)
  // Wait > 5 seconds
  // Verify progress notification was queued/injected
});
```

**Step 4: Commit**

```bash
git add packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts
git commit -m "test(jobs): add E2E tests for job notifications"
```

---

## Task 9: Update Tool Descriptions

**Files:**

- Modify: `packages/agent/src/tools/implementations/bash.ts`
- Modify: `packages/agent/src/tools/implementations/delegate.ts`

**Step 1: Update bash tool description**

Document that:

- Background jobs send completion notifications automatically
- Progress notifications sent every 5 minutes by default
- Can customize with `progressIntervalMs`

**Step 2: Update delegate tool description similarly**

**Step 3: Commit**

```bash
git add packages/agent/src/tools/implementations/bash.ts
git add packages/agent/src/tools/implementations/delegate.ts
git commit -m "docs(tools): document background job notification behavior"
```

---

## Summary

| Task | Description                           | Files                      |
| ---- | ------------------------------------- | -------------------------- |
| 1    | Add notification queue to state       | server.ts                  |
| 2    | Add progressIntervalMs to schemas     | bash.ts, delegate.ts       |
| 3    | Extend JobState for progress tracking | server.ts                  |
| 4    | Implement notification formatter      | format-notification.ts     |
| 5    | Generate completion notifications     | server.ts                  |
| 6    | Implement notification injection      | server.ts                  |
| 7    | Implement progress timer              | server.ts                  |
| 8    | E2E tests for notifications           | async-workflow.e2e.test.ts |
| 9    | Update tool descriptions              | bash.ts, delegate.ts       |

---

## Open Questions / Future Work

1. **Subagent output capture**: Verify that delegate job output (agent text
   responses) is being captured correctly to job output file
2. **Notification acknowledgment**: Should agent explicitly acknowledge
   notifications? (Probably not needed initially)
3. **Rate limiting**: If many jobs complete simultaneously, should we rate-limit
   notification injection? (Start simple, optimize if needed)
