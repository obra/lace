# Async Jobs (Background Execution) — Full Implementation Plan

Date: 2025-01-08
Updated: 2025-01-08 (validation pass)

## Goal

Implement a unified, ephemeral **async jobs** system for Lace that supports:

- Running **bash shell commands** either foreground or detached async
- Running **ENT-protocol subagents** (via `delegate`) either foreground or detached async
- Observability + control:
  - list current/recent jobs
  - retrieve job output incrementally
  - kill/cancel running jobs

This plan intentionally prefers the simplest workable system:

- Jobs are **ephemeral** (do not need to survive process restarts)
- Output buffering uses **plain text + byte offsets** (with streaming updates via protocol)
- Cancellation for subagents uses the **existing abort primitive**
- Tool naming is Lace-native (mapped to ENT protocol methods for supervisor communication)

Non-goals (for v1):

- Durable persistence across restarts
- Remote/cloud agent execution
- Structured output/event logs (JSONL)
- Complex scheduling / retries / priorities

---

## Protocol Alignment

This spec defines **agent-facing tools** that the parent agent uses to spawn and manage jobs.
These tools are implemented inside the agent process and map to **ENT protocol methods** for
supervisor visibility:

| Agent Tool | ENT Protocol Method | Direction |
|------------|---------------------|-----------|
| `delegate` / `bash` (run_async) | → `session/update` with `job_started` | Agent → Supervisor |
| `jobs_list` | Supervisor calls `ent/job/list` | Supervisor → Agent |
| `job_output` | Supervisor calls `ent/job/output` | Supervisor → Agent |
| `job_kill` | Supervisor calls `ent/job/kill` | Supervisor → Agent |
| (progress) | → `session/update` with `job_update` | Agent → Supervisor |
| (completion) | → `session/update` with `job_finished` | Agent → Supervisor |

The agent **spawns and manages subagent processes directly**. The supervisor sees subagents as
jobs via protocol notifications. Per ENT protocol §1: "the **agent process** is responsible for
spawning and managing subagent processes. The supervisor/client sees subagents as background jobs."

---

## Glossary

- **Job**: a unit of background or foreground work tracked by the system.
- **Detached async**: the tool returns immediately with a `jobId` while work continues.
- **Cursor**: byte offset into a job output file used for incremental reads.
- **Subagent process**: A child agent process spawned by the parent agent via stdio transport.
- **Job ID**: Unique identifier following the pattern `job_{type}_{ulid}` (e.g., `job_shell_01HXYZ...`, `job_agent_01HXYZ...`).

---

## User-Facing Tools

### 1) `bash`

#### Purpose
Execute a shell command, optionally detached.

#### Input schema
```ts
type BashInput = {
  command: string;
  description?: string;
  timeoutMs?: number;          // foreground only (see behavior)
  run_async?: boolean;         // default false
};
```

#### Output schema
Foreground:
```ts
type BashForegroundOutput = {
  status: "completed" | "failed";
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};
```

Detached async:
```ts
type BashAsyncLaunchOutput = {
  status: "async_launched";
  jobId: string;
  message?: string;
};
```

#### Behavior
- If `run_async !== true`:
  - execute command to completion
  - return stdout/stderr/exitCode
  - apply `timeoutMs` (if omitted, use the system default)
- If `run_async === true`:
  - do **not** block
  - spawn the process under the job supervisor
  - register a `bash` job record
  - stream stdout/stderr to job output buffer
  - return `async_launched` with `jobId`

Notes:
- Do not require users to append `&`.
- `timeoutMs` for async jobs: v1 recommendation is **ignore** it (or treat it as max runtime if you already have that concept). Keep behavior explicit and documented.

---

### 2) `delegate`

#### Purpose
Spawn an ENT-protocol subagent, optionally detached.

#### Input schema
```ts
type DelegateInput = {
  prompt: string;
  description?: string;
  agentType?: string;          // agent profile (e.g., "general-purpose", "Explore", "Plan")
  model?: string;              // optional model override ("sonnet" | "opus" | "haiku" | inherit)
  run_async?: boolean;         // default false
  resume?: string;             // optional jobId to resume a previous agent session
  maxTurns?: number;           // optional limit on agent turns
};
```

