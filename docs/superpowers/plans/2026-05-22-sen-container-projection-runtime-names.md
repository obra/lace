# Sen Container Projection Runtime Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sen container-backed personas run as host-orchestrated Lace agents with projected container tools, remove `box` as a persona runtime concept, and make the config explain where the agent process and tools run.

**Architecture:** Treat execution placement and container lifecycle as separate axes. `runtime.type` describes the tool environment kind (`root` or `container`), `runtime.agentPlacement` describes where the Lace agent process runs (`host` or `container`), and `runtime.containerLifecycle` describes container ownership (`session` or `persistent`). Sen templates use `runtime.type: container`, `agentPlacement: host`, and the appropriate lifecycle; explicit `agentPlacement: container` remains the in-container Lace process path during this implementation branch.

**Tech Stack:** TypeScript, Zod, Vitest, gray-matter persona frontmatter, existing Lace `ContainerManager`, existing projected container `ToolRuntime`, existing MCP stdio placement, Sen persona templates in `../sen-core-v2`.

---

## Context

This plan replaces `/tmp/projection-swap-plan.md` and is the handoff document for implementation. Do not implement from the temp file.

The spec is `docs/specs/2026-05-18-tool-runtime-projection-spec.md`. The spec defines the target architecture; this file is the implementation plan. If implementation discovers that the spec is wrong, update the spec in a separate reviewed change before continuing.

No wire compatibility is required. Do not keep compatibility parsers, aliases, fallback names, or dual runtime discriminators for old persona runtime values.

## Naming Decision

The real architectural split is not session containers versus persistent containers. The primary split is:

- `agentPlacement: host`: the Lace agent process runs on the host and its tools are projected into the runtime.
- `agentPlacement: container`: the whole child Lace agent process runs inside the container.

Container persistence is a secondary lifecycle property:

- `containerLifecycle: session`: one Lace-managed container per parent session and persona.
- `containerLifecycle: persistent`: a long-lived single-tenant container with stable daemon id `sen-box`.

Persona runtime config after this plan:

```yaml
runtime:
  type: container
  agentPlacement: host
  containerLifecycle: session
  image: node:24-bookworm
  workingDirectory: /work
  mounts:
    scratch: /work
```

```yaml
runtime:
  type: container
  agentPlacement: host
  containerLifecycle: persistent
  image: sen-box:dev
  workingDirectory: /home/agent
  mounts:
    home: /home/agent
```

Keep `RuntimeExecutionBinding.toolRuntime.type: 'container'`. That is the low-level tool-runtime capability and remains accurate.

Reject `runtime.type: box`. Do not introduce `sessionContainer` or `persistentContainer` as runtime discriminators.

## File Structure

- Modify `packages/agent/src/config/persona-registry.ts`: collapse persona container schema into one `type: container` arm, add `agentPlacement`, add `containerLifecycle`, and reject `box`.
- Modify `packages/agent/src/config/__tests__/persona-registry.test.ts`: update schema coverage for host projection, explicit in-container placement, lifecycle variants, and old `box` rejection.
- Create `packages/agent/src/tools/runtime/container-helper.ts`: the actual in-container helper program used by projected container runtimes for container-local filesystem and fetch operations.
- Modify `packages/agent/src/tools/runtime/projected-container.ts`: enforce a per-helper-request timeout and preserve helper materialization behavior.
- Create `packages/agent/src/tools/runtime/__tests__/container-helper.test.ts`: direct tests for helper protocol operations.
- Modify `packages/agent/src/tools/runtime/__tests__/projected-container-helper.test.ts`: timeout coverage for helper-backed operations.
- Modify `packages/agent/src/jobs/persona-container-spec.ts`: replace separate container/box runtime types with one `PersonaContainerRuntime`, and branch on `containerLifecycle`.
- Create `packages/agent/src/jobs/persona-projected-binding.ts`: build a host-agent `RuntimeExecutionBinding` from a parsed persona container runtime.
- Create `packages/agent/src/jobs/__tests__/persona-projected-binding.test.ts`: cover session lifecycle, persistent lifecycle, browser ports, mount validation, image identity, and runtime id.
- Modify `packages/agent/src/jobs/__tests__/persona-projected-binding.test.ts`: assert every projected binding includes a helper descriptor pointing at the built helper artifact.
- Modify `packages/agent/src/jobs/__tests__/persona-container-spec.test.ts`: update lifecycle fixtures and preserve current `ContainerSpec` behavior.
- Modify `packages/agent/src/tools/implementations/delegate.ts`: route `agentPlacement: host` container personas through projected runtime bindings; route explicit `agentPlacement: container` through the in-container spawn path.
- Modify `packages/agent/src/tools/implementations/__tests__/delegate.test.ts`: assert projected binding behavior for shell, persistent shell, and browser-like personas.
- Modify `packages/agent/src/jobs/subagent-spawn.ts`, `packages/agent/src/jobs/subagent-job.ts`, `packages/agent/src/jobs/job-manager.ts`, `packages/agent/src/jobs/job-creation.ts`, and `packages/agent/src/server-types.ts`: remove `personaBoxRuntime` and carry a single `personaContainerRuntime` for explicit in-container personas.
- Modify affected tests under `packages/agent/src/jobs/__tests__/`.
- Modify `../sen-core-v2/templates/agent-personas/shell.md`: set `runtime.agentPlacement: host` and `runtime.containerLifecycle: session`.
- Modify `../sen-core-v2/templates/agent-personas/browser-driver.md`: set `runtime.agentPlacement: host`, `runtime.containerLifecycle: session`, and `mcpServers.superpowers-chrome.placement: toolRuntime`.
- Modify `../sen-core-v2/templates/agent-personas/box-shell.md`: change `runtime.type: box` to `runtime.type: container`, set `runtime.agentPlacement: host`, and set `runtime.containerLifecycle: persistent`.
- Modify Sen template/rewrite tests to mirror the new schema.
- Search and update docs/comments in `packages/agent`, `packages/web`, `docs`, and `../sen-core-v2` where they refer to persona `runtime.type: box`. Do not rename ordinary UI/CSS uses of the word `box` or the persona filename `box-shell.md`.
- Update or close PRI-1781 once this lands: projected mode makes the earlier lace-data permission mismatch obsolete for shell, box-shell, and browser-driver because subagent session writes stay host-side.

---

## Known Tradeoffs And Operational Notes

Helper-backed projected operations are slower than lace-in-container direct `fs/promises` operations because each helper request starts a container process. That is acceptable for this migration, but implementers must not hide it. If runtime smoke tests show material latency for ordinary Sen use, file a follow-up for batching or a long-lived helper transport.

Persistent container secret env is resolved at materialization time. If `OP_SERVICE_ACCOUNT_TOKEN` or another projected container env value rotates while `sen-box` is already running, the running container keeps old env until destroy/recreate. Document this in the Sen runbook as the operator behavior for now; do not add secret hot-reload in this branch.

**Image references are persona-declared, not pre-resolved.** Persona `runtime.image` values (tags, RepoDigests, anything docker accepts) flow through to `docker create` verbatim. The projected runtime captures the daemon's `.Image` field post-create and logs it for audit. Pre-resolution to a digest was the original design but it broke locally-built images (`sen-box:dev`, `sen-browser:dev` have no RepoDigest) and the fallback to content `.Id` was a hack. Tag drift across delegates is accepted — dev images are expected to change underneath us, and the post-create captured ID is the truth for what actually ran. If two delegates spawned seconds apart end up on different image layers, the audit log records both; that is the correct behavior, not a bug.

