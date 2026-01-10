# Async Jobs API & Runtime Improvements

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Improve the async jobs feature with cleaner API naming and robust
runtime behavior based on opus review recommendations.

**Architecture:** Refactor parameter names for consistency (`run_async` →
`background`, `shell`/`subagent` → `bash`/`delegate`), add missing schema
parameters, return structured JSON instead of prose, and harden runtime with
process cleanup on session switch, timeouts, and resource limits.

**Tech Stack:** TypeScript, Zod schemas, Node.js child_process

---

## Part 1: API Design Improvements

### Task 1: Rename `run_async` to `background`

**Files:**

- Modify: `packages/agent/src/tools/implementations/bash.ts:9-13`
- Modify: `packages/agent/src/tools/implementations/delegate.ts:9-16`
- Modify: `packages/agent/src/server.ts` (multiple locations using `run_async`)
- Test: `packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`

**Step 1: Update bash schema**

In `packages/agent/src/tools/implementations/bash.ts`, change:

```typescript
const bashSchema = z.object({
  command: NonEmptyString,
  background: z.boolean().default(false),
});
```

And update the description to reference `background` instead of `run_async`:

```typescript
description = `Execute shell commands in isolated bash processes.

Parameters:
- command: The shell command to run
- background: Set to true for background execution (returns jobId immediately)

When background=true, returns { jobId, status: "started" }. Use job_output(jobId) to check status/output.

Default (sync): Blocks until complete. Output truncated to 100+50 lines. Chain with && or ;.`;
```

**Step 2: Update delegate schema**

In `packages/agent/src/tools/implementations/delegate.ts`, change:

```typescript
const delegateSchema = z
  .object({
    prompt: NonEmptyString,
    description: z.string().optional(),
    background: z.boolean().default(false),
    resume: z.string().optional(),
  })
  .strict();
```

And update the description:

```typescript
description = `Spawn a subagent to handle a task autonomously.

Parameters:
- prompt: The task for the subagent (required)
- description: Label shown in job listings (optional)
- background: Set to true to return immediately with jobId (default: false)
- resume: JobId of a failed/cancelled job to continue from where it left off

When background=true, returns { jobId, status: "started" }. Use job_output(jobId) to monitor.
Default (sync): Blocks until subagent completes and returns full output.`;
```

**Step 3: Update server.ts runtime checks**

Search for `run_async` in server.ts and replace with `background`:

- Line ~4368: `(finalInput as Record<string, unknown>).background === true`
- Line ~4395:
  `const runAsync = (finalInput as Record<string, unknown>).background === true`

**Step 4: Run tests to verify**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`
Expected: All 5 tests pass (tests use ENT protocol directly, not tool schemas)

**Step 5: Commit**

```bash
git add packages/agent/src/tools/implementations/bash.ts packages/agent/src/tools/implementations/delegate.ts packages/agent/src/server.ts
git commit -m "$(cat <<'EOF'
refactor: rename run_async to background for clarity

The parameter name 'background' better describes the behavior and aligns
with common CLI conventions (like '&' for background processes).
EOF
)"
```

---

### Task 2: Standardize job type names (`shell`/`subagent` → `bash`/`delegate`)

**Files:**

- Modify: `packages/ent-protocol/src/schemas/methods.ts:1246,1247,1747,1888`
- Modify: `packages/agent/src/server.ts` (JobType, multiple locations)
- Modify: `packages/agent/src/tools/implementations/jobs_list.ts:10`
- Test: `packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`

**Step 1: Update ENT protocol schema**

In `packages/ent-protocol/src/schemas/methods.ts`, change all occurrences:

- Line 1246: `type: z.enum(['bash', 'delegate'])`
- Line 1747: `jobType: z.enum(['bash', 'delegate'])`
- Line 1888: `jobType: z.enum(['bash', 'delegate']).optional()`

**Step 2: Update server.ts JobType**

At line ~185, change:

```typescript
type JobType = 'bash' | 'delegate';
```

Then search and replace throughout server.ts:

- `type: 'shell'` → `type: 'bash'`
- `type: 'subagent'` → `type: 'delegate'`
- `jobType: 'shell'` → `jobType: 'bash'`
- `jobType: 'subagent'` → `jobType: 'delegate'`
- `=== 'subagent'` → `=== 'delegate'`
- `=== 'shell'` → `=== 'bash'`

**Step 3: Update jobs_list tool schema**

In `packages/agent/src/tools/implementations/jobs_list.ts`, change line 10:

```typescript
type: z.array(z.enum(['bash', 'delegate'])).optional(),
```

**Step 4: Run tests**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`
Expected: Tests fail - need to update test assertions