#### Output schema
Foreground:
```ts
type DelegateForegroundOutput = {
  status: "completed" | "failed";
  jobId: string;               // can be used with resume= for follow-up
  content: string;             // final agent response (or summary)
  durationMs: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd?: number;
  };
  toolUseCount?: number;       // total tool invocations
};
```

Detached async:
```ts
type DelegateAsyncLaunchOutput = {
  status: "async_launched";
  jobId: string;
  message?: string;
};
```

#### Behavior
- If `run_async !== true`:
  - run subagent to completion
  - return final result content
- If `run_async === true`:
  - register an `agent` job
  - start ENT execution in background using the existing abort primitive
  - append progress + outputs to the job output buffer
  - return immediately with `jobId`

Progress logging format (plain text, v1):
- prefix tool uses / steps with readable markers, e.g.
  - `[tool] <name> <input summary>`
  - `[agent] <streamed token chunk>`
  - `--- RESULT ---` / `--- ERROR ---`

#### Subagent Process Spawning Model

The parent agent spawns subagent processes using the same Lace agent binary via stdio.
**Subagents are full agents with their own durable sessions** - no special "sidechain" storage.

```
Parent Agent Process
      │
      ├──▶ spawn("lace-agent", ["--subagent", "--job-id=..."])
      │         │
      │         └── Subagent Process (stdin/stdout JSON-RPC)
      │               ├── initialize (inherit parent config subset)
      │               ├── session/new → returns subagentSessionId
      │               ├── session/prompt (with task prompt)
      │               └── ... autonomous operation with durable session ...
      │
      └──▶ forward job_update events to supervisor
```

**Subagent initialization:**
1. Parent spawns child process with `--subagent` flag
2. Parent sends `initialize` with subagent-specific config:
   - `connectionId` / `modelId` (inherit or override per agent type)
   - `mcpServers`: explicitly listed servers the parent grants to this subagent
   - `enableFileCheckpointing`: true (subagent gets its own checkpointing)
   - NO inheritance of parent's `approvalMode` - subagent uses its own policy
3. Parent sends `session/new` with workDir → receives `subagentSessionId`
4. Parent stores `subagentSessionId` in job record (for resume capability)
5. Parent sends `session/prompt` with the task prompt
6. Child runs autonomously, sending `session/update` notifications
7. Parent forwards job updates to supervisor
8. Parent relays permission requests (if any) to supervisor with `jobId` context

**Subagent session durability:**
- Subagent session is a full durable session (same as any agent session)
- All conversation events are persisted via standard event-sourcing
- Session survives process restarts
- No special "sidechain" or separate transcript storage needed

**Permission handling for async subagents:**
- Parent does NOT pass its own `approvalMode` to the child
- Subagent uses its own permission policy (default or configured per agent type)
- For async subagents that cannot prompt interactively, parent should relay permission
  requests to the supervisor via `session/request_permission` with the `jobId` field set
- Supervisor can respond with decision, which parent forwards to subagent

**Nested subagents:**
- Subagents can spawn their own subagents (recursive)
- Each nested job gets a unique `jobId`
- Parent uses `parentJobId` to track hierarchy
- All jobs are flattened in `job_update` / `job_started` / `job_finished` events

#### Job Resume

Failed, stalled, or interrupted agent jobs can be resumed using the `resume` parameter:

```typescript
// Resume a previous job
delegate({
  prompt: "Continue where you left off and finish the task",
  resume: "job_agent_01HXYZ...",  // jobId of previous agent job
});
```

**Resume flow:**
1. Look up job record by `jobId`
2. Retrieve `subagentSessionId` from job record
3. Spawn new subagent process
4. `initialize` with same config as original job
5. `session/load(subagentSessionId)` - loads the durable session
6. `session/prompt(continuation prompt)` - continues the conversation
7. Subagent resumes from where it left off (full conversation history restored)

**Resume use cases:**
- Job failed due to transient error (API timeout, rate limit)
- Job was cancelled but work should continue
- Process crashed mid-execution
- User wants to provide additional guidance to a running task