---

## Chunk 0: Runtime Helper Prerequisite

### Task 0: Add The Projected Runtime Helper Binary

**Files:**

- Create: `packages/agent/src/tools/runtime/container-helper.ts`
- Create: `packages/agent/src/tools/runtime/__tests__/container-helper.test.ts`
- Modify: `packages/agent/src/tools/runtime/projected-container.ts`
- Modify: `packages/agent/src/tools/runtime/__tests__/projected-container-helper.test.ts`

- [ ] **Step 1: Write failing direct helper tests**

Create `packages/agent/src/tools/runtime/__tests__/container-helper.test.ts`:

```typescript
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

async function callHelper(request: unknown): Promise<unknown> {
  const helperPath = new URL('../container-helper.ts', import.meta.url).pathname;
  const { stdout, stderr } = await execFileAsync(process.execPath, ['--import', 'tsx', helperPath], {
    input: `${JSON.stringify(request)}\n`,
    maxBuffer: 1024 * 1024,
  });
  expect(stderr).toBe('');
  return JSON.parse(stdout.trim());
}

describe('container runtime helper', () => {
  it('reads and writes text files using the helper protocol', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-helper-test-'));
    const file = join(dir, 'note.txt');

    await expect(
      callHelper({ op: 'writeTextFile', path: file, content: 'hello' })
    ).resolves.toEqual({ ok: true, value: null });
    await expect(readFile(file, 'utf8')).resolves.toBe('hello');
    await expect(callHelper({ op: 'readTextFile', path: file })).resolves.toEqual({
      ok: true,
      value: 'hello',
    });
  });

  it('stats and lists directory entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-helper-test-'));
    await writeFile(join(dir, 'a.txt'), 'a', 'utf8');

    const statResponse = await callHelper({ op: 'stat', path: join(dir, 'a.txt') });
    expect(statResponse).toMatchObject({ ok: true, value: { type: 'file', size: 1 } });

    const readdirResponse = await callHelper({ op: 'readdir', path: dir });
    expect(readdirResponse).toMatchObject({
      ok: true,
      value: [{ name: 'a.txt', type: 'file' }],
    });
  });

  it('returns structured errors instead of crashing protocol output', async () => {
    await expect(callHelper({ op: 'readTextFile', path: '/definitely/missing' })).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: expect.any(String), message: expect.any(String) }),
    });
  });
});
```

- [ ] **Step 2: Run helper tests and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/container-helper.test.ts
```

Expected: FAIL because `container-helper.ts` does not exist.

- [ ] **Step 3: Implement the helper program**

Create `packages/agent/src/tools/runtime/container-helper.ts`:

```typescript
#!/usr/bin/env node

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import type { HelperRequest, HelperResponse } from './helper-protocol';

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('error', reject);
    process.stdin.on('end', () => resolve(data));
  });
}

function fileTypeFromStats(stats: { isDirectory(): boolean }): 'file' | 'directory' {
  return stats.isDirectory() ? 'directory' : 'file';
}

function errorResponse(error: unknown): HelperResponse {
  const err = error as NodeJS.ErrnoException;
  return {
    ok: false,
    error: {
      code: err.code ?? 'ERROR',
      message: err.message ?? String(error),
    },
  };
}

async function handle(request: HelperRequest): Promise<unknown> {
  switch (request.op) {
    case 'stat': {
      const stats = await stat(request.path);
      return {
        type: fileTypeFromStats(stats),
        size: stats.size,
        mtime: stats.mtime.toISOString(),
      };
    }
    case 'readTextFile':
      return await readFile(request.path, 'utf8');
    case 'writeTextFile':
      await writeFile(request.path, request.content, 'utf8');
      return null;
    case 'mkdir':
      await mkdir(request.path, { recursive: request.recursive });
      return null;
    case 'readdir': {
      const entries = await readdir(request.path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      }));
    }
    case 'fetch': {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: request.redirect ?? 'follow',
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (request.maxBytes !== undefined && bytes.byteLength > request.maxBytes) {
        throw Object.assign(
          new Error(`Response size (${bytes.byteLength} bytes) exceeds maximum allowed size (${request.maxBytes} bytes)`),
          { code: 'ERR_RESPONSE_TOO_LARGE' }
        );
      }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: bytes.toString('base64'),
      };
    }
    default:
      throw Object.assign(new Error(`Unsupported helper op: ${(request as { op?: string }).op}`), {
        code: 'ERR_UNSUPPORTED_OP',
      });
  }
}

async function main(): Promise<void> {
  try {
    const raw = await readStdin();
    const request = JSON.parse(raw.trim().split(/\r?\n/, 1)[0] ?? '') as HelperRequest;
    const value = await handle(request);
    const response: HelperResponse = { ok: true, value };
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(errorResponse(error))}\n`);
  }
}

void main();
```

- [ ] **Step 4: Run helper tests and verify pass**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/container-helper.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add per-helper-request timeout coverage**

In `packages/agent/src/tools/runtime/__tests__/projected-container-helper.test.ts`, add:

```typescript
it('times out helper-backed operations that do not produce a response', async () => {
  vi.useFakeTimers();
  try {
    const manager = {
      materialize: vi.fn().mockResolvedValue({
        spec: containerDescriptorWithHelper().spec,
        containerId: 'container_123',
        state: 'running' as const,
      }),
      execStream: vi.fn().mockResolvedValue({
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        wait: vi.fn().mockReturnValue(new Promise(() => undefined)),
        kill: vi.fn(),
      }),
    };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: containerDescriptorWithHelper(),
    });

    const path = await runtime.paths.resolve('/tmp/hangs.txt');
    const read = runtime.fs.readTextFile(path);
    await vi.advanceTimersByTimeAsync(30_001);

    await expect(read).rejects.toThrow(/timed out/i);
    expect((await manager.execStream.mock.results[0].value).kill).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
```

- [ ] **Step 6: Run timeout test and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/projected-container-helper.test.ts
```

Expected: FAIL because helper requests currently wait forever.

- [ ] **Step 7: Implement helper request timeout**

In `packages/agent/src/tools/runtime/projected-container.ts`, add a constant near the helper class:

```typescript
const DEFAULT_HELPER_REQUEST_TIMEOUT_MS = 30_000;
```

In `ProjectedContainerRuntimeHelper.request()`, create an `AbortController` timeout and pass the timeout signal to `processRunner.start()` unless the caller already supplied a signal:

```typescript
const timeoutController = new AbortController();
const timeout = setTimeout(() => timeoutController.abort(new Error('Projected runtime helper request timed out')), DEFAULT_HELPER_REQUEST_TIMEOUT_MS);
timeout.unref?.();
const effectiveSignal = signal ?? timeoutController.signal;
```

Use `effectiveSignal` in the `processRunner.start()` call. Wrap the existing `Promise.all()` wait in `try/finally`, and in `finally` clear the timeout and kill the helper process when `timeoutController.signal.aborted` is true:

```typescript
} finally {
  clearTimeout(timeout);
  if (timeoutController.signal.aborted) {
    handle.kill('SIGKILL');
  }
}
```

If the timeout fired, throw `timeoutController.signal.reason` after cleanup.

- [ ] **Step 8: Run helper and projected-helper tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/container-helper.test.ts src/tools/runtime/__tests__/projected-container-helper.test.ts
```