**Step 5: Update tests for new type names**

In `packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`,
change:

- Line 46: `p.jobType === 'bash'` (was `'shell'`)

**Step 6: Run tests again**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`
Expected: All 5 tests pass

**Step 7: Commit**

```bash
git add packages/ent-protocol/src/schemas/methods.ts packages/agent/src/server.ts packages/agent/src/tools/implementations/jobs_list.ts packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts
git commit -m "$(cat <<'EOF'
refactor: standardize job types to bash/delegate

Renamed 'shell' to 'bash' and 'subagent' to 'delegate' for consistency
with the tool names that spawn these jobs.
EOF
)"
```

---

### Task 3: Add `description` parameter to bash tool

**Files:**

- Modify: `packages/agent/src/tools/implementations/bash.ts`
- Modify: `packages/agent/src/server.ts` (startShellJob call)
- Test: existing E2E tests

**Step 1: Update bash schema**

```typescript
const bashSchema = z.object({
  command: NonEmptyString,
  background: z.boolean().default(false),
  description: z.string().optional(),
});
```

Update description:

```typescript
description = `Execute shell commands in isolated bash processes.

Parameters:
- command: The shell command to run
- background: Set to true for background execution (returns jobId immediately)
- description: Label shown in job listings when background=true (optional)

When background=true, returns { jobId, status: "started" }. Use job_output(jobId) to check status/output.

Default (sync): Blocks until complete. Output truncated to 100+50 lines. Chain with && or ;.`;
```

**Step 2: Pass description to startShellJob**

In server.ts around line 4368, extract and pass description:

```typescript
const description = toNonEmptyString(
  (finalInput as Record<string, unknown>).description
);

const { jobId } = await startShellJob({
  command,
  description: description || command.slice(0, 50),
  turnContext: { turnId, turnSeq: toolTurnSeq },
});
```

**Step 3: Run tests**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`
Expected: All 5 tests pass

**Step 4: Commit**

```bash
git add packages/agent/src/tools/implementations/bash.ts packages/agent/src/server.ts
git commit -m "$(cat <<'EOF'
feat(bash): add description parameter for background jobs

Allows agents to provide a human-readable label for background jobs
instead of using the raw command.
EOF
)"
```

---

### Task 4: Return structured JSON from async job launch

**Files:**

- Modify: `packages/agent/src/server.ts:4383-4391,4435-4443`
- Test: existing E2E tests (may need minor updates)

**Step 1: Update bash async return**

Around line 4383-4391, change:

```typescript
coreResult = {
  status: 'completed',
  content: [
    {
      type: 'text',
      text: JSON.stringify({ jobId, status: 'started' }),
    },
  ],
};
```

**Step 2: Update delegate async return**

Around line 4435-4443, change:

```typescript
coreResult = {
  status: 'completed',
  content: [
    {
      type: 'text',
      text: JSON.stringify({ jobId, status: 'started' }),
    },
  ],
};
```

**Step 3: Run tests**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`
Expected: All 5 tests pass (tests use ENT protocol, not tool output parsing)

**Step 4: Commit**

```bash
git add packages/agent/src/server.ts
git commit -m "$(cat <<'EOF'
refactor: return structured JSON from async job launch