**What gets preserved on resume:**
- Full conversation history (all user/assistant messages)
- Tool call history and results
- File read state (which files have been read)
- Any checkpointed state

**What does NOT get preserved:**
- In-flight API calls (will need to retry)
- Ephemeral process state (variables, etc.)

**Shell job "resume":**
- Shell jobs cannot truly resume (process is gone)
- Use `retry: true` semantic instead - re-runs the same command
- Or just call bash again with the same command

---

### 3) `job_output`

#### Purpose
Retrieve job status and incremental output from a running or completed job.

#### Input schema
```ts
type JobOutputInput = {
  jobId: string;
  block?: boolean;             // default true
  timeoutMs?: number;          // default 30_000
  cursor?: number;             // byte offset; default 0
  maxBytes?: number;           // default e.g. 30_000 (prevent huge responses)
};
```

#### Output schema
```ts
type JobOutputResult = {
  retrievalStatus: "success" | "not_ready" | "timeout";
  job: {
    id: string;
    type: "bash" | "agent";
    status: "pending" | "running" | "completed" | "failed" | "killed";
    description: string;
    startTimeMs: number;
    endTimeMs?: number;
  };
  output?: string;             // chunk from output buffer
  nextCursor: number;          // byte offset to use next time
};
```

#### Behavior
- Validate `jobId` exists.
- If `block === false`:
  - return immediately
  - `retrievalStatus = not_ready` if job still `pending|running`
  - otherwise `success`
  - include any new output since `cursor`
- If `block === true`:
  - wait until job reaches terminal state or timeout
  - poll status (e.g. every 100ms)
  - return `timeout` if still running when timeout exceeded
  - always include output chunk since cursor

Important: `job_output` must be safe + read-only.

---

### 4) `jobs_list`

#### Purpose
Show current and recent jobs to discover IDs.

#### Input schema
```ts
type JobsListInput = {
  status?: Array<"pending"|"running"|"completed"|"failed"|"killed">;
  type?: Array<"bash"|"agent">;
  limit?: number;              // default e.g. 50
  includeCompleted?: boolean;  // default true (ephemeral means “recent in memory”)
};
```

#### Output schema
```ts
type JobsListResult = {
  jobs: Array<{
    id: string;
    type: "bash" | "agent";
    status: "pending" | "running" | "completed" | "failed" | "killed";
    description: string;
    startTimeMs: number;
    endTimeMs?: number;
  }>;
};
```

---

### 5) `job_kill`

#### Purpose
Terminate a running job.

#### Input schema
```ts
type JobKillInput = {
  jobId: string;
};
```

#### Output schema
```ts
type JobKillResult = {
  success: boolean;
  jobId: string;
  previousStatus?: string;
  status?: string;
  message: string;
};
```

#### Behavior
- Validate job exists
- Validate job is `running` (or allow `pending` → treat as cancel)
- If job type is:
  - `bash`: send termination to underlying process (escalation recommended)
  - `agent`: call existing abort primitive
- Update job status to `killed`, set `endTimeMs`

---

## Internal Architecture

### A) Job Registry (in-memory)

#### Responsibilities
- Create job IDs (format: `job_{type}_{ulid}`)
- Store job records in memory
- Enforce valid state transitions
- Provide lookup/list APIs
- Emit protocol notifications on state changes

#### Job ID Generation

Per ENT protocol §6.6 guidance:
```ts
function generateJobId(type: "shell" | "agent"): string {
  // ULID provides sortability and uniqueness
  return `job_${type}_${ulid()}`;
}
// Examples: job_shell_01HXYZ123ABC, job_agent_01HXYZ456DEF
```

**Requirements:**
- Globally unique within session lifetime
- Includes type prefix for easy identification
- ULID suffix provides time-ordering and collision resistance

