# Agent Codebase Deduplication Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Eliminate code duplication in the agent package by consolidating
shared logic into appropriate modules, making rpc/ a thin facade.

**Architecture:**

- `rpc/handlers/` becomes a thin delegation layer - param validation only,
  delegates to domain modules
- `providers/` owns all provider-related code including catalog loading and
  provider creation
- `jobs/` owns all job-related code including output reading and job control
- `core/session.ts` owns session configuration logic
- `__tests__/helpers/` owns all shared test infrastructure

**Tech Stack:** TypeScript, Vitest for testing

---

## Phase 0: Test Infrastructure Consolidation

### Task 0.1: Create E2E test context helper

**Problem:** Every E2E test file has ~20 lines of identical beforeEach/afterEach
scaffolding:

- Temp directory creation (laceDir, workDir)
- Environment variable save/restore (LACE_DIR, LACE_AGENT_TEST_PROVIDER)
- Agent shutdown and cleanup

This is copy-pasted across 23+ test files.

**Files:**

- Create: `src/__tests__/helpers/e2e-context.ts`
- Modify: All E2E test files to use the new helper

**Step 1: Write the helper**

````typescript
// src/__tests__/helpers/e2e-context.ts
// ABOUTME: Shared E2E test context - handles temp dirs, env vars, cleanup

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnedAgent } from './agent-process';

export interface E2ETestContext {
  /** Temporary LACE_DIR for this test */
  readonly laceDir: string;
  /** Temporary working directory for this test */
  readonly workDir: string;
  /** The spawned agent (set by test, cleaned up automatically) */
  agent: SpawnedAgent | undefined;
  /** Call in beforeEach */
  setup(): void;
  /** Call in afterEach */
  teardown(): Promise<void>;
}

export interface E2EContextOptions {
  /** Prefix for temp directory names (default: 'lace-e2e') */
  prefix?: string;
  /** Whether to enable test provider (default: true) */
  enableTestProvider?: boolean;
}

/**
 * Create an E2E test context that manages temp dirs and env vars.
 *
 * @example
 * ```typescript
 * const ctx = createE2EContext();
 * beforeEach(() => ctx.setup());
 * afterEach(() => ctx.teardown());
 *
 * it('test', async () => {
 *   ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });
 *   // ...
 * });
 * ```
 */