Returns { jobId, status: "started" } instead of prose text for easier
programmatic parsing by agents.
EOF
)"
```

---

### Task 5: Rename `cursor` to `byteOffset` in job_output

**Files:**

- Modify: `packages/agent/src/tools/implementations/job_output.ts:13`
- Modify: `packages/agent/src/server.ts` (job_output runtime handling)
- Test: existing tests

**Step 1: Update job_output schema**

In `packages/agent/src/tools/implementations/job_output.ts`, change line 13:

```typescript
const jobOutputSchema = z.object({
  jobId: NonEmptyString,
  block: z.boolean().default(true),
  timeoutMs: z.number().int().min(0).max(600_000).default(30_000),
  byteOffset: z.number().int().min(0).default(0),
});
```

Update description:

```typescript
description = `Get status and output from a background job (started with background=true).

**Blocking (default):** Waits up to timeoutMs for job completion, then returns.
**Non-blocking:** Set block=false to check current status without waiting.
**Incremental:** Use byteOffset to read new output since last check.

Returns: { status: "running"|"completed"|"failed"|"cancelled", output: string, exitCode?: number }`;
```

**Step 2: Update server.ts runtime handling**

Around line 4509-4512, change `cursor` references to `byteOffset`:

```typescript
const byteOffset =
  typeof (finalInput as Record<string, unknown>).byteOffset === 'number'
    ? ((finalInput as Record<string, unknown>).byteOffset as number)
    : 0;
```

**Step 3: Run tests**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`
Expected: All 5 tests pass

**Step 4: Commit**

```bash
git add packages/agent/src/tools/implementations/job_output.ts packages/agent/src/server.ts
git commit -m "$(cat <<'EOF'
refactor: rename cursor to byteOffset in job_output

The name 'byteOffset' is more accurate - it represents the byte position
in the output file, not a database-style cursor.
EOF
)"
```

---

## Part 2: Runtime Robustness Improvements

### Task 6: Kill running jobs on session switch

**Files:**

- Modify: `packages/agent/src/server.ts:3245-3250`
- Test: new test case

**Step 1: Write failing test**

Add to `packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`:

```typescript
it('session switch kills running jobs', { timeout: 30_000 }, async () => {
  agent = spawnAgentProcess({ laceDir });

  let jobId: string | undefined;
  let session1Id: string | undefined;

  agent.peer.onRequest('session/update', async (params) => {
    const p = params as Record<string, unknown>;
    if (p.type === 'job_started' && typeof p.jobId === 'string') {
      jobId = p.jobId;
    }
    return undefined;
  });

  agent.peer.onRequest('session/request_permission', async () => {
    return { decision: 'allow' };
  });

  await withTimeout(
    agent.peer.request(
      'initialize',
      defaultInitializeParams({ config: { approvalMode: 'allow' } })
    ),
    2_000,
    'initialize'
  );

  // Create first session and start a long-running job
  const session1 = (await withTimeout(
    agent.peer.request('session/new', { workDir }),
    2_000,
    'session/new (1)'
  )) as { sessionId: string };
  session1Id = session1.sessionId;

  await withTimeout(
    agent.peer.request('session/prompt', {
      content: [{ type: 'text', text: 'job: sleep 60' }],
    }),
    5_000,
    'session/prompt (start job)'
  );

  // Wait for job to start
  await withTimeout(
    new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (jobId) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    }),
    3_000,
    'job started'
  );

  // Switch to a new session
  await withTimeout(
    agent.peer.request('session/new', { workDir }),
    2_000,
    'session/new (2)'
  );

  // Load back the first session and check job status
  await withTimeout(
    agent.peer.request('session/load', { sessionId: session1Id }),
    2_000,
    'session/load'
  );

  // Job should have been killed (cancelled status)
  const output = (await withTimeout(
    agent.peer.request('ent/job/output', { jobId }),
    2_000,
    'ent/job/output'
  )) as { status: string };

  expect(output.status).toBe('cancelled');
});
```