Expected: PASS.

- [ ] **Step 9: Verify the helper is built**

Run:

```bash
npm run build --workspace=packages/agent
test -f packages/agent/dist/tools/runtime/container-helper.js
```

Expected: both commands exit 0.

- [ ] **Step 10: Commit**

```bash
git status --short
git add packages/agent/src/tools/runtime/container-helper.ts packages/agent/src/tools/runtime/projected-container.ts packages/agent/src/tools/runtime/__tests__/container-helper.test.ts packages/agent/src/tools/runtime/__tests__/projected-container-helper.test.ts
git commit -m "feat: add projected container runtime helper"
```

## Chunk 1: Persona Runtime Schema

### Task 1: Make Agent Placement And Container Lifecycle Explicit

**Files:**

- Modify: `packages/agent/src/config/persona-registry.ts`
- Modify: `packages/agent/src/config/__tests__/persona-registry.test.ts`

- [ ] **Step 1: Write failing tests for container runtime placement and lifecycle**

Update the existing `runtime.type=container` tests in `packages/agent/src/config/__tests__/persona-registry.test.ts` to expect `agentPlacement: 'host'` and `containerLifecycle: 'session'`:

```typescript
expect(result.config.runtime).toEqual({
  type: 'container',
  agentPlacement: 'host',
  containerLifecycle: 'session',
  image: 'ghcr.io/example/lace-shell:latest',
  workingDirectory: '/workspace',
  mounts: { scratch: '/workspace/scratch', knowledge: '/workspace/knowledge' },
  env: { FOO: 'bar' },
  ports: [{ host: 8080, container: 80 }],
});
```

Add a persistent lifecycle test:

```typescript
it('parses runtime.type=container with persistent lifecycle', () => {
  const content = `---
runtime:
  type: container
  agentPlacement: host
  containerLifecycle: persistent
  image: ghcr.io/example/sen-box:latest
  workingDirectory: /home/agent
  mounts:
    home: /home/agent
  env:
    HOME: /home/agent
---
Body.`;
  writeFileSync(path.join(tempBundledDir, 'persistent-runtime.md'), content);
  registry = makeRegistry([userPersonaDir]);

  expect(registry.parsePersona('persistent-runtime').config.runtime).toEqual({
    type: 'container',
    agentPlacement: 'host',
    containerLifecycle: 'persistent',
    image: 'ghcr.io/example/sen-box:latest',
    workingDirectory: '/home/agent',
    mounts: { home: '/home/agent' },
    env: { HOME: '/home/agent' },
  });
});
```

Add explicit in-container agent placement coverage:

```typescript
it('parses runtime.agentPlacement=container for explicit lace-in-container execution', () => {
  const content = `---
runtime:
  type: container
  agentPlacement: container
  containerLifecycle: session
  image: img:latest
  workingDirectory: /w
  mounts: {}
---
Body.`;
  writeFileSync(path.join(tempBundledDir, 'container-placement.md'), content);
  registry = makeRegistry([userPersonaDir]);

  expect(registry.parsePersona('container-placement').config.runtime).toMatchObject({
    type: 'container',
    agentPlacement: 'container',
    containerLifecycle: 'session',
  });
});
```

- [ ] **Step 2: Write failing old-box rejection test**

Replace old `runtime.type=box` parsing tests with rejection:

```typescript
it('rejects old persona runtime.type=box', () => {
  const content = `---
runtime:
  type: box
  image: img:latest
  workingDirectory: /home/agent
  mounts: {}
---
Body.`;
  writeFileSync(path.join(tempBundledDir, 'old-box.md'), content);
  registry = makeRegistry([userPersonaDir]);

  expect(() => registry.parsePersona('old-box')).toThrow(/runtime/i);
});
```

- [ ] **Step 3: Run schema tests and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/config/__tests__/persona-registry.test.ts
```

Expected: FAIL because `containerLifecycle` is not accepted and `box` is still accepted.

- [ ] **Step 4: Update persona runtime schema**

In `packages/agent/src/config/persona-registry.ts`, replace the existing container and box schema arms with:

```typescript
const agentPlacementSchema = z.enum(['host', 'container']).optional().default('host');
const containerLifecycleSchema = z.enum(['session', 'persistent']);

const runtimeContainerSchema = z
  .object({
    type: z.literal('container'),
    agentPlacement: agentPlacementSchema,
    containerLifecycle: containerLifecycleSchema,
    image: z.string().min(1),
    workingDirectory: z.string().min(1),
    mounts: z.record(mountNameSchema, z.string().min(1)),
    env: z.record(z.string(), z.string()).optional().default({}),
    ports: z.array(portMappingSchema).optional(),
  })
  .strict();

const runtimeSchema = z.discriminatedUnion('type', [runtimeRootSchema, runtimeContainerSchema]);
```

Delete `runtimeBoxSchema`. Do not keep an alias or migration parser for `box`.

- [ ] **Step 5: Add lifecycle validation**

In the same schema area, add a `superRefine` rule to reject ports on persistent containers:

```typescript
const runtimeContainerSchema = z
  .object({
    // fields from Step 4
  })
  .strict()
  .superRefine((runtime, ctx) => {
    if (runtime.containerLifecycle === 'persistent' && runtime.ports?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ports'],
        message: 'persistent container runtimes do not support host ports',
      });
    }
  });
```

- [ ] **Step 6: Run schema tests and verify pass**

Run:

```bash
npm run test --workspace=packages/agent -- src/config/__tests__/persona-registry.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git status --short
git add packages/agent/src/config/persona-registry.ts packages/agent/src/config/__tests__/persona-registry.test.ts
git commit -m "refactor: make persona container runtime placement explicit"
```

---

## Chunk 2: Container Specs And Projected Bindings

### Task 2: Collapse Session And Persistent Container Spec Builders

**Files:**

- Modify: `packages/agent/src/jobs/persona-container-spec.ts`
- Modify: `packages/agent/src/jobs/__tests__/persona-container-spec.test.ts`
- Modify: `packages/agent/src/jobs/subagent-spawn.ts`
- Modify: `packages/agent/src/jobs/__tests__/subagent-container-spawn.test.ts`

- [ ] **Step 1: Update container spec tests for lifecycle branching**

In `packages/agent/src/jobs/__tests__/persona-container-spec.test.ts`, use one runtime type:

```typescript
const baseSessionRuntime = {
  type: 'container' as const,
  agentPlacement: 'host' as const,
  containerLifecycle: 'session' as const,
  image: 'devcontainer:latest',
  workingDirectory: '/workspace',
  mounts: {},
};

const basePersistentRuntime = {
  type: 'container' as const,
  agentPlacement: 'host' as const,
  containerLifecycle: 'persistent' as const,
  image: 'sen-box:dev',
  workingDirectory: '/home/agent',
  mounts: {},
};
```

Replace `buildPersonaBoxSpec` expectations with `buildPersonaContainerSpec` using `containerLifecycle: 'persistent'`.

Keep expected behavior:

- Session lifecycle: `spec.name === '${parentSessionId}-${personaName}'`, no fixed `containerId`, ports allowed.
- Persistent lifecycle: `spec.name === 'box'`, `spec.containerId === 'sen-box'`, `spec.restartPolicy === 'unless-stopped'`, no ports.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/jobs/__tests__/persona-container-spec.test.ts src/jobs/__tests__/subagent-container-spawn.test.ts
```