#### Full job record
```ts
type JobRecord = {
  id: string;                    // job_shell_... or job_agent_...
  parentJobId?: string;          // if spawned by another job (nested subagent)
  type: "shell" | "agent";       // renamed from "bash"/"agent" for protocol alignment
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  description: string;
  startTime: string;             // ISO 8601
  endTime?: string;              // ISO 8601

  outputFilePath: string;
  outputTotalBytes: number;      // for pagination metadata

  // shell-specific
  command?: string;
  pid?: number;
  exitCode?: number;

  // agent-specific
  prompt?: string;
  agentType?: string;
  model?: string;
  subagentSessionId?: string;    // the subagent's own durable session (for resume)
  childProcess?: ChildProcess;   // for stdio communication
  abortController?: AbortController;

  // progress tracking (for agents)
  progress?: {
    toolUseCount: number;
    tokenCount: number;
    lastActivity?: string;       // e.g., "Running grep..."
  };

  // completion data
  result?: {
    summary: string;             // brief description of what happened
    artifacts?: string[];        // file paths or other outputs
    error?: string;              // error message if failed
  };

  // notification tracking
  notifiedSupervisor: boolean;   // has job_finished been sent?
};
```

**Key field: `subagentSessionId`** - This is the subagent's own session ID, enabling:
- Full session durability (standard event-sourcing)
- Resume capability via `session/load`
- No special "sidechain" storage needed

#### State transitions
Allowed:
- `pending -> running`
- `running -> completed|failed|cancelled`
- `pending -> cancelled`

Terminal states: `completed`, `failed`, `cancelled`.

**Note:** Using `cancelled` instead of `killed` for protocol alignment with ENT.

---

### B) Output Buffering (plain text file)

#### Responsibilities
- Create `{sessionDir}/jobs/{jobId}.out` (or similar)
- Append output as it arrives
- Support incremental reads by byte offset

#### Conventions
- stdout lines: write as-is
- stderr lines: prefix with `[stderr] ` (keeps a single file while preserving signal)
- agent progress: prefix markers like `[agent]` / `[tool]`
- completion marker:
  - `--- RESULT ---` then final result
- failure marker:
  - `--- ERROR ---` then message/stack

#### Read API
Inputs: `filePath`, `cursor`, `maxBytes`
Returns: `{ text, nextCursor }`

Implementation detail: use `fs.stat` + `fs.open` + `fs.read` from `cursor` for `maxBytes`.

---

### C) Bash Job Supervisor

#### Responsibilities
- Spawn process
- Wire stdout/stderr to output file
- Update registry on exit
- Implement kill escalation

#### Kill escalation
Recommended sequence:
- SIGINT
- wait 1s
- SIGTERM
- wait 2s
- SIGKILL

(Exact timing depends on your platform.)

---

### D) ENT Agent Job Runner

#### Responsibilities
- Spawn subagent process via `lace-agent --subagent`
- Initialize subagent with ENT protocol handshake
- Stream events (assistant output, tool invocations) to both output file AND supervisor
- On completion/failure, update job record and emit `job_finished`
- Support cancellation via abort primitive

#### Subagent Process Lifecycle

