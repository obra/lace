# Job Test Failure Triage and Handler Audit Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Fix the 10 failing job-related E2E tests and audit for any other
handlers accidentally removed during refactoring.

**Architecture:** The bug is in how `createRunShellJobProcess` receives state.
It gets a snapshot of `state.activeSession` at creation time (null), but should
use a getter pattern like `runSubagentJobProcess` does.

**Tech Stack:** TypeScript, Vitest

---

## Root Cause Analysis

### The Bug

In `packages/agent/src/server.ts` lines 375-385:

```typescript
const runShellJobProcess = createRunShellJobProcess({
  state: {
    activeSession: state.activeSession, // <-- CAPTURED AT CREATION TIME (null!)
    config: state.config,
    jobStreaming: state.jobStreaming,
  },
  // ...
});
```

But `state.activeSession` is `null` when `registerAgentRpcMethods` is called.
The value is captured as a snapshot, so when `runShellJobProcess` is called
later (after a session is loaded), it still sees `null`.

Compare with the correct pattern used for subagent jobs (lines 387-395):

```typescript
const runSubagentJobProcess = (job: JobState) => {
  runSubagentJobProcessImpl(job, {
    getState: () => state, // <-- FUNCTION THAT RETURNS CURRENT STATE
    // ...
  });
};
```

### Failing Tests

All 10 failing tests involve shell job execution that requires `activeSession`:

1. `job completion: spawn short job, wait for completion, verify output`
2. `job persistence: jobs survive agent restart`
3. `job error handling: job with non-zero exit code`
4. `session switch kills running jobs`
5. `injects completion notification when background job finishes`
6. `injects failure notification when background job fails`
7. `automatically triggers a turn when job completes and agent is idle`
8. `spawns a shell job, streams updates, and persists output`
9. `can cancel a job while it is awaiting permission`
10. `covers job output pagination, blocking, and kill success for shell jobs`

---

## Task 1: Write Failing Unit Test for Shell Job State Access

**Files:**

- Create: `packages/agent/src/jobs/__tests__/shell-job.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/agent/src/jobs/__tests__/shell-job.test.ts
// ABOUTME: Tests for shell job state access pattern

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRunShellJobProcess } from '../shell-job';
import type { JobState } from '../../server-types';

describe('createRunShellJobProcess', () => {
  it('should use current activeSession state, not captured value', async () => {
    // Simulate the pattern where activeSession starts null
    // and is later populated
    const mutableState = {
      activeSession: null as {
        dir: string;
        meta: { sessionId: string; workDir: string };
      } | null,
      config: { approvalMode: 'dangerouslySkipPermissions' as const },
      jobStreaming: 'full' as const,
    };

    const mockEmitSessionUpdate = vi.fn().mockResolvedValue(undefined);
    const mockFinalizeJob = vi.fn().mockResolvedValue(undefined);
    const mockRequestPermission = vi
      .fn()
      .mockResolvedValue({ decision: 'allow' });
    const mockRunExclusive = vi.fn().mockImplementation((fn) => fn());

    // Create the runner with null activeSession (like server.ts does)
    const runShellJobProcess = createRunShellJobProcess({
      state: mutableState, // Pass reference, not snapshot
      runExclusive: mockRunExclusive,
      emitSessionUpdate: mockEmitSessionUpdate,
      requestPermissionFromClient: mockRequestPermission,
      finalizeJob: mockFinalizeJob,
    });

    // Simulate session being loaded after runner creation
    mutableState.activeSession = {
      dir: '/tmp/test-session',
      meta: { sessionId: 'test-session', workDir: '/tmp/work' },
    };

    const job: JobState = {
      jobId: 'job_test',
      type: 'bash',
      status: 'running',
      command: 'echo hello',
      startedAt: new Date().toISOString(),
      outputPath: '/tmp/test-output',
      finished: false,
      completion: Promise.resolve(),
      resolveCompletion: vi.fn(),
    };

    // Run the job - should NOT immediately return due to null activeSession
    runShellJobProcess(job);

    // Wait a tick for async execution
    await new Promise((r) => setTimeout(r, 100));

    // Job should have been processed (not silently skipped)
    // If the bug exists, finalizeJob won't be called because activeSession was null
    expect(mockFinalizeJob).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run packages/agent/src/jobs/__tests__/shell-job.test.ts`
Expected: FAIL - the test should fail because the current code captures
`activeSession` at creation time

**Step 3: Commit the failing test**

```bash
git add packages/agent/src/jobs/__tests__/shell-job.test.ts
git commit -m "test(jobs): add failing test for shell job state access pattern"
```

---

## Task 2: Fix Shell Job State Access Pattern

**Files:**

- Modify: `packages/agent/src/jobs/shell-job.ts`
- Modify: `packages/agent/src/server.ts`

**Step 1: Update ShellJobContext type to use getter pattern**