Expected: FAIL because production code still has separate box runtime types.

- [ ] **Step 3: Update container spec builder**

In `packages/agent/src/jobs/persona-container-spec.ts`:

- Keep `export type PersonaContainerRuntime = Extract<PersonaRuntime, { type: 'container' }>;`
- Delete `PersonaBoxRuntime`.
- Keep `PERSONA_BOX_CONTAINER_ID = 'sen-box'` or rename to `PERSISTENT_PERSONA_CONTAINER_ID = 'sen-box'`.
- Make `buildPersonaContainerSpec()` branch on `runtime.containerLifecycle`.

Use this branching shape:

```typescript
if (runtime.containerLifecycle === 'persistent') {
  return {
    name: 'box',
    containerId: PERSISTENT_PERSONA_CONTAINER_ID,
    image: runtime.image,
    workingDirectory: runtime.workingDirectory,
    mounts,
    env,
    restartPolicy: 'unless-stopped',
  };
}

return {
  name: `${parentSessionId}-${personaName}`,
  image: runtime.image,
  workingDirectory: runtime.workingDirectory,
  mounts,
  env,
  ...(runtime.ports ? { ports: runtime.ports } : {}),
};
```

- [ ] **Step 4: Update spawn path to one persona container runtime field**

In `packages/agent/src/jobs/subagent-spawn.ts`, delete `personaBoxRuntime` and route all explicit in-container persona containers through:

```typescript
personaContainerRuntime?: PersonaContainerRuntime;
```

`spawnSubagent()` should call one container helper whenever `personaContainerRuntime` is present. The helper should call `buildPersonaContainerSpec()` and then `materializeAndExecStream()`.

- [ ] **Step 5: Run tests and verify pass**

Run:

```bash
npm run test --workspace=packages/agent -- src/jobs/__tests__/persona-container-spec.test.ts src/jobs/__tests__/subagent-container-spawn.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status --short
git add packages/agent/src/jobs/persona-container-spec.ts packages/agent/src/jobs/subagent-spawn.ts packages/agent/src/jobs/__tests__/persona-container-spec.test.ts packages/agent/src/jobs/__tests__/subagent-container-spawn.test.ts
git commit -m "refactor: collapse persona container lifecycle handling"
```

### Task 3: Add Projected Binding Builder For Host-Placed Persona Containers

**Files:**

- Create: `packages/agent/src/jobs/persona-projected-binding.ts`
- Create: `packages/agent/src/jobs/__tests__/persona-projected-binding.test.ts`
- Modify: `packages/agent/src/jobs/persona-container-spec.ts`

- [ ] **Step 1: Write failing projected binding tests**

Create `packages/agent/src/jobs/__tests__/persona-projected-binding.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildPersonaProjectedRuntimeBinding } from '../persona-projected-binding';

describe('buildPersonaProjectedRuntimeBinding', () => {
  it('builds a projected binding for session lifecycle containers', () => {
    const binding = buildPersonaProjectedRuntimeBinding({
      parentSessionId: 'sess1',
      personaName: 'shell',
      runtime: {
        type: 'container',
        agentPlacement: 'host',
        containerLifecycle: 'session',
        image: 'node:24-bookworm',
        workingDirectory: '/work',
        mounts: { scratch: '/work' },
        env: { FOO: 'bar' },
        ports: [{ host: 6080, container: 6080 }],
      },
      containerMounts: { scratch: { hostPath: '/host/scratch', readonly: false } },
    });

    expect(binding.agentPlacement).toBe('host');
    expect(binding.toolRuntime).toMatchObject({
      type: 'container',
      cwd: '/work',
      spec: {
        name: 'sess1-shell',
        image: 'node:24-bookworm',
        workingDirectory: '/work',
        mounts: [{ hostPath: '/host/scratch', containerPath: '/work', readonly: false }],
        env: { FOO: 'bar' },
        ports: [{ host: 6080, container: 6080 }],
      },
      helper: {
        mode: 'mount',
        containerPath: '/usr/local/bin/lace-runtime-helper.js',
        command: ['node', '/usr/local/bin/lace-runtime-helper.js'],
      },
    });
  });
});
```

The persona's `runtime.image` (tag, digest, anything) flows through to `spec.image` verbatim. See "Known Tradeoffs" for why pre-resolution was dropped.

- [ ] **Step 2: Run projected binding tests and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/jobs/__tests__/persona-projected-binding.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Add a conversion helper from `ContainerSpec` to runtime spec**

In `packages/agent/src/jobs/persona-container-spec.ts`, export:

```typescript
export function containerSpecToRuntimeSpec(input: {
  spec: ContainerSpec;
}): Extract<RuntimeExecutionBinding['toolRuntime'], { type: 'container' }>['spec'] {
  const { spec } = input;
  return {
    name: spec.name,
    ...(spec.containerId ? { containerId: spec.containerId } : {}),
    image: spec.image,
    workingDirectory: spec.workingDirectory,
    mounts: spec.mounts.map((mount) => ({
      hostPath: mount.source,
      containerPath: mount.target,
      readonly: mount.readonly ?? false,
    })),
    ...(spec.env ? { env: spec.env } : {}),
    ...(spec.ports ? { ports: spec.ports } : {}),
    ...(spec.restartPolicy ? { restartPolicy: spec.restartPolicy } : {}),
  };
}
```

Add the needed type import from `../tools/runtime/types`.

- [ ] **Step 4: Implement projected binding builder**

Create `packages/agent/src/jobs/persona-projected-binding.ts`:

```typescript
import type { MountRegistryEntry } from '@lace/agent/server-types';
import { buildRuntimeId } from '@lace/agent/tools/runtime/identity';
import type { RuntimeExecutionBinding, RuntimeHelperDescriptor } from '@lace/agent/tools/runtime/types';
import { fileURLToPath } from 'node:url';
import {
  buildPersonaContainerSpec,
  containerSpecToRuntimeSpec,
  type PersonaContainerRuntime,
} from './persona-container-spec';

const HELPER_CONTAINER_PATH = '/usr/local/bin/lace-runtime-helper.js';

function resolveRuntimeHelperDescriptor(): RuntimeHelperDescriptor {
  const hostPath =
    process.env.LACE_RUNTIME_HELPER_HOST_PATH ??
    fileURLToPath(new URL('../tools/runtime/container-helper.js', import.meta.url));
  return {
    mode: 'mount',
    hostPath,
    containerPath: HELPER_CONTAINER_PATH,
    command: ['node', HELPER_CONTAINER_PATH],
  };
}

export function buildPersonaProjectedRuntimeBinding(input: {
  parentSessionId: string;
  personaName: string;
  runtime: PersonaContainerRuntime;
  containerMounts: Readonly<Record<string, MountRegistryEntry>>;
}): RuntimeExecutionBinding {
  const spec = buildPersonaContainerSpec({
    parentSessionId: input.parentSessionId,
    personaName: input.personaName,
    runtime: input.runtime,
    containerMounts: input.containerMounts,
  });

  const binding: RuntimeExecutionBinding = {
    schemaVersion: 1,
    identity: { runtimeId: 'pending' },
    agentPlacement: 'host',
    toolRuntime: {
      type: 'container',
      spec: containerSpecToRuntimeSpec({ spec }),
      cwd: input.runtime.workingDirectory,
      helper: resolveRuntimeHelperDescriptor(),
    },
  };

  return {
    ...binding,
    identity: {
      runtimeId: buildRuntimeId({
        scope: 'session',
        sessionId: input.parentSessionId,
        binding,
      }),
    },
  };
}
```