```ts
async function runAgentJob(job: JobRecord, config: AgentJobConfig): Promise<void> {
  // 1. Spawn subagent process
  const child = spawn('lace-agent', [
    '--subagent',
    `--job-id=${job.id}`,
    `--parent-session=${config.sessionId}`,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  job.childProcess = child;
  job.status = 'running';
  emitJobStarted(job);

  // 2. Set up JSON-RPC transport over stdio
  const transport = new NdjsonTransport(child.stdin, child.stdout);

  // 3. Initialize subagent
  await transport.request('initialize', {
    protocolVersion: '1.0',
    clientInfo: { name: 'lace-parent', version: '1.0' },
    capabilities: { streaming: true, permissions: true },  // parent relays permissions
    config: {
      connectionId: config.connectionId,
      modelId: config.modelId,
      mcpServers: config.grantedMcpServers,  // only servers parent explicitly grants
      enableFileCheckpointing: true,          // subagent gets its own checkpointing
      // NO approvalMode inheritance - subagent uses its own policy
    }
  });

  // 4. Create session (or load existing for resume)
  let subagentSessionId: string;

  if (config.resumeJobId) {
    // Resume: load existing session from previous job
    const previousJob = lookupJob(config.resumeJobId);
    if (!previousJob?.subagentSessionId) {
      throw new Error(`Cannot resume job ${config.resumeJobId}: no subagentSessionId`);
    }
    subagentSessionId = previousJob.subagentSessionId;
    await transport.request('session/load', { sessionId: subagentSessionId });
  } else {
    // New job: create fresh session
    const sessionResult = await transport.request('session/new', {
      workDir: config.workDir,
      systemPrompt: config.systemPrompt,
    });
    subagentSessionId = sessionResult.sessionId;
  }

  // Store sessionId in job record for future resume capability
  job.subagentSessionId = subagentSessionId;

  // 5. Send prompt and stream updates
  const promptResult = transport.request('session/prompt', {
    content: [{ type: 'text', text: job.prompt }],
    maxTurns: config.maxTurns,
  });

  // 6. Forward session/update notifications
  transport.onNotification('session/update', (update) => {
    // Write to output file
    appendToOutputFile(job.outputFilePath, formatUpdate(update));
    job.outputTotalBytes = getFileSize(job.outputFilePath);

    // Update progress tracking
    if (update.type === 'tool_use') {
      job.progress.toolUseCount++;
      job.progress.lastActivity = `Running ${update.name}...`;
    }
    if (update.type === 'usage') {
      job.progress.tokenCount += update.inputTokens + update.outputTokens;
    }

    // Forward to supervisor as job_update
    emitJobUpdate(job.id, update);
  });

  // 6b. Handle permission requests from subagent
  transport.onRequest('session/request_permission', async (req) => {
    // Relay to supervisor with jobId context
    const decision = await supervisor.request('session/request_permission', {
      ...req.params,
      jobId: job.id,  // add job context so supervisor knows which job is asking
    });
    return decision;  // forward supervisor's decision back to subagent
  });

  // 7. Handle completion
  try {
    const result = await promptResult;
    job.status = 'completed';
    job.result = {
      summary: extractSummary(result.content),
      artifacts: extractArtifacts(result.content),
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      job.status = 'cancelled';
    } else {
      job.status = 'failed';
      job.result = { summary: '', error: error.message };
    }
  } finally {
    job.endTime = new Date().toISOString();
    child.kill();
    emitJobFinished(job);
  }
}
```

#### Cancellation
- Store per-job abort controller in the registry
- `job_kill` triggers abort signal
- Abort propagates to child process (SIGTERM)
- Runner catches AbortError and sets status to `cancelled`

#### Protocol Notification Forwarding

When the subagent emits `session/update`, the parent wraps it in `job_update`:

```ts
function emitJobUpdate(jobId: string, innerUpdate: SessionUpdate): void {
  supervisor.notify('session/update', {
    sessionId: currentSessionId,
    streamSeq: nextStreamSeq(),
    type: 'job_update',
    jobId: jobId,
    parentJobId: job.parentJobId,
    jobType: 'subagent',
    update: innerUpdate,  // the original session/update from subagent
  });
}
```

This allows the supervisor to render subagent activity in real-time while keeping
the full output available via `ent/job/output` for retrieval.

---

### E) Job Polling / Blocking Wait (for `job_output`)

#### Requirements
- Implement a wait loop when `block=true`:
  - poll registry state every ~100ms
  - stop on terminal state
  - stop on timeout

Jobs are ephemeral; if Lace exits, outstanding jobs will be orphaned. That’s acceptable in v1.

---

### F) ENT Protocol Method Handlers

The agent implements these protocol methods for supervisor communication:

#### `ent/job/list` Handler

```ts
interface JobListRequest {
  // no params required
}

interface JobListResponse {
  jobs: Array<{
    jobId: string;
    parentJobId?: string;
    type: "shell" | "subagent";
    status: "running" | "completed" | "failed" | "cancelled";
    description?: string;
    command?: string;              // for shell jobs
    startTime: string;
    parentToolUseId?: string;      // the tool_use that spawned this job
  }>;
}
```

#### `ent/job/output` Handler