**Step 2: Run test to verify it fails**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts -t "session switch"`
Expected: FAIL - job remains running

**Step 3: Implement job cleanup on session switch**

In server.ts around line 3245-3250, add job cleanup before clearing:

```typescript
if (switchingSessions) {
  state.pendingPermissionRequests.clear();

  // Kill all running jobs before switching sessions
  for (const job of state.jobs.values()) {
    if (job.status === 'running') {
      job.status = 'cancelled';
      if (job.proc) {
        try {
          if (
            process.platform !== 'win32' &&
            typeof job.proc.pid === 'number'
          ) {
            process.kill(-job.proc.pid, 'SIGTERM');
          } else {
            job.proc.kill('SIGTERM');
          }
        } catch {
          // Process may already be dead
        }
      }
      job.permissionAbortController?.abort();
    }
  }

  // Wait briefly for processes to terminate
  await Promise.all(
    [...state.jobs.values()]
      .filter((job) => job.proc && job.proc.exitCode === null)
      .map((job) =>
        Promise.race([
          job.completion,
          new Promise<void>((resolve) => setTimeout(resolve, 500)),
        ])
      )
  );

  state.jobs.clear();
}
```

Note: The session/load handler will need to be made async or use a helper.

**Step 4: Run test to verify it passes**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts -t "session switch"`
Expected: PASS

**Step 5: Run all tests**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`
Expected: All 6 tests pass

**Step 6: Commit**

```bash
git add packages/agent/src/server.ts packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts
git commit -m "$(cat <<'EOF'
fix: kill running jobs when switching sessions