- [ ] **Step 5: Run projected binding tests and verify pass**

Run:

```bash
npm run test --workspace=packages/agent -- src/jobs/__tests__/persona-projected-binding.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add a helper-present review assertion**

Add this assertion to the projected binding tests:

```typescript
expect((binding.toolRuntime as Extract<RuntimeExecutionBinding['toolRuntime'], { type: 'container' }>).helper).toMatchObject({
  mode: 'mount',
  containerPath: '/usr/local/bin/lace-runtime-helper.js',
  command: ['node', '/usr/local/bin/lace-runtime-helper.js'],
});
```

- [ ] **Step 7: Commit**

```bash
git status --short
git add packages/agent/src/jobs/persona-projected-binding.ts packages/agent/src/jobs/persona-container-spec.ts packages/agent/src/jobs/__tests__/persona-projected-binding.test.ts
git commit -m "feat: build projected bindings for persona containers"
```

### Task 3B: Verify Persistent Container Adoption In Projected Mode

**Files:**

- Modify: `packages/agent/src/tools/runtime/__tests__/projected-container.test.ts`

- [ ] **Step 1: Write a failing adoption-regression test**

Add this test to `packages/agent/src/tools/runtime/__tests__/projected-container.test.ts`:

```typescript
it('uses a stable mounted helper when adopting an existing persistent container', async () => {
  const helperPath = '/host/lace-runtime-helper.js';
  const descriptor = {
    ...projectedDescriptor,
    spec: {
      ...projectedDescriptor.spec,
      name: 'box',
      containerId: 'sen-box',
      restartPolicy: 'unless-stopped' as const,
    },
    helper: {
      mode: 'mount' as const,
      hostPath: helperPath,
      containerPath: '/usr/local/bin/lace-runtime-helper.js',
      command: ['node', '/usr/local/bin/lace-runtime-helper.js'],
    },
  };
  const manager = new FakeProjectedContainerManager();
  manager.materialize.mockResolvedValueOnce({
    spec: {
      name: 'box',
      containerId: 'sen-box',
      image: descriptor.spec.image,
      workingDirectory: '/workspace',
      mounts: [
        { source: helperPath, target: '/usr/local/bin/lace-runtime-helper.js', readonly: true },
      ],
      restartPolicy: 'unless-stopped',
    },
    containerId: 'sen-box',
    state: 'running',
  });
  const runtime = new ProjectedContainerToolRuntime({
    id: 'rt_persistent',
    containerManager: manager,
    descriptor,
  });

  await runtime.process.exec(['true']);

  expect(manager.materialize).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'box',
      containerId: 'sen-box',
      restartPolicy: 'unless-stopped',
      mounts: expect.arrayContaining([
        { source: helperPath, target: '/usr/local/bin/lace-runtime-helper.js', readonly: true },
      ]),
    }),
    undefined
  );
});
```

This test intentionally uses helper `mode: 'mount'`. Persistent Sen containers must not rely on copy-mode helper tempdirs because those tempdirs belong to a previous Lace process after restart.

- [ ] **Step 2: Run projected container tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/projected-container.test.ts
```

Expected: PASS if projected runtime already forwards persistent specs and helper mounts correctly; otherwise FAIL on missing helper mount or lifecycle fields.

- [ ] **Step 3: Verify projected materialization preserves persistent fields**

Read `packages/agent/src/tools/runtime/projected-container.ts` and confirm `containerSpecFromDescriptor()` preserves `containerId`, `restartPolicy`, and helper mount fields when materializing projected container runtimes. If any of those fields are missing from the materialized `ContainerSpec`, add them in this step.

Do not use helper `mode: 'copy'` for Sen persistent containers.

- [ ] **Step 4: Run projected container tests again**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/projected-container.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add packages/agent/src/tools/runtime/projected-container.ts packages/agent/src/tools/runtime/__tests__/projected-container.test.ts
git commit -m "test: cover projected persistent container adoption"
```

---

## Chunk 3: Delegate Routing And Subagent Startup

### Task 4: Route Host-Placed Persona Containers Through Projected Bindings

**Files:**

- Modify: `packages/agent/src/tools/implementations/delegate.ts`
- Modify: `packages/agent/src/tools/implementations/__tests__/delegate.test.ts`
- Modify: `packages/agent/src/jobs/job-manager.ts`
- Modify: `packages/agent/src/jobs/job-creation.ts`
- Modify: `packages/agent/src/server-types.ts`

- [ ] **Step 1: Write failing delegate test for host-placed projected containers**

In `packages/agent/src/tools/implementations/__tests__/delegate.test.ts`, replace old container/box routing tests with:

```typescript
it('passes projected runtimeBinding for host-placed container personas', async () => {
  const personaRegistry = {
    parsePersona: vi.fn().mockReturnValue({
      config: {
        runtime: {
          type: 'container',
          agentPlacement: 'host',
          containerLifecycle: 'session',
          image: 'example/subagent@sha256:' + 'a'.repeat(64),
          workingDirectory: '/workspace',
          mounts: {},
          env: {},
        },
      },
      body: 'container persona',
    }),
  } as unknown as PersonaRegistry;
  const tool = new DelegateTool({ personaRegistry });
  const createJob = vi.fn().mockResolvedValue({
    jobId: 'job_projected',
    job: { status: 'running', completion: new Promise<void>(() => {}) } as JobState,
  });
  const jobManager = { createJob, listJobs: vi.fn().mockReturnValue([]) } as unknown as JobManager;

  await tool.execute(
    { prompt: 'do something', background: true, persona: 'container-persona' },
    { signal: new AbortController().signal, jobManager, runtimeBinding }
  );

  const options = createJob.mock.calls[0]![1] as Record<string, unknown>;
  expect(options.personaContainerRuntime).toBeUndefined();
  expect(options.runtimeBinding).toMatchObject({
    agentPlacement: 'host',
    toolRuntime: { type: 'container', cwd: '/workspace' },
  });
});
```

Add the persistent lifecycle version:

```typescript
expect((options.runtimeBinding as RuntimeExecutionBinding).toolRuntime).toMatchObject({
  type: 'container',
  spec: { name: 'box', containerId: 'sen-box', restartPolicy: 'unless-stopped' },
});
```

- [ ] **Step 2: Write failing delegate test for explicit lace-in-container placement**

Add:

```typescript
it('keeps explicit agentPlacement=container on the in-container path', async () => {
  const personaRegistry = {
    parsePersona: vi.fn().mockReturnValue({
      config: {
        runtime: {
          type: 'container',
          agentPlacement: 'container',
          containerLifecycle: 'session',
          image: 'example/subagent:latest',
          workingDirectory: '/workspace',
          mounts: {},
          env: {},
        },
      },
      body: 'container persona',
    }),
  } as unknown as PersonaRegistry;
  const tool = new DelegateTool({ personaRegistry });
  const createJob = vi.fn().mockResolvedValue({
    jobId: 'job_container_agent',
    job: { status: 'running', completion: new Promise<void>(() => {}) } as JobState,
  });
  const jobManager = { createJob, listJobs: vi.fn().mockReturnValue([]) } as unknown as JobManager;

  await tool.execute(
    { prompt: 'do something', background: true, persona: 'container-persona' },
    { signal: new AbortController().signal, jobManager, runtimeBinding }
  );

  const options = createJob.mock.calls[0]![1] as Record<string, unknown>;
  expect(options.runtimeBinding).toBeUndefined();
  expect(options.personaContainerRuntime).toMatchObject({
    type: 'container',
    agentPlacement: 'container',
    containerLifecycle: 'session',
  });
});
```

- [ ] **Step 3: Run delegate tests and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/implementations/__tests__/delegate.test.ts
```