In `packages/agent/src/jobs/shell-job.ts`, change the `state` property to a
function:

```typescript
export type ShellJobContext = {
  getState: () => {
    activeSession: LoadedSession | null;
    config: {
      approvalMode:
        | 'ask'
        | 'approveReads'
        | 'approveEdits'
        | 'approve'
        | 'deny'
        | 'dangerouslySkipPermissions';
    };
    jobStreaming: 'none' | 'all' | string;
  };
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>;
  emitSessionUpdate: (
    update: SessionUpdate & { sessionId?: string; streamSeq?: number }
  ) => Promise<void>;
  requestPermissionFromClient: (request: {
    sessionId: string;
    turnId: string;
    turnSeq: number;
    jobId: string;
    toolCallId: string;
    tool: string;
    kind: string;
    resource: string;
    options: { optionId: string; label: string }[];
    input: Record<string, unknown>;
    signal: AbortSignal;
  }) => Promise<{ decision?: string; updatedInput?: Record<string, unknown> }>;
  finalizeJob: (
    job: JobState,
    options?: { exitCode?: number }
  ) => Promise<void>;
};
```

**Step 2: Update createRunShellJobProcess to use getState()**

Replace all `context.state.` with `context.getState().`:

```typescript
export const createRunShellJobProcess = (context: ShellJobContext) => {
  return (job: JobState) => {
    void (async () => {
      const state = context.getState();
      if (!state.activeSession) return;
      if (job.proc || job.finished) return;

      const sessionState = readSessionState(state.activeSession.dir);
      const effectiveConfig = sessionState.config
        ? { ...state.config, ...sessionState.config }
        : state.config;
      // ... rest uses `state` variable
    })();
  };
};
```

**Step 3: Update server.ts to pass getState function**

In `packages/agent/src/server.ts`, change:

```typescript
const runShellJobProcess = createRunShellJobProcess({
  getState: () => ({
    activeSession: state.activeSession,
    config: state.config,
    jobStreaming: state.jobStreaming,
  }),
  runExclusive,
  emitSessionUpdate,
  requestPermissionFromClient: _requestPermissionFromClient,
  finalizeJob,
});
```

**Step 4: Run the unit test to verify it passes**

Run: `npm test -- --run packages/agent/src/jobs/__tests__/shell-job.test.ts`
Expected: PASS

**Step 5: Run all job E2E tests**

Run:
`npm test -- --run src/__tests__/agent-process.async-workflow.e2e.test.ts src/__tests__/agent-process.jobs.e2e.test.ts`
Expected: All tests should pass

**Step 6: Commit the fix**

```bash
git add packages/agent/src/jobs/shell-job.ts packages/agent/src/server.ts
git commit -m "fix(jobs): use getState() pattern for shell jobs to get current activeSession"
```

---

## Task 3: Audit for Other Missing Handlers

**Files:**

- Read: Compare handler counts

**Step 1: Verify all handlers are present**

Run the following to compare handlers before and after refactoring:

```bash
# Get handlers from before extraction
cd /Users/jesse/Documents/GitHub/lace
git show e38bc5267~1:packages/agent/src/server.ts | grep -E "peer\.onRequest\(" | wc -l

# Get current handlers
grep -r "peer\.onRequest\(" packages/agent/src/rpc/handlers/ | wc -l
```

Both should show 46 handlers.

**Step 2: List all handlers for verification**

```bash
# Before
git show e38bc5267~1:packages/agent/src/server.ts | grep -E "peer\.onRequest\(" | sed "s/.*'\([^']*\)'.*/\1/" | sort

# After
grep -r "peer\.onRequest\(" packages/agent/src/rpc/handlers/ | sed "s/.*'\([^']*\)'.*/\1/" | sort
```

Compare the two lists - they should be identical.

**Step 3: Document findings**

If any handlers are missing, add them to the appropriate handler file following
the existing pattern.

---

## Task 4: Run Full Test Suite

**Step 1: Run agent tests**

```bash
cd packages/agent && npm test -- --run
```

Expected: All 221 tests pass (0 failures)

**Step 2: Run web tests**

```bash
cd packages/web && npm test -- --run
```

Expected: All 1184+ tests pass

**Step 3: Commit documentation**

```bash
git add docs/plans/2025-01-10-job-test-triage.md
git commit -m "docs: add job test triage plan with root cause analysis"
```

---

## Summary

| Issue                       | Root Cause                                                                | Fix                                     |
| --------------------------- | ------------------------------------------------------------------------- | --------------------------------------- |
| 10 job tests timing out     | `createRunShellJobProcess` captures `state.activeSession` snapshot (null) | Change to `getState()` function pattern |
| Missing `ent/personas/list` | Accidentally removed in cleanup commit                                    | Restored in `rpc/handlers/tools.ts`     |
| Handler audit               | Potential for other missing handlers                                      | Verified all 46 handlers present        |