```ts
interface JobOutputRequest {
  jobId: string;
  block?: boolean;      // default false for protocol (agent tool default is true)
  timeout?: number;     // max wait ms
  tailBytes?: number;   // return only last N bytes
  afterOffset?: number; // return output after this byte offset
}

interface JobOutputResponse {
  status: "running" | "completed" | "failed" | "cancelled";
  output: string;       // raw output (may be truncated)
  exitCode?: number;    // for shell jobs
  outputMeta?: {
    totalBytes: number;
    returnedOffset: number;
    returnedBytes: number;
    truncated: boolean;
  };
  report?: {            // structured summary for parent context
    summary: string;
    artifacts?: string[];
    error?: string;
  };
}
```

**Note on `report`:** Per ENT protocol §6.7, the parent agent SHOULD incorporate
only `report` (not raw `output`) into its LLM context to avoid bloat. The supervisor
can display full output to users, but the agent's context stays clean.

#### `ent/job/kill` Handler

```ts
interface JobKillRequest {
  jobId: string;
}

interface JobKillResponse {
  success: boolean;
}
```

#### `ent/job/inject` Handler (notification, optional for v1)

```ts
interface JobInjectNotification {
  jobId: string;
  content: ContentBlock[];
  priority: "immediate" | "normal" | "deferred";
}
```

This allows the supervisor to inject context into a running job. For v1, this
is optional—can be deferred to a future enhancement.

---

## Errors and Edge Cases

### Tool-level errors
- `job_output`: unknown job → error `No job found with ID: ...`
- `job_kill`: unknown job → error
- `job_kill`: job not running → return success=false with message (do not throw unless you prefer strictness)

### Output growth
- Since ephemeral, simplest is keep outputs in temp session dir.
- Optional: cap output file size per job (future enhancement).

### Concurrent access
- Multiple callers may read output concurrently; reads are safe.
- Appends must be serialized per job file (simple `fs.appendFile` usage is typically okay; for high throughput consider a stream per job).

---

## Implementation Plan (Step-by-step)

### Phase 0 — Decide file locations
- Choose `sessionDir` root for outputs (e.g. within Lace’s runtime session directory).
- Create `jobs/` folder under it.

### Phase 1 — Core job primitives
1. Implement `JobId` generation
2. Implement in-memory `JobRegistry`
   - create/register jobs
   - list jobs
   - lookup job
   - state transition helpers

### Phase 2 — Output buffering
3. Implement output file creation + append helper
4. Implement incremental read helper using byte offsets

### Phase 3 — Bash async execution
5. Implement Bash foreground path (existing)
6. Add `run_async` to Bash tool
7. Implement Bash background supervisor
   - spawn
   - stream stdout/stderr to output
   - update registry on completion

### Phase 4 — Delegate async execution
8. Implement Delegate foreground path (existing)
9. Add `run_async` to Delegate tool
10. Implement background agent runner
   - run ENT session in background
   - append progress/output
   - update registry on completion

### Phase 5 — Observability + control tools
11. Implement `jobs_list`
12. Implement `job_output` (block + non-block)
13. Implement `job_kill` (bash + agent)

### Phase 6 — Hardening
14. Concurrency checks
15. Output truncation (`maxBytes`) + sensible defaults
16. Ensure background runners don’t prompt interactively (if applicable)

---

## Testing Plan (TDD-oriented)

### Unit tests
- Job ID prefix generation for bash vs agent
- Registry state transitions (disallow invalid)
- Output read helper returns correct chunk + cursor

### Integration tests
- Start async bash job that prints multiple lines with delays; poll `job_output` and assert incremental output
- Start async agent job (using a deterministic local ENT harness); poll output and assert completion
- Kill running bash job; status becomes killed
- Kill running agent job; abort observed and status becomes killed

### End-to-end tests
- Simulate user flow:
  1. `bash run_async`
  2. `jobs_list` shows running
  3. `job_output block=false` shows partial
  4. wait completion `job_output block=true`

---

## Open Questions (explicitly deferred)

- Should async jobs have a max runtime / TTL?
- Should we auto-prune completed jobs after N minutes?
- Should `jobs_list` include a short output preview?
- Should we add a `job_delete` tool?
- Do we need a `/jobs` slash command UI wrapper (separate from tools)?

---

## Acceptance Criteria