Expected: FAIL because delegate still treats every persona container as an in-container subagent and still knows about `personaBoxRuntime`.

- [ ] **Step 4: Remove `personaBoxRuntime` from job state and options**

In `packages/agent/src/server-types.ts`, `packages/agent/src/jobs/job-manager.ts`, and `packages/agent/src/jobs/job-creation.ts`, delete `personaBoxRuntime` and its type import. Keep only:

```typescript
personaContainerRuntime?: PersonaContainerRuntime;
```

This field now means "explicit lace-agent-in-container runtime". Host-projected container personas use `runtimeBinding` instead.

- [ ] **Step 5: Implement delegate routing**

In `packages/agent/src/tools/implementations/delegate.ts`:

- Parse `parsed.config.runtime`.
- If runtime is `root`, inherit `context.runtimeBinding` as today.
- If runtime is `container` and `agentPlacement === 'host'`, call `buildPersonaProjectedRuntimeBinding()` and pass the result as `runtimeBinding`.
- If runtime is `container` and `agentPlacement === 'container'`, pass `personaContainerRuntime`.
- Never pass both `runtimeBinding` and `personaContainerRuntime`.

Do NOT pre-resolve the image to a digest. The persona's `runtime.image` flows through to `docker create` verbatim — see the "Known Tradeoffs" section. The projected runtime captures the daemon's `.Image` post-create for audit (in `projected-container.ts`); that captured ID is what gets logged as the runtime identity for tracking.

- [ ] **Step 6: Run delegate tests and verify pass**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/implementations/__tests__/delegate.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git status --short
git add packages/agent/src/tools/implementations/delegate.ts packages/agent/src/tools/implementations/__tests__/delegate.test.ts packages/agent/src/jobs/job-manager.ts packages/agent/src/jobs/job-creation.ts packages/agent/src/server-types.ts
git commit -m "feat: route host-placed persona containers through projection"
```

### Task 5: Update Subagent Startup For Single Container Runtime Field

**Files:**

- Modify: `packages/agent/src/jobs/subagent-job.ts`
- Modify: `packages/agent/src/jobs/__tests__/subagent-job-child-exit-propagation.test.ts`
- Modify: `packages/agent/src/jobs/__tests__/job-manager.test.ts`

- [ ] **Step 1: Update tests for single container runtime field**

In `packages/agent/src/jobs/__tests__/subagent-job-child-exit-propagation.test.ts`, change the job fixture from `personaBoxRuntime` to:

```typescript
personaContainerRuntime: {
  type: 'container',
  agentPlacement: 'container',
  containerLifecycle: 'persistent',
  image: 'sen-box:dev',
  workingDirectory: '/home/agent',
  mounts: {},
  env: {},
}
```

- [ ] **Step 2: Run subagent/job tests and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/jobs/__tests__/subagent-job-child-exit-propagation.test.ts src/jobs/__tests__/job-manager.test.ts
```

Expected: FAIL because `subagent-job.ts` still checks `personaBoxRuntime`.

- [ ] **Step 3: Update subagent runtime checks**

In `packages/agent/src/jobs/subagent-job.ts`, replace:

```typescript
const isContainerizedSubagent = !!job.personaContainerRuntime || !!job.personaBoxRuntime;
```

with:

```typescript
const isContainerizedSubagent = !!job.personaContainerRuntime;
```

Replace workdir selection with:

```typescript
const subagentWorkDir = job.personaContainerRuntime
  ? job.personaContainerRuntime.workingDirectory
  : currentState.activeSession!.meta.workDir;
```

Projected host-placed persona jobs must continue to enter the native child path, pass `job.runtimeBinding` via `session/new` or `session/resume`, and use the active host session workdir for the child process spawn.

- [ ] **Step 4: Run subagent/job tests and verify pass**

Run:

```bash
npm run test --workspace=packages/agent -- src/jobs/__tests__/subagent-job-child-exit-propagation.test.ts src/jobs/__tests__/job-manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add packages/agent/src/jobs/subagent-job.ts packages/agent/src/jobs/__tests__/subagent-job-child-exit-propagation.test.ts packages/agent/src/jobs/__tests__/job-manager.test.ts
git commit -m "refactor: use one persona container runtime field"
```

### Task 5B: Verify Projected Subagent Sessions Write Host-Side State

**Files:**

- Create: `packages/agent/src/jobs/__tests__/subagent-job-projected-runtime.test.ts`

- [ ] **Step 1: Write targeted host-writeback test**

Create `packages/agent/src/jobs/__tests__/subagent-job-projected-runtime.test.ts` using the same `spawnSubagent` mock pattern from `subagent-job-child-exit-propagation.test.ts`. The test should:

- create a parent host session directory under `mkdtempSync(join(tmpdir(), 'projected-subagent-'))`;
- create a `JobState` with `runtimeBinding` for `toolRuntime.type: 'container'`;
- leave `personaContainerRuntime` undefined;
- run `runSubagentJobProcess()`;
- mock child RPC responses for `initialize`, `session/new`, and prompt execution so the job reaches `job_session_assigned`;
- assert the `session/new` request receives `config.runtimeBinding`;
- assert the subagent session id is written to the parent host session event log as `job_session_assigned`.

The expected runtime binding fixture is:

```typescript
const runtimeBinding: RuntimeExecutionBinding = {
  schemaVersion: 1,
  identity: { runtimeId: 'rt_projected_subagent' },
  agentPlacement: 'host',
  toolRuntime: {
    type: 'container',
    cwd: '/work',
    spec: {
      name: 'sess_parent-shell',
      image: 'node:24-bookworm',
      workingDirectory: '/work',
      mounts: [],
    },
    helper: {
      mode: 'image',
      containerPath: '/usr/local/bin/lace-runtime-helper.js',
      command: ['node', '/usr/local/bin/lace-runtime-helper.js'],
    },
  },
};
```

The core assertion is:

```typescript
expect(sessionNewRequest).toMatchObject({
  cwd: parentWorkDir,
  config: { runtimeBinding },
});

const eventLines = readFileSync(join(parentSessionDir, 'events.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
expect(eventLines).toContainEqual(
  expect.objectContaining({
    type: 'job_session_assigned',
    data: expect.objectContaining({
      jobId,
      subagentSessionId: 'sess_child_projected',
    }),
  })
);
```

