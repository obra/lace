# Tool Description Workshop Plan

**Goal:** Improve async job tool descriptions so agents understand the workflow
without prior knowledge.

**Approach:** Draft descriptions → Test with haiku subagents → Iterate until
haiku succeeds

---

## Phase 1: Analyze Current State

### Current Descriptions (Problems)

| Tool       | Current Description               | Issues                                                                  |
| ---------- | --------------------------------- | ----------------------------------------------------------------------- |
| bash       | "Execute shell commands..."       | `run_async` undocumented                                                |
| delegate   | "Spawn a background subagent..."  | `run_async` and `resume` undocumented, references internal "ent/job/\*" |
| job_output | "Retrieve status and output..."   | Response format unclear, cursor unexplained                             |
| jobs_list  | "List current and recent..."      | Relationship to other tools unclear                                     |
| job_kill   | "Cancel a running background job" | Fine, but no workflow context                                           |

### Missing Conceptual Framework

An agent needs to understand:

1. **When** to use async (long-running tasks, parallel work)
2. **What** async returns (jobId)
3. **How** to monitor (job_output with block=true or polling)
4. **How** to manage (jobs_list to see all, job_kill to cancel)
5. **How** to recover (delegate resume=jobId for failed subagents)

---

## Phase 2: Draft Improved Descriptions

### bash

```
Execute shell commands in isolated bash processes.

**Async mode:** Set run_async=true for long-running commands. Returns immediately with jobId. Monitor with job_output(jobId). Example response: "Async job started: job_abc123"

**Sync mode (default):** Blocks until command completes. Output truncated to first 100 + last 50 lines.

Exit codes shown even for successful tool execution. Chain commands with && or ;.
```

### delegate

```
Spawn a subagent to handle a task autonomously.

**Sync mode (default):** Blocks until subagent completes and returns its full output.

**Async mode:** Set run_async=true to return immediately with jobId. Monitor progress with job_output(jobId, block=false) or wait with job_output(jobId, block=true).

**Resume failed jobs:** If a subagent job failed or was cancelled, use resume=jobId to continue from where it left off. The subagent's session state is preserved.

Parameters:
- prompt: The task for the subagent
- description: Optional label shown in job listings
- run_async: Return immediately with jobId instead of waiting
- resume: JobId of a previous failed/cancelled subagent job to continue
```

### job_output

```
Get status and output from a background job (started with run_async=true).

**Blocking (default):** Waits up to timeoutMs for job completion, then returns status and output.

**Non-blocking:** Set block=false to check current status without waiting.

**Incremental reads:** Use cursor to read output incrementally (cursor = byte offset). Useful for streaming long output.

Returns: { status: "running"|"completed"|"failed"|"cancelled", output: string, exitCode?: number }
```

### jobs_list

```
List all background jobs in the current session. Use to find jobIds for job_output or job_kill.

Filter by:
- status: ["running", "completed", "failed", "cancelled"]
- type: ["shell", "subagent"]

Returns array of: { jobId, type, status, description, startTime }
```

### job_kill

```
Cancel a running background job. Use jobs_list to find running jobs.

Only jobs with status="running" can be killed. After killing, status becomes "cancelled".

For subagent jobs, the subagent's session is preserved - use delegate(resume=jobId) to continue later.
```

---

## Phase 3: Haiku Validation Tests

### Test 1: Basic Async Bash

**Task:** "Run `sleep 5 && echo done` in the background, then check if it's
still running" **Success criteria:** Haiku uses run_async=true, gets jobId,
calls job_output

### Test 2: Parallel Work

**Task:** "Run three commands in parallel: `echo one`, `echo two`, `echo three`.
Collect all outputs." **Success criteria:** Haiku spawns 3 async jobs, waits for
all with job_output

### Test 3: Kill Long Job

**Task:** "Start a `sleep 60` in the background, then cancel it immediately"
**Success criteria:** Haiku uses run_async, then job_kill

### Test 4: Subagent Workflow

**Task:** "Delegate a task to search for all TypeScript files, run it async,
wait for completion" **Success criteria:** Haiku uses delegate(run_async=true),
then job_output to wait

### Test 5: Resume Understanding

**Task:** "If a subagent job failed, how would you continue its work?" **Success
criteria:** Haiku explains delegate(resume=jobId) without being told

---

## Phase 4: Iteration Loop

```
while haiku_fails_tests:
    identify_confusion_point()
    revise_description()
    rerun_tests()
```

---

## Execution Steps

1. [ ] Update tool descriptions in implementations/\*.ts
2. [ ] Run Test 1-5 with haiku subagents
3. [ ] Document failures and confusion points
4. [ ] Revise descriptions based on failures
5. [ ] Repeat until all tests pass
6. [ ] Commit final descriptions