export function createE2EContext(options?: E2EContextOptions): E2ETestContext {
  const prefix = options?.prefix ?? 'lace-e2e';
  const enableTestProvider = options?.enableTestProvider ?? true;

  let laceDir = '';
  let workDir = '';
  let agent: SpawnedAgent | undefined;
  let savedEnv: {
    LACE_DIR?: string;
    LACE_AGENT_TEST_PROVIDER?: string;
  } = {};

  return {
    get laceDir() {
      return laceDir;
    },
    get workDir() {
      return workDir;
    },
    get agent() {
      return agent;
    },
    set agent(a: SpawnedAgent | undefined) {
      agent = a;
    },

    setup() {
      // Save current env
      savedEnv = {
        LACE_DIR: process.env.LACE_DIR,
        LACE_AGENT_TEST_PROVIDER: process.env.LACE_AGENT_TEST_PROVIDER,
      };

      // Create temp directories
      laceDir = mkdtempSync(join(tmpdir(), `${prefix}-store-`));
      workDir = mkdtempSync(join(tmpdir(), `${prefix}-wd-`));

      // Set env vars
      process.env.LACE_DIR = laceDir;
      if (enableTestProvider) {
        process.env.LACE_AGENT_TEST_PROVIDER = '1';
      }
    },

    async teardown() {
      // Shutdown agent if running
      if (agent) {
        await agent.shutdown();
        agent = undefined;
      }

      // Restore env vars
      if (savedEnv.LACE_DIR === undefined) delete process.env.LACE_DIR;
      else process.env.LACE_DIR = savedEnv.LACE_DIR;

      if (savedEnv.LACE_AGENT_TEST_PROVIDER === undefined) {
        delete process.env.LACE_AGENT_TEST_PROVIDER;
      } else {
        process.env.LACE_AGENT_TEST_PROVIDER =
          savedEnv.LACE_AGENT_TEST_PROVIDER;
      }

      // Cleanup temp directories
      rmSync(laceDir, { recursive: true, force: true });
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}
````

**Step 2: Update helpers/index.ts to export**

```typescript
// src/__tests__/helpers/index.ts
export {
  spawnAgentProcess,
  withTimeout,
  type SpawnedAgent,
} from './agent-process';
export {
  defaultInitializeParams,
  type InitializeOverrides,
} from './initialize';
export {
  createE2EContext,
  type E2ETestContext,
  type E2EContextOptions,
} from './e2e-context';
```

**Step 3: Migrate one test file as proof of concept**

Before (agent-process.e2e.test.ts):

```typescript
let originalLaceDir: string | undefined;
let laceDir: string;
let workDir: string;
let agent: SpawnedAgent | undefined;

beforeEach(() => {
  originalLaceDir = process.env.LACE_DIR;
  laceDir = mkdtempSync(join(tmpdir(), 'lace-agent-e2e-store-'));
  workDir = mkdtempSync(join(tmpdir(), 'lace-agent-e2e-wd-'));
});

afterEach(async () => {
  if (agent) {
    await agent.shutdown();
    agent = undefined;
  }
  if (originalLaceDir === undefined) delete process.env.LACE_DIR;
  else process.env.LACE_DIR = originalLaceDir;
  rmSync(laceDir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});
```

After:

```typescript
import { createE2EContext, spawnAgentProcess, withTimeout } from './helpers';

const ctx = createE2EContext({ prefix: 'lace-agent-e2e' });
beforeEach(() => ctx.setup());
afterEach(() => ctx.teardown());

it('test', async () => {
  ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });
  // Use ctx.workDir, ctx.agent, etc.
});
```

**Step 4: Run tests to verify**

```bash
cd packages/agent && npm test -- --run agent-process.e2e
```

**Step 5: Commit the helper**

```bash
git add -A && git commit -m "test(agent): add createE2EContext helper for test scaffolding"
```

---

### Task 0.2: Migrate remaining E2E tests to use createE2EContext

**Files:** All files in `src/__tests__/*.e2e.test.ts` and similar

This is mechanical: for each test file:

1. Import `createE2EContext` from helpers
2. Replace the 4 variable declarations with `const ctx = createE2EContext()`
3. Replace beforeEach body with `ctx.setup()`
4. Replace afterEach body with `ctx.teardown()`
5. Replace `laceDir` → `ctx.laceDir`, `workDir` → `ctx.workDir`, `agent` →
   `ctx.agent`
6. Run tests for that file

**Batch approach:** Do 3-4 files at a time, run tests, commit.

**Estimated commits:**

- `test(agent): migrate agent-process tests to createE2EContext`
- `test(agent): migrate job/subagent tests to createE2EContext`
- `test(agent): migrate provider/model tests to createE2EContext`
- `test(agent): migrate remaining tests to createE2EContext`

---

### Task 0.3: Migrate supervisor tests to use shared context

**Problem:** Supervisor tests have the same duplication pattern.

**Files:**

- Create: `packages/supervisor/src/__tests__/helpers/e2e-context.ts` (copy from
  agent or extract to shared package)
- Modify: `supervisor-agent-process.e2e.test.ts`
- Modify: `supervisor-http.permission-race.e2e.test.ts`

Same migration pattern as Task 0.2.

---

## Phase 1: Provider Consolidation

### Task 1.1: Move `ensureProviderCatalogLoaded()` to providers/

**Problem:** Identical ~20-line function exists in 3 RPC handlers:
`connections.ts`, `models.ts`, `providers.ts`

**Files:**

- Create: `src/providers/catalog/loader.ts`
- Modify: `src/rpc/handlers/connections.ts`
- Modify: `src/rpc/handlers/models.ts`
- Modify: `src/rpc/handlers/providers.ts`
- Test: `src/providers/catalog/__tests__/loader.test.ts`

**Step 1: Identify the canonical implementation**

Read all three copies and pick the most complete one (they should be identical).

**Step 2: Write the failing test**

```typescript
// src/providers/catalog/__tests__/loader.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureProviderCatalogLoaded } from '../loader';

describe('ensureProviderCatalogLoaded', () => {
  it('loads catalog on first call', async () => {
    const mockState = {
      providerCatalog: {
        isLoaded: () => false,
        loadCatalogs: vi.fn().mockResolvedValue(undefined),
      },
    };

    await ensureProviderCatalogLoaded(mockState as any);

    expect(mockState.providerCatalog.loadCatalogs).toHaveBeenCalledOnce();
  });

  it('skips loading if already loaded', async () => {
    const mockState = {
      providerCatalog: {
        isLoaded: () => true,
        loadCatalogs: vi.fn(),
      },
    };

    await ensureProviderCatalogLoaded(mockState as any);

    expect(mockState.providerCatalog.loadCatalogs).not.toHaveBeenCalled();
  });
});
```

**Step 3: Run test to verify it fails**

```bash
cd packages/agent && npx vitest run src/providers/catalog/__tests__/loader.test.ts
```

Expected: FAIL - module not found

**Step 4: Create the loader module**

```typescript
// src/providers/catalog/loader.ts
// ABOUTME: Catalog loading utilities - ensures provider catalog is loaded before use

import type { AgentServerState } from '@lace/agent/server-types';

/**
 * Ensure the provider catalog is loaded into state.
 * Safe to call multiple times - only loads once.
 */
export async function ensureProviderCatalogLoaded(
  state: AgentServerState
): Promise<void> {
  if (!state.providerCatalog.isLoaded()) {
    await state.providerCatalog.loadCatalogs();
  }
}
```

**Step 5: Run test to verify it passes**

```bash
cd packages/agent && npx vitest run src/providers/catalog/__tests__/loader.test.ts
```

**Step 6: Update catalog/index.ts to export**

Add to `src/providers/catalog/index.ts`:

```typescript
export { ensureProviderCatalogLoaded } from './loader';
```

**Step 7: Update RPC handlers to import from providers**

In each of `connections.ts`, `models.ts`, `providers.ts`:

- Remove local `ensureProviderCatalogLoaded` function
- Add import:
  `import { ensureProviderCatalogLoaded } from '@lace/agent/providers/catalog';`

**Step 8: Run full test suite**

```bash
cd packages/agent && npm test -- --run
```

**Step 9: Commit**

```bash
git add -A && git commit -m "refactor(agent): extract ensureProviderCatalogLoaded to providers/catalog"
```

---

### Task 1.2: Move `createProviderForTurn()` to providers/

**Problem:** Function exists in `conversation/provider-factory.ts` but also
duplicated locally in `session-operations.ts`. Provider creation belongs in
`providers/`.

**Files:**

- Create: `src/providers/turn-factory.ts`
- Modify: `src/conversation/provider-factory.ts` → re-export from providers
- Modify: `src/rpc/handlers/session-operations.ts` → delete local copy
- Test: `src/providers/__tests__/turn-factory.test.ts`

**Step 1: Write the failing test**

```typescript
// src/providers/__tests__/turn-factory.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProviderForTurn } from '../turn-factory';

describe('createProviderForTurn', () => {
  const originalEnv = process.env.LACE_AGENT_TEST_PROVIDER;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = originalEnv;
  });

  it('returns TestAgentProvider when test provider enabled', async () => {
    process.env.LACE_AGENT_TEST_PROVIDER = '1';

    const provider = await createProviderForTurn({});

    expect(provider.constructor.name).toBe('TestAgentProvider');
  });

  it('throws InvalidParams when no connectionId/modelId and not test mode', async () => {
    delete process.env.LACE_AGENT_TEST_PROVIDER;

    await expect(createProviderForTurn({})).rejects.toMatchObject({
      code: -32602,
      message: 'InvalidParams',
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/agent && npx vitest run src/providers/__tests__/turn-factory.test.ts
```

**Step 3: Create turn-factory.ts**

Move the implementation from `conversation/provider-factory.ts`:

```typescript
// src/providers/turn-factory.ts
// ABOUTME: Factory for creating AI providers for conversation turns

import { ProviderRegistry } from '@lace/agent/providers/registry';
import { AIProvider } from '@lace/agent/providers/base-provider';
import { TestAgentProvider } from '@lace/agent/runtime/test-provider';
import {
  throwInvalidParams,
  toNonEmptyString,
  isTestProviderEnabled,
} from '@lace/agent/rpc/utils';

/**
 * Create an AI provider for a turn.
 */
export async function createProviderForTurn(options: {
  connectionId?: string;
  modelId?: string;
}): Promise<AIProvider> {
  if (isTestProviderEnabled()) {
    return new TestAgentProvider();
  }

  const connectionId = toNonEmptyString(options.connectionId);
  const modelId = toNonEmptyString(options.modelId);
  if (!connectionId || !modelId) {
    throwInvalidParams(
      'connectionId and modelId are required before prompting; call ent/session/configure'
    );
  }

  const registry = ProviderRegistry.getInstance();
  return await registry.createProviderFromInstanceAndModel(
    connectionId,
    modelId
  );
}
```

**Step 4: Run test to verify it passes**

```bash
cd packages/agent && npx vitest run src/providers/__tests__/turn-factory.test.ts
```

**Step 5: Update providers/index.ts**

Add export:

```typescript
export { createProviderForTurn } from './turn-factory';
```

**Step 6: Update conversation/provider-factory.ts to re-export**

Replace the function with a re-export:

```typescript
// src/conversation/provider-factory.ts
// ABOUTME: Provider factory for creating AI providers for conversation turns
// Re-exports from providers/ for backward compatibility

export { createProviderForTurn } from '@lace/agent/providers/turn-factory';

// getModelPricing stays here as it uses AgentServerState
import type { AgentServerState } from '@lace/agent/server-types';
import { TestAgentProvider } from '@lace/agent/runtime/test-provider';
import { isTestProviderEnabled } from '@lace/agent/rpc/utils';

export async function getModelPricing(
  state: AgentServerState,
  connectionId?: string,
  modelId?: string
): Promise<{ costPer1mIn: number; costPer1mOut: number } | null> {
  // ... keep existing implementation
}
```

**Step 7: Delete duplicate in session-operations.ts**

Remove the local `createProviderForTurn` function from `session-operations.ts` -
it's no longer used (verify with grep first).

**Step 8: Run full test suite**

```bash
cd packages/agent && npm test -- --run
```

**Step 9: Commit**

```bash
git add -A && git commit -m "refactor(agent): move createProviderForTurn to providers/"
```

---

## Phase 2: Job Module Consolidation

### Task 2.1: Extract job output reading to jobs/job-output.ts

**Problem:** Job output file reading logic duplicated in 3 places:
`rpc/handlers/jobs.ts`, `core/tools/special/job-tools.ts`, `runner.ts`

**Files:**

- Create: `src/jobs/job-output.ts`
- Modify: `src/rpc/handlers/jobs.ts`
- Modify: `src/core/tools/special/job-tools.ts`
- Modify: `src/core/conversation/runner.ts`
- Test: `src/jobs/__tests__/job-output.test.ts`

**Step 1: Identify all output reading patterns**

Search for patterns like `readFileSync(outputPath)`, `existsSync(outputPath)`,
output truncation logic.

**Step 2: Write the failing test**

```typescript
// src/jobs/__tests__/job-output.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readJobOutput, MAX_OUTPUT_SIZE } from '../job-output';

describe('readJobOutput', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'job-output-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads output file contents', () => {
    const outputPath = join(tempDir, 'output.txt');
    writeFileSync(outputPath, 'hello world');

    const result = readJobOutput(outputPath);

    expect(result.output).toBe('hello world');
    expect(result.truncated).toBe(false);
  });

  it('returns empty string if file does not exist', () => {
    const result = readJobOutput(join(tempDir, 'nonexistent.txt'));

    expect(result.output).toBe('');
    expect(result.truncated).toBe(false);
  });

  it('truncates output exceeding max size', () => {
    const outputPath = join(tempDir, 'large.txt');
    const largeContent = 'x'.repeat(MAX_OUTPUT_SIZE + 1000);
    writeFileSync(outputPath, largeContent);

    const result = readJobOutput(outputPath);

    expect(result.output.length).toBeLessThanOrEqual(MAX_OUTPUT_SIZE + 100); // allow for truncation message
    expect(result.truncated).toBe(true);
    expect(result.output).toContain('[truncated]');
  });
});
```

**Step 3: Run test to verify it fails**

```bash
cd packages/agent && npx vitest run src/jobs/__tests__/job-output.test.ts
```

**Step 4: Implement job-output.ts**

```typescript
// src/jobs/job-output.ts
// ABOUTME: Job output file operations - reading, truncating, appending

import { existsSync, readFileSync, appendFileSync, statSync } from 'node:fs';

export const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB default

export interface JobOutputResult {
  output: string;
  truncated: boolean;
}

/**
 * Read job output from file with optional truncation.
 */
export function readJobOutput(
  outputPath: string,
  options?: { maxSize?: number; offset?: number }
): JobOutputResult {
  const maxSize = options?.maxSize ?? MAX_OUTPUT_SIZE;
  const offset = options?.offset ?? 0;

  if (!existsSync(outputPath)) {
    return { output: '', truncated: false };
  }

  const content = readFileSync(outputPath, 'utf-8');

  if (offset > 0) {
    const sliced = content.slice(offset);
    if (sliced.length > maxSize) {
      return {
        output: sliced.slice(0, maxSize) + '\n[truncated]',
        truncated: true,
      };
    }
    return { output: sliced, truncated: false };
  }

  if (content.length > maxSize) {
    return {
      output: content.slice(0, maxSize) + '\n[truncated]',
      truncated: true,
    };
  }

  return { output: content, truncated: false };
}

/**
 * Append content to job output file with size limit enforcement.
 */
export function appendJobOutput(
  outputPath: string,
  content: string,
  options?: { maxSize?: number }
): { appended: boolean; reason?: string } {
  const maxSize = options?.maxSize ?? MAX_OUTPUT_SIZE;

  if (!existsSync(outputPath)) {
    appendFileSync(outputPath, content);
    return { appended: true };
  }

  const currentSize = statSync(outputPath).size;
  if (currentSize >= maxSize) {
    return { appended: false, reason: 'max_size_reached' };
  }

  const allowedBytes = maxSize - currentSize;
  const toAppend =
    content.length > allowedBytes ? content.slice(0, allowedBytes) : content;
  appendFileSync(outputPath, toAppend);
  return { appended: true };
}

/**
 * Get current output file size.
 */
export function getJobOutputSize(outputPath: string): number {
  if (!existsSync(outputPath)) return 0;
  return statSync(outputPath).size;
}
```

**Step 5: Run test to verify it passes**

```bash
cd packages/agent && npx vitest run src/jobs/__tests__/job-output.test.ts
```

**Step 6: Update jobs/index.ts**

Add exports:

```typescript
export {
  readJobOutput,
  appendJobOutput,
  getJobOutputSize,
  MAX_OUTPUT_SIZE,
} from './job-output';
```

**Step 7: Update rpc/handlers/jobs.ts**

Replace inline reading with import:

```typescript
import { readJobOutput } from '@lace/agent/jobs';
// Replace manual readFileSync/existsSync with readJobOutput()
```

**Step 8: Update job-tools.ts and runner.ts similarly**

**Step 9: Run full test suite**

```bash
cd packages/agent && npm test -- --run
```

**Step 10: Commit**

```bash
git add -A && git commit -m "refactor(agent): extract job output operations to jobs/job-output"
```

---

### Task 2.2: Extract job kill logic to jobs/job-control.ts

**Problem:** Job kill block (~35 lines) duplicated in `session.ts` lines 62-90
and 205-234. Also incomplete version in `job-tools.ts`.

**Files:**

- Create: `src/jobs/job-control.ts`
- Modify: `src/rpc/handlers/session.ts`
- Modify: `src/rpc/handlers/jobs.ts`
- Modify: `src/core/tools/special/job-tools.ts`
- Test: `src/jobs/__tests__/job-control.test.ts`

**Step 1: Write the failing test**

```typescript
// src/jobs/__tests__/job-control.test.ts
import { describe, it, expect, vi } from 'vitest';
import { killJob, killAllRunningJobs } from '../job-control';
import type { JobState } from '@lace/agent/server-types';

describe('killJob', () => {
  it('sends SIGTERM to process group on unix', async () => {
    const mockProc = {
      pid: 12345,
      exitCode: null,
      kill: vi.fn(),
    };
    const job: Partial<JobState> = {
      jobId: 'job_123',
      status: 'running',
      proc: mockProc as any,
      completion: Promise.resolve(),
      permissionAbortController: new AbortController(),
    };

    const processKill = vi
      .spyOn(process, 'kill')
      .mockImplementation(() => true);

    await killJob(job as JobState, { waitMs: 100 });

    expect(job.status).toBe('cancelled');
    expect(processKill).toHaveBeenCalledWith(-12345, 'SIGTERM');

    processKill.mockRestore();
  });

  it('aborts permission controller', async () => {
    const abortController = new AbortController();
    const job: Partial<JobState> = {
      jobId: 'job_123',
      status: 'running',
      proc: undefined,
      completion: Promise.resolve(),
      permissionAbortController: abortController,
    };

    await killJob(job as JobState);

    expect(abortController.signal.aborted).toBe(true);
  });
});

describe('killAllRunningJobs', () => {
  it('kills all running jobs in map', async () => {
    const jobs = new Map<string, JobState>();
    jobs.set('job_1', {
      jobId: 'job_1',
      status: 'running',
      completion: Promise.resolve(),
    } as JobState);
    jobs.set('job_2', {
      jobId: 'job_2',
      status: 'completed',
      completion: Promise.resolve(),
    } as JobState);

    await killAllRunningJobs(jobs, { waitMs: 50 });

    expect(jobs.get('job_1')!.status).toBe('cancelled');
    expect(jobs.get('job_2')!.status).toBe('completed'); // unchanged
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/agent && npx vitest run src/jobs/__tests__/job-control.test.ts
```

**Step 3: Implement job-control.ts**

```typescript
// src/jobs/job-control.ts
// ABOUTME: Job lifecycle control - killing, cancelling, waiting for jobs

import type { JobState } from '@lace/agent/server-types';
import { logger } from '@lace/agent/utils/logger';

export interface KillJobOptions {
  /** Max time to wait for graceful shutdown before force kill (ms) */
  waitMs?: number;
  /** Whether to send SIGKILL after waitMs if still running */
  forceKill?: boolean;
}

/**
 * Kill a single job, handling process termination and cleanup.
 */
export async function killJob(
  job: JobState,
  options?: KillJobOptions
): Promise<void> {
  const { waitMs = 500, forceKill = false } = options ?? {};

  if (job.status !== 'running') return;

  job.status = 'cancelled';

  // Abort any pending permission requests
  job.permissionAbortController?.abort();

  // Kill the process if it exists
  if (job.proc) {
    try {
      // On Unix, kill the process group (negative PID)
      if (process.platform !== 'win32' && typeof job.proc.pid === 'number') {
        process.kill(-job.proc.pid, 'SIGTERM');
      } else {
        job.proc.kill('SIGTERM');
      }
    } catch (error) {
      logger.debug('job.kill.sigterm.failed', {
        jobId: job.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Wait for graceful shutdown
    if (job.proc.exitCode === null) {
      await Promise.race([
        job.completion,
        new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
      ]);
    }

    // Force kill if still running
    if (forceKill && job.proc.exitCode === null) {
      try {
        if (process.platform !== 'win32' && typeof job.proc.pid === 'number') {
          process.kill(-job.proc.pid, 'SIGKILL');
        } else {
          job.proc.kill('SIGKILL');
        }
      } catch (error) {
        logger.debug('job.kill.sigkill.failed', {
          jobId: job.jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/**
 * Kill all running jobs in a job map.
 */
export async function killAllRunningJobs(
  jobs: Map<string, JobState>,
  options?: KillJobOptions
): Promise<void> {
  const runningJobs = [...jobs.values()].filter(
    (job) => job.status === 'running'
  );

  // Send SIGTERM to all
  for (const job of runningJobs) {
    await killJob(job, { ...options, forceKill: false });
  }

  // Wait for all completions
  await Promise.all(
    runningJobs
      .filter((job) => job.proc && job.proc.exitCode === null)
      .map((job) =>
        Promise.race([
          job.completion,
          new Promise<void>((resolve) =>
            setTimeout(resolve, options?.waitMs ?? 500)
          ),
        ])
      )
  );
}
```

**Step 4: Run test to verify it passes**

**Step 5: Update jobs/index.ts with exports**

**Step 6: Update session.ts to use killAllRunningJobs**

Replace both duplicated blocks with:

```typescript
import { killAllRunningJobs } from '@lace/agent/jobs';
// ...
await killAllRunningJobs(state.jobs);
state.pendingPermissionRequests.clear();
state.jobs.clear();
```

**Step 7: Update job-tools.ts to use killJob**

**Step 8: Run full test suite**

**Step 9: Commit**

```bash
git add -A && git commit -m "refactor(agent): extract job control logic to jobs/job-control"
```

---

## Phase 3: Session Configuration Consolidation

### Task 3.1: Extract getEffectiveConfig to core/session.ts

**Problem:** Effective config merge logic duplicated in `prompt.ts:89`,
`session-operations.ts:83`, `agent-status.ts:28`

**Files:**

- Modify: `src/core/session.ts`
- Modify: `src/rpc/handlers/prompt.ts`
- Modify: `src/rpc/handlers/session-operations.ts`
- Modify: `src/rpc/handlers/agent-status.ts`
- Test: `src/core/__tests__/session.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to existing session tests or create new file
import { getEffectiveConfig } from '../session';

describe('getEffectiveConfig', () => {
  it('merges server config with session config', () => {
    const serverConfig = {
      executionMode: 'execute' as const,
      approvalMode: 'auto' as const,
      connectionId: 'server-conn',
      modelId: 'server-model',
    };
    const sessionConfig = {
      approvalMode: 'ask' as const, // override
      maxBudgetUsd: 10,
    };

    const result = getEffectiveConfig(serverConfig, sessionConfig);

    expect(result).toEqual({
      executionMode: 'execute',
      approvalMode: 'ask', // session wins
      connectionId: 'server-conn',
      modelId: 'server-model',
      maxBudgetUsd: 10,
    });
  });

  it('uses server config when session config is undefined', () => {
    const serverConfig = {
      executionMode: 'plan' as const,
      approvalMode: 'auto' as const,
    };

    const result = getEffectiveConfig(serverConfig, undefined);

    expect(result).toEqual(serverConfig);
  });
});
```

**Step 2: Implement in core/session.ts**

```typescript
// Add to src/core/session.ts

export interface ServerConfig {
  executionMode?: 'plan' | 'execute';
  approvalMode?: 'auto' | 'ask';
  connectionId?: string;
  modelId?: string;
  maxBudgetUsd?: number;
  maxThinkingTokens?: number;
  environment?: Record<string, string>;
}

/**
 * Merge server-level config with session-level overrides.
 * Session config takes precedence where defined.
 */
export function getEffectiveConfig(
  serverConfig: ServerConfig,
  sessionConfig?: Partial<ServerConfig>
): ServerConfig {
  if (!sessionConfig) return serverConfig;
  return { ...serverConfig, ...sessionConfig };
}
```

**Step 3-9: Test, update callers, run suite, commit**

```bash
git add -A && git commit -m "refactor(agent): extract getEffectiveConfig to core/session"
```

---

## Phase 4: RPC Handler Cleanup

### Task 4.1: Consolidate model validation in models.ts

**Problem:** Model array validation duplicated at lines 187-194 and 204-211 in
`models.ts`

**Files:**

- Modify: `src/rpc/handlers/models.ts`

**Step 1: Extract helper function**

```typescript
function parseModelIds(modelIds: unknown): string[] {
  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    throwInvalidParams('modelIds must be a non-empty array of strings');
  }
  return modelIds.map((id) => {
    const v = toNonEmptyString(id);
    if (!v) throwInvalidParams('modelIds must be strings');
    return v;
  });
}
```

**Step 2: Replace both usages with the helper**

**Step 3: Run tests, commit**

---

### Task 4.2: Simplify server.ts job wrappers

**Problem:** `_startShellJob` and `_startSubagentJob` in `server.ts` (lines
219-255) are nearly identical wrapper functions

**Files:**

- Modify: `src/server.ts`

**Step 1: Extract common error handling**

```typescript
async function wrapJobCreation<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof JobCreationError) {
      throw {
        code: err.code,
        message: err.message,
        data: { category: err.category },
      };
    }
    throw err;
  }
}

const _startShellJob = (options: CreateShellJobOptions) =>
  wrapJobCreation(() => createShellJob(options, deps));

const _startSubagentJob = (options: CreateSubagentJobOptions) =>
  wrapJobCreation(() => createSubagentJob(options, deps));
```

**Step 2: Run tests, commit**

---

## Phase 5: Directory Structure Cleanup

### Task 5.1: Add barrel export to conversation/

**Problem:** `src/conversation/` has no `index.ts`, inconsistent with other
modules

**Files:**

- Create: `src/conversation/index.ts`

```typescript
// src/conversation/index.ts
// ABOUTME: Conversation utilities barrel export

export { createProviderForTurn, getModelPricing } from './provider-factory';
export { handleSlashCommand, type SlashCommandResult } from './slash-commands';
```

---

### Task 5.2: Consider merging conversation/ into core/conversation/

**Decision point:** After completing the above tasks, evaluate whether
`src/conversation/` (now just `slash-commands.ts` and a re-export) should be
merged into `src/core/conversation/`.

Factors:

- If `slash-commands.ts` has no RPC dependencies, merge
- If it has RPC dependencies, keep separate

---

## Verification Checklist

After completing all tasks:

- [ ] All 221+ agent tests pass
- [ ] All supervisor tests pass
- [ ] No duplicate function definitions (run `jscpd` again, expect <5%
      duplication)
- [ ] Test files use `createE2EContext` helper (no manual temp dir management)
- [ ] `rpc/handlers/` files are thin (mostly delegation)
- [ ] Provider-related code is in `providers/`
- [ ] Job-related code is in `jobs/`
- [ ] Session config logic is in `core/session.ts`

---

## Estimated Commits

**Phase 0 - Test Infrastructure:**

1. `test(agent): add createE2EContext helper for test scaffolding`
2. `test(agent): migrate agent-process tests to createE2EContext`
3. `test(agent): migrate job/subagent tests to createE2EContext`
4. `test(agent): migrate remaining tests to createE2EContext`
5. `test(supervisor): migrate supervisor tests to shared context`

**Phase 1 - Provider Consolidation:** 6.
`refactor(agent): extract ensureProviderCatalogLoaded to providers/catalog` 7.
`refactor(agent): move createProviderForTurn to providers/`

**Phase 2 - Job Consolidation:** 8.
`refactor(agent): extract job output operations to jobs/job-output` 9.
`refactor(agent): extract job control logic to jobs/job-control`

**Phase 3 - Session Config:** 10.
`refactor(agent): extract getEffectiveConfig to core/session`

**Phase 4 - RPC Cleanup:** 11.
`refactor(agent): consolidate model validation in RPC handlers` 12.
`refactor(agent): simplify server.ts job wrappers`

**Phase 5 - Directory Structure:** 13.
`refactor(agent): add conversation/ barrel export`