- [ ] **Step 2: Run the targeted test and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/jobs/__tests__/subagent-job-projected-runtime.test.ts
```

Expected: FAIL if projected subagent startup still behaves like in-container startup or drops `runtimeBinding`.

- [ ] **Step 3: Verify host-projected subagent startup behavior**

Read `packages/agent/src/jobs/subagent-job.ts` and confirm jobs with `runtimeBinding` and no `personaContainerRuntime`:

- spawn the child Lace process on the host;
- send parent host workdir as `cwd`;
- pass `config.runtimeBinding` to `session/new` and `session/resume`;
- write `job_session_assigned` to the parent host session event log through the existing `runExclusive()` path.

If any assertion is false, update `subagent-job.ts` in this step.

- [ ] **Step 4: Run the targeted test again**

Run:

```bash
npm run test --workspace=packages/agent -- src/jobs/__tests__/subagent-job-projected-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add packages/agent/src/jobs/subagent-job.ts packages/agent/src/jobs/__tests__/subagent-job-projected-runtime.test.ts
git commit -m "test: verify projected subagent host session writeback"
```

---

## Chunk 4: MCP Placement And Sen Templates

### Task 6: Update Sen Persona Templates And Template Tests

**Files:**

- Modify: `../sen-core-v2/templates/agent-personas/shell.md`
- Modify: `../sen-core-v2/templates/agent-personas/browser-driver.md`
- Modify: `../sen-core-v2/templates/agent-personas/box-shell.md`
- Modify: `../sen-core-v2/tests/automated/templates/shell-persona.test.ts`
- Modify: `../sen-core-v2/tests/automated/templates/box-shell-persona.test.ts`
- Modify: `../sen-core-v2/tests/automated/instance/browser-driver-persona.test.ts`

- [ ] **Step 1: Update Sen schema tests first**

Use this mirrored runtime schema in shell/browser tests:

```typescript
const runtimeContainerSchema = z
  .object({
    type: z.literal('container'),
    agentPlacement: z.enum(['host', 'container']).default('host'),
    containerLifecycle: z.enum(['session', 'persistent']),
    image: z.string().min(1),
    workingDirectory: z.string().min(1),
    mounts: z.record(mountNameSchema, z.string().min(1)),
    env: z.record(z.string(), z.string()).optional().default({}),
    ports: z.array(portMappingSchema).optional(),
  })
  .strict();
```

Update assertions:

```typescript
expect(data.runtime.agentPlacement).toBe('host');
expect(data.runtime.containerLifecycle).toBe('session');
```

For `box-shell-persona.test.ts`, assert:

```typescript
expect(data.runtime.type).toBe('container');
expect(data.runtime.agentPlacement).toBe('host');
expect(data.runtime.containerLifecycle).toBe('persistent');
```

For browser MCP, extend the assertion:

```typescript
const spec = fm.mcpServers?.['superpowers-chrome'];
expect(spec?.placement).toBe('toolRuntime');
```

- [ ] **Step 2: Run Sen template tests and verify failure**

Run from `../sen-core-v2`:

```bash
npm test -- tests/automated/templates/shell-persona.test.ts tests/automated/templates/box-shell-persona.test.ts tests/automated/instance/browser-driver-persona.test.ts
```

Expected: FAIL because templates still use old runtime shape and browser MCP lacks explicit placement.

- [ ] **Step 3: Update templates**

In `../sen-core-v2/templates/agent-personas/shell.md`:

```yaml
runtime:
  type: container
  agentPlacement: host
  containerLifecycle: session
```

In `../sen-core-v2/templates/agent-personas/browser-driver.md`:

```yaml
runtime:
  type: container
  agentPlacement: host
  containerLifecycle: session
```

and:

```yaml
mcpServers:
  superpowers-chrome:
    command: node
    args:
      - /opt/superpowers-chrome/mcp/dist/index.js
    placement: toolRuntime
    enabled: true
```

In `../sen-core-v2/templates/agent-personas/box-shell.md`:

```yaml
runtime:
  type: container
  agentPlacement: host
  containerLifecycle: persistent
```

- [ ] **Step 4: Run Sen template tests and verify pass**

Run from `../sen-core-v2`:

```bash
npm test -- tests/automated/templates/shell-persona.test.ts tests/automated/templates/box-shell-persona.test.ts tests/automated/instance/browser-driver-persona.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Sen changes**

`../sen-core-v2` is a sibling git repository. Commit the Sen changes there:

```bash
cd ../sen-core-v2
git status --short
git add templates/agent-personas/shell.md templates/agent-personas/browser-driver.md templates/agent-personas/box-shell.md tests/automated/templates/shell-persona.test.ts tests/automated/templates/box-shell-persona.test.ts tests/automated/instance/browser-driver-persona.test.ts
git commit -m "refactor: make persona container placement explicit"
cd ../lace
```

### Task 7: Lock Down Browser MCP Runtime Placement

**Files:**

- Modify: `packages/agent/src/mcp/server-manager.test.ts`
- Modify: `packages/agent/src/mcp/server-manager.env-keys.test.ts`
- Modify: `packages/agent/src/tools/runtime/__tests__/fake-runtime.ts`

- [ ] **Step 1: Add MCP manager test for runtime-placed stdio in container runtime**

In `packages/agent/src/mcp/server-manager.test.ts`, add:

```typescript
it('starts toolRuntime-placed stdio MCP servers through the active runtime', async () => {
  const runtime = createFakeRuntime();
  const start = vi.fn(runtime.process.start.bind(runtime.process));
  Object.assign(runtime, {
    id: 'rt_container_browser',
    kind: 'container',
    cwd: '/work',
    process: { ...runtime.process, start },
  });

  await manager.startServer({
    serverId: 'superpowers-chrome',
    config: {
      command: 'node',
      args: ['/opt/superpowers-chrome/mcp/dist/index.js'],
      transport: 'stdio',
      placement: 'toolRuntime',
      enabled: true,
      tools: {},
    },
    runtime,
    hostCwd: '/host/session',
  });

  expect(start).toHaveBeenCalledWith(
    ['node', '/opt/superpowers-chrome/mcp/dist/index.js'],
    expect.objectContaining({ cwd: '/work' })
  );
});
```

- [ ] **Step 2: Run MCP tests and verify pass or targeted failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/mcp/server-manager.test.ts src/mcp/server-manager.env-keys.test.ts
```

Expected: PASS if runtime placement already works; otherwise FAIL pointing to `MCPServerManager.startServer`.

- [ ] **Step 3: Fix runtime placement only if test fails**

If the test fails, update `packages/agent/src/mcp/server-manager.ts` so `placement: 'toolRuntime'` and `transport: 'stdio'` always use `RuntimeStdioClientTransport` over `runtime.process.start()`, with `cwd` set to `runtime.cwd`.

Do not coerce `superpowers-chrome` to host placement. Browser MCP must execute inside the projected container so it can see container-local display/browser state and container network.

- [ ] **Step 4: Run MCP tests and verify pass**

Run:

```bash
npm run test --workspace=packages/agent -- src/mcp/server-manager.test.ts src/mcp/server-manager.env-keys.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add packages/agent/src/mcp/server-manager.test.ts packages/agent/src/mcp/server-manager.env-keys.test.ts packages/agent/src/mcp/server-manager.ts packages/agent/src/tools/runtime/__tests__/fake-runtime.ts
git commit -m "test: lock browser mcp to projected tool runtime"
```

---

## Chunk 5: Remove `box` Runtime Concept Everywhere

### Task 8: Remove Remaining Old Runtime References

**Files:**

- Modify: any remaining matched files under `packages/agent`, `packages/web`, `docs`, and `../sen-core-v2`

- [ ] **Step 1: Search for old persona runtime names**

Run:

```bash
rg -n "runtime\\.type=box|runtime\\.type: box|type: box|type: 'box'|type: \"box\"|PersonaBoxRuntime|runtimeBoxSchema|personaBoxRuntime|buildPersonaBoxSpec" packages/agent packages/web docs ../sen-core-v2
```

Expected: no current-code matches for persona runtime `box`. Matches for ordinary CSS/UI terms like `box-shadow`, `rounded-box`, or the persona file name `box-shell.md` are allowed.

- [ ] **Step 2: Update source comments and tests**

Use these replacements for persona runtime code:

```text
box runtime -> persistent container runtime
PersonaBoxRuntime -> PersonaContainerRuntime
personaBoxRuntime -> personaContainerRuntime
runtimeBoxSchema -> runtimeContainerSchema
buildPersonaBoxSpec -> buildPersonaContainerSpec
runtime.type: box -> runtime.type: container with containerLifecycle: persistent
```

Do not replace low-level `toolRuntime.type: 'container'`.

- [ ] **Step 3: Update Sen rewrite fixture tests**

In `../sen-core-v2/tests/automated/instance/persona-rewrite.test.ts`, change inline former `box` frontmatter examples to:

```yaml
runtime:
  type: container
  agentPlacement: host
  containerLifecycle: persistent