- `bash` supports `run_async` and returns immediately with a `jobId`.
- `delegate` supports `run_async` and returns immediately with a `jobId`.
- `jobs_list` returns job summaries including status.
- `job_output` supports:
  - `block=false` polling
  - `block=true` waiting with timeout
  - incremental reads via `cursor`
- `job_kill` can terminate:
  - running bash jobs
  - running agent jobs via abort primitive
- Output is stored as plain text and retrievable incrementally.
- Agent emits `job_started`, `job_update`, `job_finished` protocol notifications.
- Agent responds to `ent/job/list`, `ent/job/output`, `ent/job/kill` protocol methods.

---

## Validation Notes (2025-01-08)

### Alignment with ENT Protocol

✅ **Good alignment:**
- Job lifecycle notifications (`job_started`, `job_update`, `job_finished`) match ENT protocol §7.1
- `ent/job/*` method signatures match protocol §6.6-6.9
- Job ID generation uses ULID as recommended in protocol

⚠️ **Terminology updates made:**
- Changed `killed` → `cancelled` for protocol alignment
- Changed `bash` type → `shell` for protocol alignment
- Added `parentJobId` for nested subagent tracking

### Comparison with Claude Code Implementation

| Feature | Claude Code | This Spec | Notes |
|---------|-------------|-----------|-------|
| Job types | local_bash, local_agent, remote_agent | shell, agent | No remote for v1 |
| ID format | `b`/`a`/`r` + 6 hex chars | `job_{type}_{ulid}` | ULID more robust |
| Output buffering | Per-job file | Per-job file | ✅ Same |
| Progress tracking | Line counts, tool counts | Tool counts, tokens | ✅ Similar |
| Kill escalation | SIGINT→SIGTERM→SIGKILL | SIGINT→SIGTERM→SIGKILL | ✅ Same |
| Subagent spawning | Internal API | ENT protocol over stdio | Different approach |
| Streaming to UI | Via state updates | Via protocol notifications | Different approach |

### Key Differences from Claude Code

1. **Subagent as separate process:** Claude Code runs subagents in-process with shared state.
   We spawn subagent as child process with ENT protocol for better isolation.

2. **Protocol-first design:** Claude Code's Task tool is tightly coupled to internal APIs.
   Our design exposes jobs via ENT protocol methods for supervisor visibility.

3. **No remote agents (v1):** Claude Code supports remote cloud agents.
   We defer this to future versions.

### Recommendations for Implementation

1. **Start with shell jobs** - simpler than agent jobs, validates core infrastructure.

2. **Use existing Bash tool** - extend it with `run_async` rather than creating new tool.

3. **Subagent process binary** - need to support `lace-agent --subagent` mode that:
   - Reads ENT protocol from stdin
   - Writes ENT protocol to stdout
   - Sends permission requests to parent (which relays to supervisor)

4. **Test with mock subagent** - before full implementation, test with a mock
   subagent that echoes prompts to validate the spawning infrastructure.

5. **Streaming preference** - implement `ent/jobStreaming` capability negotiation
   so supervisors can request `coalesced` or `none` for verbose jobs.

### Open Questions Resolved

| Question | Decision |
|----------|----------|
| Job ID format | Use `job_{type}_{ulid}` for uniqueness and sortability |
| Subagent permissions | Subagent uses its own policy; parent relays permission requests to supervisor with `jobId` |
| Protocol vs internal API | Use ENT protocol for subagent communication |
| Streaming to supervisor | Forward via `job_update` wrapper in `session/update` |
| MCP server inheritance | Subagents get only the MCP servers the parent explicitly grants (not automatic inheritance) |
| File checkpointing | Subagents get their own independent file checkpointing |
| Concurrent jobs limit | No hard limit; agent uses best judgment based on task complexity and resources |
| Job resume | Subagents have their own durable sessions; resume via `session/load` on `subagentSessionId` |
| Session durability | Subagents are full agents - use standard event-sourcing, no "sidechain" needed |

### Remaining Open Questions

- Should we support `ent/job/inject` for v1? (likely defer)
- Agent type definitions: which tools/MCP servers each agent type gets by default?