Prevents orphaned processes when loading a different session. Jobs are
sent SIGTERM and given 500ms to terminate gracefully.
EOF
)"
```

---

### Task 7: Add timeout on subagent exit wait

**Files:**

- Modify: `packages/agent/src/server.ts:1825-1828`
- Test: new test case (optional - hard to test)

**Step 1: Implement timeout with SIGKILL escalation**

In server.ts around line 1825-1828, change:

```typescript
if (childProc.exitCode === null) {
  childProc.kill('SIGTERM');

  // Wait up to 2 seconds for graceful exit
  const exitPromise = new Promise<void>((resolve) =>
    childProc.once('exit', () => resolve())
  );
  const timeoutPromise = new Promise<void>((resolve) =>
    setTimeout(resolve, 2_000)
  );

  await Promise.race([exitPromise, timeoutPromise]);

  // Force kill if still running
  if (childProc.exitCode === null) {
    try {
      childProc.kill('SIGKILL');
    } catch {
      // Process may have exited between check and kill
    }

    // Final wait with shorter timeout
    await Promise.race([
      new Promise<void>((resolve) => childProc.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
  }
}
```

**Step 2: Run tests**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/agent/src/server.ts
git commit -m "$(cat <<'EOF'
fix: add timeout on subagent exit wait with SIGKILL escalation

Prevents hanging forever if a subagent process ignores SIGTERM. After 2s,
escalates to SIGKILL and waits another 1s.
EOF
)"
```

---

### Task 8: Add resource limits (MAX_CONCURRENT_JOBS, MAX_JOB_OUTPUT_BYTES)

**Files:**

- Modify: `packages/agent/src/server.ts`
- Test: new test cases

**Step 1: Write failing test for concurrent job limit**

Add to test file:

```typescript
it('enforces concurrent job limit', { timeout: 30_000 }, async () => {
  agent = spawnAgentProcess({ laceDir });
  const jobIds: string[] = [];

  agent.peer.onRequest('session/update', async (params) => {
    const p = params as Record<string, unknown>;
    if (p.type === 'job_started' && typeof p.jobId === 'string') {
      jobIds.push(p.jobId);
    }
    return undefined;
  });

  agent.peer.onRequest('session/request_permission', async () => {
    return { decision: 'allow' };
  });

  await withTimeout(
    agent.peer.request(
      'initialize',
      defaultInitializeParams({ config: { approvalMode: 'allow' } })
    ),
    2_000,
    'initialize'
  );

  await withTimeout(
    agent.peer.request('session/new', { workDir }),
    2_000,
    'session/new'
  );

  // Try to spawn more than MAX_CONCURRENT_JOBS (10)
  const results: Array<{ error?: { message: string } }> = [];
  for (let i = 0; i < 12; i++) {
    try {
      await agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: `job: sleep 60` }],
      });
      results.push({});
    } catch (err) {
      results.push({ error: err as { message: string } });
    }
  }

  // First 10 should succeed, last 2 should fail with limit error
  const successes = results.filter((r) => !r.error);
  const failures = results.filter((r) => r.error?.message?.includes('limit'));

  expect(successes.length).toBe(10);
  expect(failures.length).toBe(2);

  // Cleanup: kill all jobs
  for (const jobId of jobIds) {
    await agent.peer.request('ent/job/kill', { jobId }).catch(() => {});
  }
});
```

**Step 2: Run test to verify it fails**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts -t "concurrent job limit"`
Expected: FAIL - no limit enforced

**Step 3: Add constants and enforce limits**

At top of server.ts (after imports), add:

```typescript
const MAX_CONCURRENT_JOBS = 10;
const MAX_JOB_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB
```

In startShellJob and startSubagentJob functions, add check at beginning:

```typescript
const runningJobCount = [...state.jobs.values()].filter(
  (j) => j.status === 'running'
).length;
if (runningJobCount >= MAX_CONCURRENT_JOBS) {
  throw {
    code: EntErrorCodes.ResourceLimitExceeded,
    message: `Maximum concurrent jobs (${MAX_CONCURRENT_JOBS}) exceeded`,
    data: { category: 'session' },
  };
}
```

Also add `ResourceLimitExceeded` to the error codes if not present.

In appendOutput functions, add size check:

```typescript
const appendOutput = async (chunk: string) => {
  if (!state.activeSession) return;

  // Check output size limit
  try {
    const currentSize = statSync(job.outputPath).size;
    if (currentSize >= MAX_JOB_OUTPUT_BYTES) {
      return; // Silently drop output after limit
    }
  } catch {
    // File doesn't exist yet, OK to write
  }

  await runExclusive(() => {
    appendFileSync(job.outputPath, chunk, { encoding: 'utf8' });
  });
};
```

**Step 4: Run test to verify it passes**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts -t "concurrent job limit"`
Expected: PASS

**Step 5: Run all tests**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`
Expected: All tests pass

**Step 6: Commit**

```bash
git add packages/agent/src/server.ts packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts
git commit -m "$(cat <<'EOF'
feat: add resource limits for background jobs

- MAX_CONCURRENT_JOBS: 10 (prevents runaway job spawning)
- MAX_JOB_OUTPUT_BYTES: 10MB (prevents disk exhaustion)

Jobs exceeding the concurrent limit get a clear error. Output exceeding
the size limit is silently dropped.
EOF
)"
```

---

### Task 9: Add logging to empty catch blocks

**Files:**

- Modify: `packages/agent/src/server.ts` (multiple locations)

**Step 1: Find and add logging to empty catches**

Search for `catch {}` and `catch {\n` patterns in server.ts and add appropriate
logging. For each catch block, add minimal logging that explains what failed:

```typescript
// Example transforms:

// Before:
} catch {
  // ignore
}

// After:
} catch (err) {
  logger.debug('Failed to close peer connection', { error: String(err) });
}
```

Focus on these specific areas:

- Line ~1358-1363: Permission request failures
- Line ~1815-1817: Peer close failures
- Line ~1820-1823: Transport close failures
- Line ~2069-2071: Events file read failures (these can stay silent)
- Line ~2145-2147: Malformed event line parsing (these can stay silent)
- Line ~3063-3065: Process kill failures

**Step 2: Run tests**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/agent/src/server.ts
git commit -m "$(cat <<'EOF'
chore: add debug logging to empty catch blocks

Helps diagnose issues in production without hiding errors completely.
Silent catches are preserved only for expected conditions (missing files,
malformed data).
EOF
)"
```

---

### Task 10: Fix `any` type cast in subagent update forwarding

**Files:**

- Modify: `packages/agent/src/server.ts:1538-1540`

**Step 1: Add proper typing**

Around line 1538, change:

```typescript
childPeer.onRequest('session/update', async (params) => {
  const p = params as Record<string, unknown>;
```

To use a more specific type or add runtime validation. Since session/update has
many shapes, the `Record<string, unknown>` is appropriate but we can be more
careful about how we access properties:

```typescript
childPeer.onRequest('session/update', async (params: unknown) => {
  if (!params || typeof params !== 'object') return undefined;
  const p = params as Record<string, unknown>;
  const type = typeof p.type === 'string' ? p.type : undefined;
```

Also check line ~228-232 (extractTextFromContentBlocks) which has
`(b as any).type`:

```typescript
function extractTextFromContentBlocks(content: unknown[]): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (b): b is { type: 'text'; text: string } =>
        b !== null &&
        typeof b === 'object' &&
        'type' in b &&
        (b as { type: unknown }).type === 'text' &&
        'text' in b &&
        typeof (b as { text: unknown }).text === 'string'
    )
    .map((b) => b.text)
    .join('\n');
}
```

**Step 2: Run linting**

Run: `npm run lint -- packages/agent/src/server.ts` Expected: No `any` type
errors

**Step 3: Run tests**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`
Expected: All tests pass

**Step 4: Commit**

```bash
git add packages/agent/src/server.ts
git commit -m "$(cat <<'EOF'
fix: remove any type casts in job handling code

Uses proper type guards and Record<string, unknown> instead of any for
better type safety.
EOF
)"
```

---

### Task 11: Cache deriveJobsForActiveSession results (optional optimization)

**Files:**

- Modify: `packages/agent/src/server.ts:2051-2157`

**Step 1: Add caching with invalidation**

Add a cache variable in state:

```typescript
type ServerState = {
  // ... existing fields
  jobListCache?: {
    sessionId: string;
    eventsModTime: number;
    jobs: Array<{
      /* job list type */
    }>;
  };
};
```

Modify deriveJobsForActiveSession to use cache:

```typescript
const deriveJobsForActiveSession = (): Array<{
  // ... return type
}> => {
  if (!state.activeSession) return [];

  const sessionDir = state.activeSession.dir;
  const eventsPath = join(sessionDir, 'events.jsonl');

  // Check cache validity
  let modTime = 0;
  try {
    modTime = statSync(eventsPath).mtimeMs;
  } catch {
    return [];
  }

  if (
    state.jobListCache &&
    state.jobListCache.sessionId === state.activeSession.meta.sessionId &&
    state.jobListCache.eventsModTime === modTime
  ) {
    return state.jobListCache.jobs;
  }

  // ... existing implementation ...

  const result = Array.from(byId.values());

  // Update cache
  state.jobListCache = {
    sessionId: state.activeSession.meta.sessionId,
    eventsModTime: modTime,
    jobs: result,
  };

  return result;
};
```

**Step 2: Run tests**

Run:
`npm test -- --run packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/agent/src/server.ts
git commit -m "$(cat <<'EOF'
perf: cache deriveJobsForActiveSession results

Uses file modification time to invalidate cache. Reduces repeated file
parsing for job list queries.
EOF
)"
```

---

## Summary

After completing all tasks:

1. Run full test suite: `npm test -- --run`
2. Run linting: `npm run lint`
3. Use superpowers:finishing-a-development-branch skill to complete the work