```

Change current persona container examples to:

```yaml
runtime:
  type: container
  agentPlacement: host
  containerLifecycle: session
```

- [ ] **Step 4: Update the pre-PRI-1664 persona fixture**

Update `../sen-core-v2/tests/fixtures/personas-pre-pri-1664/box-shell.md` to the current runtime shape:

```yaml
runtime:
  type: container
  agentPlacement: host
  containerLifecycle: persistent
```

- [ ] **Step 5: Run focused search again**

Run:

```bash
rg -n "runtime\\.type=box|runtime\\.type: box|type: box|type: 'box'|type: \"box\"|PersonaBoxRuntime|runtimeBoxSchema|personaBoxRuntime|buildPersonaBoxSpec" packages/agent packages/web docs ../sen-core-v2
```

Expected: no current-code matches for persona runtime `box`.

- [ ] **Step 6: Run focused Lace and Sen tests**

Run from Lace root:

```bash
npm run test --workspace=packages/agent -- src/config/__tests__/persona-registry.test.ts src/jobs/__tests__/persona-container-spec.test.ts src/jobs/__tests__/subagent-container-spawn.test.ts src/tools/implementations/__tests__/delegate.test.ts src/mcp/server-manager.test.ts src/mcp/server-manager.env-keys.test.ts
```

Run from `../sen-core-v2`:

```bash
npm test -- tests/automated/templates/shell-persona.test.ts tests/automated/templates/box-shell-persona.test.ts tests/automated/instance/browser-driver-persona.test.ts tests/automated/instance/persona-rewrite.test.ts
```

Expected: PASS.

- [ ] **Step 7: Update operational docs**

In `../sen-core-v2/docs/runbooks/2026-05-19-1password-setup.md`, add a short note in the box-shell verification area:

```markdown
Projected `box-shell` runs the Lace agent on the host and projects tools into
the persistent `sen-box` container. Environment variables supplied to the
container are fixed when `sen-box` is materialized; after rotating
`OP_SERVICE_ACCOUNT_TOKEN`, destroy and recreate `sen-box` before expecting the
running container to see the new value.
```

In the tracker or implementation notes for PRI-1781, record:

```text
Resolved by projected container personas: shell, box-shell, and browser-driver
no longer run the child Lace agent inside a container-mounted lace-data
directory, so subagent session writes stay on the host and avoid the prior
lace-data permission mismatch.
```

- [ ] **Step 8: Commit**

```bash
git status --short
git add packages/agent packages/web docs ../sen-core-v2
git commit -m "chore: remove box persona runtime references"
```

---

## Chunk 6: Full Verification

### Task 9: Full Test Pass And Runtime Smoke Checks

**Files:**

- No planned source edits.

- [ ] **Step 1: Run full Lace tests**

Run from Lace root:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run full Sen tests**

Run from `../sen-core-v2`:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript checks if separate from tests**

Run from Lace root:

```bash
npm run typecheck
```

Expected: PASS. If this script does not exist, record that in the implementation notes and run the repo's documented equivalent.

Run from `../sen-core-v2`:

```bash
npm run typecheck
```

Expected: PASS. If this script does not exist, record that in the implementation notes and run the repo's documented equivalent.

- [ ] **Step 4: Run smoke checks for all Sen container personas**

Use the existing Sen local workflow to run:

```text
delegate to shell: pwd && echo shell-ok > /work/projection-smoke-shell.txt && cat /work/projection-smoke-shell.txt
delegate to box-shell: pwd && echo persistent-ok > /home/agent/projection-smoke-persistent.txt && cat /home/agent/projection-smoke-persistent.txt
delegate to browser-driver: open http://example.com, extract the page title, and save a screenshot under /work
```

Expected:

- Shell job logs and traces remain host-side in Lace.
- Shell tools execute inside the projected session lifecycle container.
- Persistent lifecycle container writes survive another delegate to `box-shell`.
- Browser MCP starts with `placement: toolRuntime`, drives Chromium in the browser container, and host port `6080` remains available for operator viewing.

- [ ] **Step 5: Search for accidental compatibility**

Run:

```bash
rg -n "runtime\\.type.*box|legacy.*box|compat.*box|personaBoxRuntime|runtimeBoxSchema|buildPersonaBoxSpec" packages/agent ../sen-core-v2 docs
```

Expected: no compatibility parser, alias, or silent fallback for old persona runtime `box`.

- [ ] **Step 6: Final commit if verification changed docs or tests**

```bash
git status --short
git add packages/agent ../sen-core-v2 docs
git commit -m "test: verify sen projected container personas"
```

Skip this commit if there are no changes.

---

## Plan Review Checklist

Before implementation starts, run this self-review:

- [ ] `agentPlacement` is the field that selects projected host agent versus lace-agent-in-container.
- [ ] `containerLifecycle` is only lifecycle/ownership, not the execution-mode selector.
- [ ] `box` is gone from persona runtime type names, exported runtime types, option field names, and schema names.
- [ ] Low-level `ToolRuntimeDescriptor.type: 'container'` remains unchanged.
- [ ] Browser MCP is explicitly `placement: toolRuntime`.
- [ ] Browser runtime ports are carried into the projected binding.
- [ ] Runtime helper source exists, builds to `packages/agent/dist/tools/runtime/container-helper.js`, and every projected persona binding includes a helper descriptor.
- [ ] Helper-backed operations have a per-request timeout.
- [ ] Persistent lifecycle semantics still use stable daemon id `sen-box` and restart policy.
- [ ] Persistent projected containers use helper `mode: 'mount'`, not copy-mode tempdirs.
- [ ] Persistent container secret rotation is documented as destroy/recreate.
- [ ] Projected subagent session events are verified to write to host-side session storage.
- [ ] No compatibility parser accepts `runtime.type: box`.
- [ ] PRI-1781 is recorded as resolved or obsolete after projected personas land.
- [ ] Sen templates and Lace schema are updated in the same implementation branch or coordinated sibling commits.
- [ ] Full Lace and Sen tests are run before handoff.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-sen-container-projection-runtime-names.md`.

Implementation agents must start from a clean worktree, use either `superpowers:subagent-driven-development` or `superpowers:executing-plans`, and execute tasks in order. Do not batch unrelated chunks. Commit after each task. Do not preserve old persona runtime `box` for compatibility.
