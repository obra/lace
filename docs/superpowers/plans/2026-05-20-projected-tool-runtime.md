# Projected Tool Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement projected tool runtimes so host-run Lace agents can execute
tools in local, workspace, or projected-container environments while keeping
sessions, traces, credentials, and job logs host-side.

**Architecture:** Add a versioned `RuntimeExecutionBinding` persisted in
session/job state, then route runtime-sensitive tool behavior through
`ToolRuntime` capabilities instead of per-tool host/container branches. Keep
lace-in-container delegates as an explicit alternate `agentPlacement`, and make
stdio MCP placement explicit so filesystem-sensitive MCP servers share the
active tool runtime.

**Tech Stack:** TypeScript, Zod, Vitest, Node `fs/promises`, `child_process`,
existing Lace session storage, existing container runtime abstractions, MCP
TypeScript SDK.

---

## Implementation Gate

This plan is required before implementation. Do not start projected-runtime code
changes from the spec alone. Implement in the stage order below, commit after
each task, and keep each task reviewable.

## File Structure

- Create `packages/agent/src/tools/runtime/types.ts`: runtime descriptor,
  persisted binding, secret reference, runtime path, capability interfaces.
- Create `packages/agent/src/tools/runtime/identity.ts`: opaque id generation
  and deterministic legacy fingerprint ids.
- Create `packages/agent/src/tools/runtime/validation.ts`: Zod schemas and
  structural validation/defaulting helpers for persisted bindings.
- Create `packages/agent/src/tools/runtime/secrets.ts`: host-side secret
  resolver interface and redacted error types.
- Create `packages/agent/src/tools/runtime/host.ts`: `HostToolRuntime`.
- Create `packages/agent/src/tools/runtime/workspace.ts`:
  `WorkspaceToolRuntime`.
- Create `packages/agent/src/tools/runtime/file-access-tracker.ts`:
  read-before-write tracking by canonical runtime path.
- Create `packages/agent/src/tools/runtime/image-identity.ts`:
  projected-container image identity normalization and validation helpers.
- Create `packages/agent/src/tools/runtime/projected-container.ts`:
  `ProjectedContainerToolRuntime` backed by container manager.
- Create `packages/agent/src/tools/runtime/runtime-stdio-transport.ts`: MCP SDK
  transport over `runtime.process.start()`.
- Create tests beside each runtime module under
  `packages/agent/src/tools/runtime/__tests__/`.
- Create `packages/agent/src/tools/runtime/__tests__/fake-runtime.ts`: shared
  fake `ToolRuntime` for runtime-aware tool tests.
- Modify `packages/agent/src/tools/types.ts`: add `runtime`, `markFileRead`, and
  runtime-aware file-read callbacks while keeping migration-only legacy fields.
- Modify `packages/agent/src/tools/tool.ts`: deprecate path helpers only after
  all consumers move.
- Modify built-in tools under `packages/agent/src/tools/implementations/`.
- Modify `packages/agent/src/core/conversation/runner.ts`: construct/pass active
  runtime and file access tracker.
- Modify `packages/agent/src/storage/session-store.ts`,
  `packages/agent/src/storage/event-types.ts`,
  `packages/agent/src/server-types.ts`,
  `packages/agent/src/jobs/job-creation.ts`,
  `packages/agent/src/jobs/job-derivation.ts`,
  `packages/agent/src/jobs/shell-job.ts`, and
  `packages/agent/src/jobs/subagent-job.ts`: persist/recover runtime bindings.
- Modify `packages/agent/src/config/mcp-types.ts`,
  `packages/agent/src/config/mcp-config-loader.ts`,
  `packages/ent-protocol/src/schemas/shared.ts`,
  `packages/agent/src/rpc/session-config.ts`,
  `packages/agent/src/rpc/handlers/mcp-servers.ts`, and
  `packages/agent/src/mcp/server-manager.ts`: MCP
  placement/defaulting/reconciliation/runtime stdio.
- Keep `docs/specs/2026-05-18-tool-runtime-projection-spec.md` as the source
  contract.

---

### Task 1: Runtime Binding Types And Legacy Identity

**Files:**

- Create: `packages/agent/src/tools/runtime/types.ts`
- Create: `packages/agent/src/tools/runtime/identity.ts`
- Test: `packages/agent/src/tools/runtime/__tests__/identity.test.ts`

- [ ] **Step 1: Write failing identity fixture tests**

Create `packages/agent/src/tools/runtime/__tests__/identity.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  buildLegacyRuntimeId,
  canonicalRuntimeIdentityJson,
} from '../identity';
import type { RuntimeExecutionBinding } from '../types';

describe('runtime identity', () => {
  it('matches the legacy local fixture from the spec', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'legacy:session:sess_123:d33ee12dd7d5f31b' },
      agentPlacement: 'host',
      toolRuntime: { type: 'local', cwd: '/repo' },
    };

    expect(
      canonicalRuntimeIdentityJson({
        schemaVersion: binding.schemaVersion,
        agentPlacement: binding.agentPlacement,
        scope: 'session',
        sessionId: 'sess_123',
        toolRuntime: binding.toolRuntime,
      })
    ).toBe(
      '{"agentPlacement":"host","schemaVersion":1,"scope":"session","sessionId":"sess_123","toolRuntime":{"cwd":"/repo","type":"local"}}'
    );

    expect(
      buildLegacyRuntimeId({ scope: 'session', sessionId: 'sess_123', binding })
    ).toBe('legacy:session:sess_123:d33ee12dd7d5f31b');
  });

  it('matches the legacy workspace fixture from the spec', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'legacy:session:sess_123:540af98facc5cf4c' },
      agentPlacement: 'host',
      toolRuntime: {
        type: 'workspace',
        projectRoot: '/repo',
        workspaceRoot: '/tmp/ws',
        cwd: '/work',
      },
    };

    expect(
      buildLegacyRuntimeId({ scope: 'session', sessionId: 'sess_123', binding })
    ).toBe('legacy:session:sess_123:540af98facc5cf4c');
  });

  it('matches the legacy job fixture from the spec', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'legacy:job:sess_123:job_456:4412929fcf49cd3e' },
      agentPlacement: 'host',
      toolRuntime: { type: 'local', cwd: '/repo' },
    };

    expect(
      buildLegacyRuntimeId({
        scope: 'job',
        sessionId: 'sess_123',
        jobId: 'job_456',
        binding,
      })
    ).toBe('legacy:job:sess_123:job_456:4412929fcf49cd3e');
  });
});
```

- [ ] **Step 2: Run identity tests and verify they fail**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/identity.test.ts
```

Expected: FAIL with module resolution errors for `../identity` and `../types`.

- [ ] **Step 3: Add runtime type definitions**

Create `packages/agent/src/tools/runtime/types.ts`:

```typescript
import type { Readable, Writable } from 'node:stream';

export type RuntimeBindingSchemaVersion = 1;
export type RuntimeSecretNamespace = 'session' | 'project' | 'host-service';
export type ToolRuntimeKind = 'local' | 'workspace' | 'container';
export type AgentPlacement = 'host' | 'container';

export interface RuntimeSecretReference {
  namespace: RuntimeSecretNamespace;
  name: string;
}

export interface RuntimeBindingIdentity {
  runtimeId: string;
}

export interface RuntimeMountDescriptor {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

export interface RuntimePortDescriptor {
  host: number;
  container: number;
}

export interface RuntimeHelperDescriptor {
  mode: 'copy' | 'mount' | 'image';
  hostPath?: string;
  containerPath: string;
  command: string[];
}

export type ToolRuntimeDescriptor =
  | { type: 'local'; cwd: string }
  | {
      type: 'workspace';
      projectRoot: string;
      workspaceRoot: string;
      cwd: string;
    }
  | {
      type: 'container';
      spec: {
        name: string;
        containerId?: string;
        requestedImage: string;
        resolvedImageDigest: string;
        imagePlatform: string;
        workingDirectory: string;
        mounts: RuntimeMountDescriptor[];
        env?: Record<string, string>;
        secretEnv?: Record<string, RuntimeSecretReference>;
        ports?: RuntimePortDescriptor[];
        restartPolicy?: 'unless-stopped';
      };
      cwd: string;
      helper?: RuntimeHelperDescriptor;
    };

export interface RuntimeExecutionBinding {
  schemaVersion: RuntimeBindingSchemaVersion;
  identity: RuntimeBindingIdentity;
  toolRuntime: ToolRuntimeDescriptor;
  agentPlacement: AgentPlacement;
}

export interface RuntimePath {
  original: string;
  runtimePath: string;
  hostPath?: string;
  displayPath: string;
}

export interface RuntimePathService {
  resolve(inputPath: string): Promise<RuntimePath>;
  canonicalKey(path: RuntimePath): string;
}

export interface RuntimeFileSystem {
  stat(
    path: RuntimePath
  ): Promise<{ type: 'file' | 'directory'; size: number; mtime: Date }>;
  readTextFile(path: RuntimePath): Promise<string>;
  writeTextFile(path: RuntimePath, content: string): Promise<void>;
  mkdir(path: RuntimePath, opts?: { recursive?: boolean }): Promise<void>;
  readdir(
    path: RuntimePath
  ): Promise<Array<{ name: string; type: 'file' | 'directory' }>>;
}

export interface RuntimeProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface RuntimeProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RuntimeProcessHandle {
  pid?: number;
  stdin?: Writable;
  stdout?: Readable;
  stderr?: Readable;
  kill(signal?: NodeJS.Signals): void;
  completion: Promise<{ exitCode: number | null; signal?: NodeJS.Signals }>;
}

export interface RuntimeProcessRunner {
  exec(
    command: string[],
    opts?: RuntimeProcessOptions
  ): Promise<RuntimeProcessResult>;
  start(
    command: string[],
    opts?: RuntimeProcessOptions
  ): Promise<RuntimeProcessHandle>;
}

export interface RuntimeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface RuntimeFetchResult {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface RuntimeNetworkClient {
  fetch(url: string, opts?: RuntimeFetchOptions): Promise<RuntimeFetchResult>;
}

export interface ToolRuntime {
  readonly id: string;
  readonly kind: ToolRuntimeKind;
  readonly cwd: string;
  readonly label: string;
  readonly paths: RuntimePathService;
  readonly fs: RuntimeFileSystem;
  readonly process: RuntimeProcessRunner;
  readonly network: RuntimeNetworkClient;
}
```

- [ ] **Step 4: Add identity implementation**

Create `packages/agent/src/tools/runtime/identity.ts`:

```typescript
import { createHash, randomUUID } from 'node:crypto';
import type { RuntimeExecutionBinding } from './types';

type RuntimeIdentityScope = 'session' | 'job' | 'mcp';

export function createRuntimeId(): string {
  return `rt_${randomUUID()}`;
}

export function canonicalRuntimeIdentityJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalRuntimeIdentityJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${canonicalRuntimeIdentityJson(entryValue)}`
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function legacyRuntimeFingerprint(input: unknown): string {
  return createHash('sha256')
    .update(canonicalRuntimeIdentityJson(input))
    .digest('hex')
    .slice(0, 16);
}

export function buildLegacyRuntimeId(input: {
  scope: RuntimeIdentityScope;
  sessionId: string;
  jobId?: string;
  serverId?: string;
  binding: RuntimeExecutionBinding;
}): string {
  const common = {
    schemaVersion: input.binding.schemaVersion,
    agentPlacement: input.binding.agentPlacement,
    scope: input.scope,
    sessionId: input.sessionId,
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.serverId ? { serverId: input.serverId } : {}),
    toolRuntime: input.binding.toolRuntime,
  };
  const fingerprint = legacyRuntimeFingerprint(common);
  if (input.scope === 'job') {
    if (!input.jobId)
      throw new Error('job-scoped legacy runtime id requires jobId');
    return `legacy:job:${input.sessionId}:${input.jobId}:${fingerprint}`;
  }
  if (input.scope === 'mcp') {
    if (!input.serverId)
      throw new Error('mcp-scoped legacy runtime id requires serverId');
    return `legacy:mcp:${input.sessionId}:${input.serverId}:${fingerprint}`;
  }
  return `legacy:session:${input.sessionId}:${fingerprint}`;
}
```

- [ ] **Step 5: Run identity tests and verify they pass**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/identity.test.ts
```

Expected: PASS for all three fixture tests.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/tools/runtime/types.ts packages/agent/src/tools/runtime/identity.ts packages/agent/src/tools/runtime/__tests__/identity.test.ts
git commit -m "feat: add runtime binding identity types"
```

---

### Task 2: Persist Runtime Binding Paths Without Behavior Change

**Files:**

- Modify: `packages/agent/src/storage/session-store.ts`
- Modify: `packages/agent/src/storage/event-types.ts`
- Modify: `packages/agent/src/server-types.ts`
- Modify: `packages/agent/src/jobs/job-creation.ts`
- Test: `packages/agent/src/storage/__tests__/session-store.test.ts`
- Test: `packages/agent/src/jobs/__tests__/job-manager.test.ts`

- [ ] **Step 1: Write failing session state persistence test**

Add this test to `packages/agent/src/storage/__tests__/session-store.test.ts`:

```typescript
it('persists runtimeBinding under state.config.runtimeBinding', () => {
  const sessionDir = join(tempDir, 'sess_runtime_binding');
  writeSessionMeta(sessionDir, {
    sessionId: 'sess_runtime_binding',
    workDir: '/repo',
    created: '2026-05-20T00:00:00.000Z',
  });

  writeSessionState(sessionDir, {
    nextEventSeq: 1,
    nextStreamSeq: 1,
    config: {
      runtimeBinding: {
        schemaVersion: 1,
        identity: { runtimeId: 'rt_test' },
        agentPlacement: 'host',
        toolRuntime: { type: 'local', cwd: '/repo' },
      },
    },
  });

  expect(readSessionState(sessionDir).config?.runtimeBinding).toEqual({
    schemaVersion: 1,
    identity: { runtimeId: 'rt_test' },
    agentPlacement: 'host',
    toolRuntime: { type: 'local', cwd: '/repo' },
  });
});
```

- [ ] **Step 2: Run session store test and verify it fails**

Run:

```bash
npm run test --workspace=packages/agent -- src/storage/__tests__/session-store.test.ts
```

Expected: FAIL because `SessionState['config']` does not type `runtimeBinding`.

- [ ] **Step 3: Add runtime binding to persisted types**

Modify `packages/agent/src/storage/session-store.ts`:

```typescript
import type { RuntimeExecutionBinding } from '../tools/runtime/types';
```

Inside `SessionState['config']`, add:

```typescript
runtimeBinding?: RuntimeExecutionBinding;
```

Modify `readSessionState()` so the returned `config` preserves
unknown-compatible parsed config plus the typed field:

```typescript
config: typeof parsed.config === 'object' && parsed.config ? (parsed.config as SessionState['config']) : undefined,
```

- [ ] **Step 4: Add runtime binding to durable job and job state types**

Modify `packages/agent/src/storage/event-types.ts`:

```typescript
import type { RuntimeExecutionBinding } from '../tools/runtime/types';
```

Add to `JobStartedEventData`:

```typescript
runtimeBinding?: RuntimeExecutionBinding;
```

Modify `packages/agent/src/server-types.ts`:

```typescript
import type { RuntimeExecutionBinding } from './tools/runtime/types';
```

Add to `JobState`:

```typescript
runtimeBinding?: RuntimeExecutionBinding;
```

- [ ] **Step 5: Thread runtime binding through job creation options**

Modify `packages/agent/src/jobs/job-creation.ts` so `CreateShellJobOptions` and
`CreateSubagentJobOptions` accept:

```typescript
runtimeBinding?: RuntimeExecutionBinding;
```

Add `runtimeBinding: options.runtimeBinding` to the `JobState` object for shell
and delegate jobs when present.

Add `runtimeBinding: options.runtimeBinding` to the `persistJobStartedEvent`
payload when present:

```typescript
...(options.runtimeBinding ? { runtimeBinding: options.runtimeBinding } : {}),
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/storage/__tests__/session-store.test.ts src/jobs/__tests__/job-manager.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/storage/session-store.ts packages/agent/src/storage/event-types.ts packages/agent/src/server-types.ts packages/agent/src/jobs/job-creation.ts packages/agent/src/storage/__tests__/session-store.test.ts
git commit -m "feat: persist runtime bindings in session and jobs"
```

---

### Task 3: Runtime Binding Validation, Defaults, And Image Identity Schema

**Files:**

- Create: `packages/agent/src/tools/runtime/validation.ts`
- Create: `packages/agent/src/tools/runtime/image-identity.ts`
- Test: `packages/agent/src/tools/runtime/__tests__/validation.test.ts`
- Test: `packages/agent/src/tools/runtime/__tests__/image-identity.test.ts`

- [ ] **Step 1: Write failing validation tests**

Create `packages/agent/src/tools/runtime/__tests__/validation.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  buildDefaultLocalRuntimeBinding,
  parseRuntimeExecutionBinding,
} from '../validation';

describe('runtime binding validation', () => {
  it('defaults missing legacy state to local runtime with a legacy id', () => {
    expect(
      buildDefaultLocalRuntimeBinding({ sessionId: 'sess_123', cwd: '/repo' })
    ).toMatchObject({
      schemaVersion: 1,
      identity: {
        runtimeId: expect.stringMatching(/^legacy:session:sess_123:/),
      },
      agentPlacement: 'host',
      toolRuntime: { type: 'local', cwd: '/repo' },
    });
  });

  it('rejects unknown schema versions', () => {
    expect(() =>
      parseRuntimeExecutionBinding({
        schemaVersion: 99,
        identity: { runtimeId: 'rt_bad' },
        agentPlacement: 'host',
        toolRuntime: { type: 'local', cwd: '/repo' },
      })
    ).toThrow(/unsupported runtime binding version/i);
  });

  it('rejects projected container binding without image platform', () => {
    expect(() =>
      parseRuntimeExecutionBinding({
        schemaVersion: 1,
        identity: { runtimeId: 'rt_container' },
        agentPlacement: 'host',
        toolRuntime: {
          type: 'container',
          cwd: '/workspace',
          spec: {
            name: 'proj',
            requestedImage: 'example/app:dev',
            resolvedImageDigest:
              'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            workingDirectory: '/workspace',
            mounts: [],
          },
        },
      })
    ).toThrow(/imagePlatform/i);
  });
});
```

Create `packages/agent/src/tools/runtime/__tests__/image-identity.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  normalizeImagePlatform,
  validateResolvedImageDigest,
} from '../image-identity';

describe('container image identity', () => {
  it('normalizes supported platform syntax', () => {
    expect(normalizeImagePlatform('Linux/ARM64')).toBe('linux/arm64');
    expect(normalizeImagePlatform('linux/arm/v7')).toBe('linux/arm/v7');
  });

  it('rejects malformed platform syntax', () => {
    expect(() => normalizeImagePlatform('linux')).toThrow(/platform/i);
    expect(() => normalizeImagePlatform('linux/')).toThrow(/platform/i);
  });

  it('validates sha256 digest strings', () => {
    expect(() =>
      validateResolvedImageDigest(
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      )
    ).not.toThrow();
    expect(() => validateResolvedImageDigest('latest')).toThrow(/digest/i);
  });
});
```

- [ ] **Step 2: Run validation tests and verify they fail**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/validation.test.ts src/tools/runtime/__tests__/image-identity.test.ts
```

Expected: FAIL because validation modules do not exist.

- [ ] **Step 3: Implement image identity helpers**

Create `packages/agent/src/tools/runtime/image-identity.ts`:

```typescript
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const PLATFORM_RE = /^[a-z0-9]+\/[a-z0-9]+(?:\/[a-z0-9._-]+)?$/;

export class RuntimeImageIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeImageIdentityError';
  }
}

export function validateResolvedImageDigest(value: string): string {
  if (!DIGEST_RE.test(value)) {
    throw new RuntimeImageIdentityError(
      'resolvedImageDigest must be an immutable sha256 digest'
    );
  }
  return value;
}

export function normalizeImagePlatform(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!PLATFORM_RE.test(normalized)) {
    throw new RuntimeImageIdentityError(
      'imagePlatform must use os/arch or os/arch/variant syntax'
    );
  }
  return normalized;
}
```

- [ ] **Step 4: Implement Zod validation/defaulting**

Create `packages/agent/src/tools/runtime/validation.ts`:

```typescript
import { z } from 'zod';
import { buildLegacyRuntimeId } from './identity';
import {
  normalizeImagePlatform,
  validateResolvedImageDigest,
} from './image-identity';
import type { RuntimeExecutionBinding } from './types';

const RuntimeSecretReferenceSchema = z
  .object({
    namespace: z.enum(['session', 'project', 'host-service']),
    name: z.string().min(1),
  })
  .strict();

const LocalRuntimeDescriptorSchema = z
  .object({ type: z.literal('local'), cwd: z.string().min(1) })
  .strict();

const WorkspaceRuntimeDescriptorSchema = z
  .object({
    type: z.literal('workspace'),
    projectRoot: z.string().min(1),
    workspaceRoot: z.string().min(1),
    cwd: z.string().min(1),
  })
  .strict();

const ContainerRuntimeDescriptorSchema = z
  .object({
    type: z.literal('container'),
    cwd: z.string().min(1),
    spec: z
      .object({
        name: z.string().min(1),
        containerId: z.string().min(1).optional(),
        requestedImage: z.string().min(1),
        resolvedImageDigest: z
          .string()
          .min(1)
          .transform(validateResolvedImageDigest),
        imagePlatform: z.string().min(1).transform(normalizeImagePlatform),
        workingDirectory: z.string().min(1),
        mounts: z.array(
          z
            .object({
              hostPath: z.string().min(1),
              containerPath: z.string().min(1),
              readonly: z.boolean(),
            })
            .strict()
        ),
        env: z.record(z.string(), z.string()).optional(),
        secretEnv: z
          .record(z.string(), RuntimeSecretReferenceSchema)
          .optional(),
        ports: z
          .array(
            z
              .object({ host: z.number().int(), container: z.number().int() })
              .strict()
          )
          .optional(),
        restartPolicy: z.literal('unless-stopped').optional(),
      })
      .strict(),
    helper: z
      .object({
        mode: z.enum(['copy', 'mount', 'image']),
        hostPath: z.string().min(1).optional(),
        containerPath: z.string().min(1),
        command: z.array(z.string().min(1)),
      })
      .strict()
      .optional(),
  })
  .strict();

const RuntimeExecutionBindingSchema = z
  .object({
    schemaVersion: z.literal(1),
    identity: z.object({ runtimeId: z.string().min(1) }).strict(),
    agentPlacement: z.enum(['host', 'container']),
    toolRuntime: z.discriminatedUnion('type', [
      LocalRuntimeDescriptorSchema,
      WorkspaceRuntimeDescriptorSchema,
      ContainerRuntimeDescriptorSchema,
    ]),
  })
  .strict();

export function parseRuntimeExecutionBinding(
  value: unknown
): RuntimeExecutionBinding {
  const parsed = RuntimeExecutionBindingSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const version =
    value && typeof value === 'object'
      ? (value as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (version !== 1) {
    throw new Error(`Unsupported runtime binding version: ${String(version)}`);
  }
  throw new Error(`Invalid runtime binding: ${parsed.error.message}`);
}

export function buildDefaultLocalRuntimeBinding(input: {
  sessionId: string;
  cwd: string;
}): RuntimeExecutionBinding {
  const binding: RuntimeExecutionBinding = {
    schemaVersion: 1,
    identity: { runtimeId: 'pending' },
    agentPlacement: 'host',
    toolRuntime: { type: 'local', cwd: input.cwd },
  };
  return {
    ...binding,
    identity: {
      runtimeId: buildLegacyRuntimeId({
        scope: 'session',
        sessionId: input.sessionId,
        binding,
      }),
    },
  };
}
```

- [ ] **Step 5: Run validation tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/validation.test.ts src/tools/runtime/__tests__/image-identity.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/tools/runtime/validation.ts packages/agent/src/tools/runtime/image-identity.ts packages/agent/src/tools/runtime/__tests__/validation.test.ts packages/agent/src/tools/runtime/__tests__/image-identity.test.ts
git commit -m "feat: validate runtime bindings"
```

---

### Task 4: Host-Side Secret Resolver And Reauthorization Boundary

**Files:**

- Create: `packages/agent/src/tools/runtime/secrets.ts`
- Test: `packages/agent/src/tools/runtime/__tests__/secrets.test.ts`

- [ ] **Step 1: Write failing secret resolver tests**

Create `packages/agent/src/tools/runtime/__tests__/secrets.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  InMemoryRuntimeSecretResolver,
  RuntimeSecretResolutionError,
  redactSecretReference,
} from '../secrets';

describe('runtime secret resolver', () => {
  it('resolves authorized references', async () => {
    const resolver = new InMemoryRuntimeSecretResolver({
      'project:api-key': 'secret-value',
    });

    await expect(
      resolver.resolve({
        reference: { namespace: 'project', name: 'api-key' },
        runtimeId: 'rt_1',
        sessionId: 'sess_1',
      })
    ).resolves.toBe('secret-value');
  });

  it('throws redacted errors for missing references', async () => {
    const resolver = new InMemoryRuntimeSecretResolver({});
    await expect(
      resolver.resolve({
        reference: { namespace: 'project', name: 'missing' },
        runtimeId: 'rt_1',
        sessionId: 'sess_1',
      })
    ).rejects.toThrow(RuntimeSecretResolutionError);
  });

  it('redacts reference identity for model-visible output', () => {
    expect(
      redactSecretReference({ namespace: 'project', name: 'api-key' })
    ).toBe('[secret:project:REDACTED]');
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/secrets.test.ts
```

Expected: FAIL because `../secrets` does not exist.

- [ ] **Step 3: Implement resolver interface and test resolver**

Create `packages/agent/src/tools/runtime/secrets.ts`:

```typescript
import type { RuntimeSecretReference } from './types';

export interface RuntimeSecretResolutionRequest {
  reference: RuntimeSecretReference;
  runtimeId: string;
  sessionId: string;
  jobId?: string;
  serverId?: string;
}

export interface RuntimeSecretResolver {
  resolve(request: RuntimeSecretResolutionRequest): Promise<string>;
}

export class RuntimeSecretResolutionError extends Error {
  constructor(
    message: string,
    public readonly reference: RuntimeSecretReference
  ) {
    super(message);
    this.name = 'RuntimeSecretResolutionError';
  }
}

export function redactSecretReference(
  reference: RuntimeSecretReference
): string {
  return `[secret:${reference.namespace}:REDACTED]`;
}

export class InMemoryRuntimeSecretResolver implements RuntimeSecretResolver {
  constructor(private readonly values: Record<string, string>) {}

  async resolve(request: RuntimeSecretResolutionRequest): Promise<string> {
    const key = `${request.reference.namespace}:${request.reference.name}`;
    const value = this.values[key];
    if (value === undefined) {
      throw new RuntimeSecretResolutionError(
        `Secret unavailable or unauthorized: ${redactSecretReference(request.reference)}`,
        request.reference
      );
    }
    return value;
  }
}

export async function resolveSecretEnv(input: {
  secretEnv?: Record<string, RuntimeSecretReference>;
  resolver: RuntimeSecretResolver;
  runtimeId: string;
  sessionId: string;
  jobId?: string;
  serverId?: string;
}): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const [name, reference] of Object.entries(input.secretEnv ?? {})) {
    resolved[name] = await input.resolver.resolve({
      reference,
      runtimeId: input.runtimeId,
      sessionId: input.sessionId,
      jobId: input.jobId,
      serverId: input.serverId,
    });
  }
  return resolved;
}
```

- [ ] **Step 4: Run secret tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/secrets.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/tools/runtime/secrets.ts packages/agent/src/tools/runtime/__tests__/secrets.test.ts
git commit -m "feat: add runtime secret resolver boundary"
```

---

### Task 5: Host Runtime Capabilities And ToolContext Wiring

**Files:**

- Create: `packages/agent/src/tools/runtime/host.ts`
- Test: `packages/agent/src/tools/runtime/__tests__/host.test.ts`
- Modify: `packages/agent/src/tools/types.ts`
- Modify: `packages/agent/src/core/conversation/runner.ts`

- [ ] **Step 1: Write failing host runtime tests**

Create `packages/agent/src/tools/runtime/__tests__/host.test.ts`:

```typescript
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HostToolRuntime } from '../host';

describe('HostToolRuntime', () => {
  it('resolves relative paths against cwd and reads files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-host-runtime-'));
    await writeFile(join(dir, 'file.txt'), 'hello', 'utf8');

    const runtime = new HostToolRuntime({ id: 'rt_host', cwd: dir });
    const path = await runtime.paths.resolve('file.txt');

    expect(path.runtimePath).toBe(join(dir, 'file.txt'));
    expect(runtime.paths.canonicalKey(path)).toBe(join(dir, 'file.txt'));
    await expect(runtime.fs.readTextFile(path)).resolves.toBe('hello');
  });

  it('executes commands in cwd', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-host-runtime-'));
    const runtime = new HostToolRuntime({ id: 'rt_host', cwd: dir });

    const result = await runtime.process.exec([
      'node',
      '-e',
      'process.stdout.write(process.cwd())',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(dir);
  });

  it('writes text files through runtime fs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-host-runtime-'));
    const runtime = new HostToolRuntime({ id: 'rt_host', cwd: dir });
    const path = await runtime.paths.resolve('out.txt');

    await runtime.fs.writeTextFile(path, 'content');

    await expect(readFile(join(dir, 'out.txt'), 'utf8')).resolves.toBe(
      'content'
    );
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/host.test.ts
```

Expected: FAIL because `HostToolRuntime` does not exist.

- [ ] **Step 3: Implement host runtime**

Create `packages/agent/src/tools/runtime/host.ts`:

```typescript
import { execFile, spawn } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
  RuntimeFileSystem,
  RuntimeNetworkClient,
  RuntimePath,
  RuntimePathService,
  RuntimeProcessRunner,
  ToolRuntime,
} from './types';

const execFileAsync = promisify(execFile);

class HostPathService implements RuntimePathService {
  constructor(private readonly cwd: string) {}

  async resolve(inputPath: string): Promise<RuntimePath> {
    const runtimePath = isAbsolute(inputPath)
      ? inputPath
      : resolve(this.cwd, inputPath);
    return {
      original: inputPath,
      runtimePath,
      hostPath: runtimePath,
      displayPath: inputPath,
    };
  }

  canonicalKey(path: RuntimePath): string {
    return resolve(path.runtimePath);
  }
}

class HostFileSystem implements RuntimeFileSystem {
  async stat(
    path: RuntimePath
  ): Promise<{ type: 'file' | 'directory'; size: number; mtime: Date }> {
    const result = await stat(path.hostPath ?? path.runtimePath);
    return {
      type: result.isDirectory() ? 'directory' : 'file',
      size: result.size,
      mtime: result.mtime,
    };
  }

  async readTextFile(path: RuntimePath): Promise<string> {
    return await readFile(path.hostPath ?? path.runtimePath, 'utf8');
  }

  async writeTextFile(path: RuntimePath, content: string): Promise<void> {
    await writeFile(path.hostPath ?? path.runtimePath, content, 'utf8');
  }

  async mkdir(
    path: RuntimePath,
    opts?: { recursive?: boolean }
  ): Promise<void> {
    await mkdir(path.hostPath ?? path.runtimePath, {
      recursive: opts?.recursive,
    });
  }

  async readdir(
    path: RuntimePath
  ): Promise<Array<{ name: string; type: 'file' | 'directory' }>> {
    const entries = await readdir(path.hostPath ?? path.runtimePath, {
      withFileTypes: true,
    });
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
    }));
  }
}

class HostProcessRunner implements RuntimeProcessRunner {
  constructor(private readonly cwd: string) {}

  async exec(command: string[], opts = {}) {
    const [file, ...args] = command;
    if (!file) throw new Error('runtime process command is empty');
    const result = await execFileAsync(file, args, {
      cwd: opts.cwd ?? this.cwd,
      env: opts.env,
      signal: opts.signal,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  }

  async start(command: string[], opts = {}) {
    const [file, ...args] = command;
    if (!file) throw new Error('runtime process command is empty');
    const child = spawn(file, args, {
      cwd: opts.cwd ?? this.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: opts.signal,
    });
    return {
      pid: child.pid,
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      kill: (signal?: NodeJS.Signals) => child.kill(signal),
      completion: new Promise((resolve) => {
        child.on('close', (exitCode, signal) =>
          resolve({ exitCode, signal: signal ?? undefined })
        );
      }),
    };
  }
}

class HostNetworkClient implements RuntimeNetworkClient {
  async fetch(url: string, opts = {}) {
    const response = await fetch(url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      signal: opts.signal,
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: new Uint8Array(await response.arrayBuffer()),
    };
  }
}

export class HostToolRuntime implements ToolRuntime {
  readonly kind = 'local' as const;
  readonly label = 'Host';
  readonly paths: RuntimePathService;
  readonly fs = new HostFileSystem();
  readonly process: RuntimeProcessRunner;
  readonly network = new HostNetworkClient();

  constructor(readonly input: { id: string; cwd: string }) {
    this.id = input.id;
    this.cwd = input.cwd;
    this.paths = new HostPathService(input.cwd);
    this.process = new HostProcessRunner(input.cwd);
  }

  readonly id: string;
  readonly cwd: string;
}
```

- [ ] **Step 4: Add runtime to tool context**

Modify `packages/agent/src/tools/types.ts`:

```typescript
import type { RuntimePath, ToolRuntime } from './runtime/types';
```

Add to `ToolContext`:

```typescript
runtime?: ToolRuntime;
hasRuntimeFileBeenRead?: (path: RuntimePath) => boolean;
markFileRead?: (path: RuntimePath) => void;
```

Keep `workingDirectory`, `workspaceInfo`, and `hasFileBeenRead` until the final
cleanup task.

- [ ] **Step 5: Pass host runtime from ConversationRunner**

Modify `packages/agent/src/core/conversation/runner.ts` imports:

```typescript
import { HostToolRuntime } from '@lace/agent/tools/runtime/host';
import { buildDefaultLocalRuntimeBinding } from '@lace/agent/tools/runtime/validation';
```

Inside `executeToolByName()`, before `toolExecutor.execute()`, construct a
migration-safe host runtime:

```typescript
const runtimeBinding = buildDefaultLocalRuntimeBinding({
  sessionId: this.config.sessionId,
  cwd,
});
const runtime = new HostToolRuntime({
  id: runtimeBinding.identity.runtimeId,
  cwd,
});
```

Add `runtime` to the `ToolContext` passed to `toolExecutor.execute`.

- [ ] **Step 6: Run host runtime and executor tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/host.test.ts src/tools/executor.test.ts src/core/conversation/__tests__/runner.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/tools/runtime/host.ts packages/agent/src/tools/runtime/__tests__/host.test.ts packages/agent/src/tools/types.ts packages/agent/src/core/conversation/runner.ts
git commit -m "feat: wire host tool runtime into context"
```

---

### Task 6: Workspace Runtime And Canonical File Access Tracking

**Files:**

- Create: `packages/agent/src/tools/runtime/workspace.ts`
- Create: `packages/agent/src/tools/runtime/file-access-tracker.ts`
- Test: `packages/agent/src/tools/runtime/__tests__/workspace.test.ts`
- Test: `packages/agent/src/tools/runtime/__tests__/file-access-tracker.test.ts`

- [ ] **Step 1: Write failing workspace/file-access tests**

Create `packages/agent/src/tools/runtime/__tests__/file-access-tracker.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { FileAccessTracker } from '../file-access-tracker';

describe('FileAccessTracker', () => {
  it('tracks canonical runtime path keys', () => {
    const tracker = new FileAccessTracker();
    const path = {
      original: 'src/a.ts',
      runtimePath: '/runtime/src/a.ts',
      displayPath: 'src/a.ts',
    };

    tracker.markRead(path, 'container:rt_1:/runtime/src/a.ts');

    expect(tracker.hasRead(path, 'container:rt_1:/runtime/src/a.ts')).toBe(
      true
    );
    expect(tracker.hasRead(path, 'container:rt_2:/runtime/src/a.ts')).toBe(
      false
    );
  });
});
```

Create `packages/agent/src/tools/runtime/__tests__/workspace.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { WorkspaceToolRuntime } from '../workspace';

describe('WorkspaceToolRuntime', () => {
  it('maps project absolute paths into workspace root', async () => {
    const runtime = new WorkspaceToolRuntime({
      id: 'rt_ws',
      projectRoot: '/project',
      workspaceRoot: '/tmp/workspace',
      cwd: '/tmp/workspace',
    });

    await expect(
      runtime.paths.resolve('/project/src/app.ts')
    ).resolves.toMatchObject({
      runtimePath: '/tmp/workspace/src/app.ts',
      hostPath: '/tmp/workspace/src/app.ts',
      displayPath: '/project/src/app.ts',
    });
  });

  it('rejects relative paths escaping workspace root', async () => {
    const runtime = new WorkspaceToolRuntime({
      id: 'rt_ws',
      projectRoot: '/project',
      workspaceRoot: '/tmp/workspace',
      cwd: '/tmp/workspace',
    });

    await expect(runtime.paths.resolve('../escape.txt')).rejects.toThrow(
      /outside workspace/i
    );
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/workspace.test.ts src/tools/runtime/__tests__/file-access-tracker.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement file access tracker**

Create `packages/agent/src/tools/runtime/file-access-tracker.ts`:

```typescript
import type { RuntimePath } from './types';

export class FileAccessTracker {
  private readonly readKeys = new Set<string>();

  markRead(_path: RuntimePath, canonicalKey: string): void {
    this.readKeys.add(canonicalKey);
  }

  hasRead(_path: RuntimePath, canonicalKey: string): boolean {
    return this.readKeys.has(canonicalKey);
  }
}
```

- [ ] **Step 4: Implement workspace runtime**

Create `packages/agent/src/tools/runtime/workspace.ts` by reusing
`HostToolRuntime` capabilities with workspace path mapping:

```typescript
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { HostToolRuntime } from './host';
import type { RuntimePath, RuntimePathService } from './types';

class WorkspacePathService implements RuntimePathService {
  constructor(
    private readonly projectRoot: string,
    private readonly workspaceRoot: string,
    private readonly cwd: string,
    private readonly runtimeId: string
  ) {}

  async resolve(inputPath: string): Promise<RuntimePath> {
    if (isAbsolute(inputPath)) {
      const relativeToProject = relative(this.projectRoot, inputPath);
      if (
        relativeToProject.startsWith(`..${sep}`) ||
        isAbsolute(relativeToProject)
      ) {
        throw new Error(
          `Access denied: path is outside workspace project root: ${inputPath}`
        );
      }
      const runtimePath = resolve(this.workspaceRoot, relativeToProject);
      return {
        original: inputPath,
        runtimePath,
        hostPath: runtimePath,
        displayPath: inputPath,
      };
    }

    const runtimePath = resolve(this.cwd, inputPath);
    const relativeToWorkspace = relative(this.workspaceRoot, runtimePath);
    if (
      relativeToWorkspace.startsWith(`..${sep}`) ||
      isAbsolute(relativeToWorkspace)
    ) {
      throw new Error(
        `Access denied: path resolves outside workspace root: ${inputPath}`
      );
    }
    return {
      original: inputPath,
      runtimePath,
      hostPath: runtimePath,
      displayPath: inputPath,
    };
  }

  canonicalKey(path: RuntimePath): string {
    return `workspace:${this.runtimeId}:${resolve(path.runtimePath)}`;
  }
}

export class WorkspaceToolRuntime extends HostToolRuntime {
  override readonly kind = 'workspace' as const;
  override readonly label = 'Workspace';
  override readonly paths: RuntimePathService;

  constructor(input: {
    id: string;
    projectRoot: string;
    workspaceRoot: string;
    cwd: string;
  }) {
    super({ id: input.id, cwd: input.workspaceRoot });
    this.paths = new WorkspacePathService(
      input.projectRoot,
      input.workspaceRoot,
      input.cwd,
      input.id
    );
  }
}
```

- [ ] **Step 5: Run workspace tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/workspace.test.ts src/tools/runtime/__tests__/file-access-tracker.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/tools/runtime/workspace.ts packages/agent/src/tools/runtime/file-access-tracker.ts packages/agent/src/tools/runtime/__tests__/workspace.test.ts packages/agent/src/tools/runtime/__tests__/file-access-tracker.test.ts
git commit -m "feat: add workspace runtime and file access tracker"
```

---

### Task 7: Migrate Read-Only File Tools To Runtime FS

**Files:**

- Create: `packages/agent/src/tools/runtime/__tests__/fake-runtime.ts`
- Modify: `packages/agent/src/tools/implementations/file_read.ts`
- Modify: `packages/agent/src/tools/implementations/file_find.ts`
- Test: `packages/agent/src/tools/file-read.test.ts`
- Test: `packages/agent/src/tools/file-find.test.ts`

- [ ] **Step 1: Add shared fake runtime helper**

Create `packages/agent/src/tools/runtime/__tests__/fake-runtime.ts`:

```typescript
import { PassThrough, Readable } from 'node:stream';
import { vi } from 'vitest';
import type { RuntimePath, ToolRuntime } from '../types';

type FakeRuntimeInput = {
  resolve?: RuntimePath;
  canonicalKey?: string;
  statType?: 'file' | 'directory';
  readText?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  fetchResult?: {
    status: number;
    headers: Record<string, string>;
    body: Uint8Array;
  };
};

function defaultPath(): RuntimePath {
  return {
    original: 'a.txt',
    runtimePath: '/runtime/a.txt',
    displayPath: 'a.txt',
  };
}

function createFakeProcess(input: FakeRuntimeInput) {
  const stdin = new PassThrough();
  const stdout = Readable.from([input.stdout ?? '']);
  const stderr = Readable.from([input.stderr ?? '']);

  return {
    pid: 123,
    stdin,
    stdout,
    stderr,
    kill: vi.fn(() => true),
    completion: Promise.resolve({
      exitCode: input.exitCode ?? 0,
      signal: undefined,
    }),
  };
}

export function createFakeRuntime(input: FakeRuntimeInput = {}): ToolRuntime {
  const resolved = input.resolve ?? defaultPath();
  const runtime: ToolRuntime = {
    id: 'rt_fake',
    kind: 'local',
    cwd: '/runtime',
    label: 'Fake',
    paths: {
      resolve: vi.fn().mockResolvedValue(resolved),
      canonicalKey: vi
        .fn()
        .mockReturnValue(input.canonicalKey ?? resolved.runtimePath),
    },
    fs: {
      stat: vi.fn().mockResolvedValue({
        type: input.statType ?? 'file',
        size: input.readText?.length ?? 5,
        mtime: new Date('2026-05-20T00:00:00.000Z'),
      }),
      readTextFile: vi.fn().mockResolvedValue(input.readText ?? 'hello'),
      writeTextFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
    },
    process: {
      exec: vi.fn().mockResolvedValue({
        exitCode: input.exitCode ?? 0,
        stdout: input.stdout ?? '',
        stderr: input.stderr ?? '',
      }),
      start: vi.fn().mockImplementation(async () => createFakeProcess(input)),
    },
    network: {
      fetch: vi.fn().mockResolvedValue(
        input.fetchResult ?? {
          status: 200,
          headers: {},
          body: new Uint8Array(),
        }
      ),
    },
  };

  return runtime;
}

export function createFakeRuntimeForProcess(
  input: FakeRuntimeInput = {}
): ToolRuntime {
  return createFakeRuntime(input);
}

export function createStreamingFakeRuntime(
  input: FakeRuntimeInput = {}
): ToolRuntime {
  return createFakeRuntime(input);
}
```

- [ ] **Step 2: Add failing fake runtime tests for read-only tools**

Update the import in `packages/agent/src/tools/file-read.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createFakeRuntime } from './runtime/__tests__/fake-runtime';
```

Add to `packages/agent/src/tools/file-read.test.ts`:

```typescript
it('uses context.runtime for file reads', async () => {
  const tool = new FileReadTool();
  const resolved = {
    original: 'a.txt',
    runtimePath: '/runtime/a.txt',
    displayPath: 'a.txt',
  };
  const runtime = createFakeRuntime({
    resolve: resolved,
    canonicalKey: '/runtime/a.txt',
    readText: 'hello',
    statType: 'file',
  });
  const markFileRead = vi.fn();

  const result = await tool.execute(
    { path: 'a.txt' },
    { signal: new AbortController().signal, runtime, markFileRead }
  );

  expect(result.status).toBe('completed');
  expect(runtime.paths.resolve).toHaveBeenCalledWith('a.txt');
  expect(runtime.fs.readTextFile).toHaveBeenCalledWith(resolved);
  expect(markFileRead).toHaveBeenCalledWith(resolved);
});
```

- [ ] **Step 3: Run read tests and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/file-read.test.ts src/tools/file-find.test.ts
```

Expected: FAIL because tools still use host `fs` and `resolveWorkspacePath()`.

- [ ] **Step 4: Update `file_read` to use runtime**

In `packages/agent/src/tools/implementations/file_read.ts`, replace path
resolution and file I/O with:

```typescript
if (!context.runtime) {
  return this.createError(
    'Tool context missing runtime. This is a system error.'
  );
}
const runtimePath = await context.runtime.paths.resolve(args.path);
const content = await context.runtime.fs.readTextFile(runtimePath);
context.markFileRead?.(runtimePath);
```

Use `await context.runtime.fs.stat(runtimePath)` in
`validateFileSizeForWholeRead()` by changing that helper to accept `context` and
`runtimePath`.

- [ ] **Step 5: Update `file_find` to use runtime recursive reads**

In `packages/agent/src/tools/implementations/file_find.ts`, resolve the starting
path with:

```typescript
const rootPath = await context.runtime.paths.resolve(args.path);
```

Replace `fs.readdir` and `fs.stat` calls with `context.runtime.fs.readdir()` and
`context.runtime.fs.stat()`. Use `displayPath` for result text and metadata.

- [ ] **Step 6: Run read-only tool tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/file-read.test.ts src/tools/file-find.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/tools/runtime/__tests__/fake-runtime.ts packages/agent/src/tools/implementations/file_read.ts packages/agent/src/tools/implementations/file_find.ts packages/agent/src/tools/file-read.test.ts packages/agent/src/tools/file-find.test.ts
git commit -m "feat: route read-only file tools through runtime"
```

---

### Task 8: Migrate Write And Edit Tools To Runtime FS

**Files:**

- Modify: `packages/agent/src/tools/implementations/file_write.ts`
- Modify: `packages/agent/src/tools/implementations/file_edit.ts`
- Modify: `packages/agent/src/tools/tool.ts`
- Test: `packages/agent/src/tools/file-write.test.ts`
- Test: `packages/agent/src/tools/implementations/file_edit.test.ts`

- [ ] **Step 1: Add failing canonical read-before-write test**

Add this import to `packages/agent/src/tools/file-write.test.ts`:

```typescript
import { createFakeRuntime } from './runtime/__tests__/fake-runtime';
```

Add to `packages/agent/src/tools/file-write.test.ts`:

```typescript
it('checks read-before-write against runtime canonical path', async () => {
  const tool = new FileWriteTool();
  const resolved = {
    original: 'a.txt',
    runtimePath: '/runtime/a.txt',
    displayPath: 'a.txt',
  };
  const runtime = createFakeRuntime({
    resolve: resolved,
    canonicalKey: 'container:rt_1:/runtime/a.txt',
    statType: 'file',
  });

  const result = await tool.execute(
    { path: 'a.txt', content: 'new' },
    {
      signal: new AbortController().signal,
      runtime,
      hasRuntimeFileBeenRead: () => false,
    }
  );

  expect(result.status).toBe('failed');
  expect(result.content[0].text).toContain("hasn't been read");
});
```

- [ ] **Step 2: Run write/edit tests and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/file-write.test.ts src/tools/implementations/file_edit.test.ts
```

Expected: FAIL because write/edit still use host paths and legacy read tracking.

- [ ] **Step 3: Add runtime read-protection helper**

In `packages/agent/src/tools/tool.ts`, add:

```typescript
protected async checkRuntimeFileReadProtection(
  filePath: string,
  runtimePath: RuntimePath,
  context: ToolContext
): Promise<ToolResult | null> {
  if (!context.runtime) {
    return this.createError('Tool context missing runtime. This is a system error.');
  }
  try {
    await context.runtime.fs.stat(runtimePath);
    if (!context.hasRuntimeFileBeenRead) {
      return this.createError(
        'Tool context missing hasRuntimeFileBeenRead(). This is a system error.'
      );
    }
    if (!context.hasRuntimeFileBeenRead(runtimePath)) {
      return this.createError(
        `File ${filePath} exists but hasn't been read in this conversation. Use file_read to examine the current contents before modifying.`
      );
    }
  } catch {
    return null;
  }
  return null;
}
```

Import `RuntimePath` at the top of `tool.ts`.

- [ ] **Step 4: Update `file_write`**

Replace host path logic with:

```typescript
if (!context.runtime)
  return this.createError(
    'Tool context missing runtime. This is a system error.'
  );
const runtimePath = await context.runtime.paths.resolve(args.path);
const protectionError = await this.checkRuntimeFileReadProtection(
  args.path,
  runtimePath,
  context
);
if (protectionError) return protectionError;
if (createDirs) {
  const parent = await context.runtime.paths.resolve(
    dirname(runtimePath.runtimePath)
  );
  await context.runtime.fs.mkdir(parent, { recursive: true });
}
await context.runtime.fs.writeTextFile(runtimePath, content);
```

Return `runtimePath.displayPath` in user-facing messages and metadata.

- [ ] **Step 5: Update `file_edit`**

Use `context.runtime.paths.resolve()`, `context.runtime.fs.readTextFile()`, and
`context.runtime.fs.writeTextFile()` for all file content. Keep existing diff
formatting but use `runtimePath.displayPath` in display text.

- [ ] **Step 6: Run write/edit tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/file-write.test.ts src/tools/implementations/file_edit.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/tools/tool.ts packages/agent/src/tools/implementations/file_write.ts packages/agent/src/tools/implementations/file_edit.ts packages/agent/src/tools/file-write.test.ts packages/agent/src/tools/implementations/file_edit.test.ts
git commit -m "feat: route file mutations through runtime"
```

---

### Task 9: Runtime Process Execution For Bash And Ripgrep

**Files:**

- Modify: `packages/agent/src/tools/implementations/bash.ts`
- Modify: `packages/agent/src/tools/implementations/ripgrep_search.ts`
- Test: `packages/agent/src/tools/bash.test.ts`
- Test: `packages/agent/src/tools/ripgrep-search.test.ts`

- [ ] **Step 1: Add failing process runtime tests**

Add this import to `packages/agent/src/tools/ripgrep-search.test.ts`:

```typescript
import { createFakeRuntimeForProcess } from './runtime/__tests__/fake-runtime';
```

Add to `packages/agent/src/tools/ripgrep-search.test.ts`:

```typescript
it('runs rg through runtime process in runtime cwd', async () => {
  const tool = new RipgrepSearchTool();
  const runtime = createFakeRuntimeForProcess({
    stdout: '/runtime/a.ts:1:needle\n',
  });

  const result = await tool.execute(
    { pattern: 'needle', path: '.' },
    { signal: new AbortController().signal, runtime }
  );

  expect(result.status).toBe('completed');
  expect(runtime.process.exec).toHaveBeenCalledWith(
    expect.arrayContaining(['rg']),
    expect.objectContaining({ cwd: runtime.cwd })
  );
});
```

Add this import to `packages/agent/src/tools/bash.test.ts`:

```typescript
import { createStreamingFakeRuntime } from './runtime/__tests__/fake-runtime';
```

Add to `packages/agent/src/tools/bash.test.ts`:

```typescript
it('runs sync bash through runtime process', async () => {
  const tool = new BashTool();
  const runtime = createStreamingFakeRuntime({ stdout: 'ok\n', exitCode: 0 });

  const result = await tool.execute(
    { command: 'echo ok' },
    {
      signal: new AbortController().signal,
      runtime,
      toolTempDir: testTempDir,
    }
  );

  expect(result.status).toBe('completed');
  expect(runtime.process.start).toHaveBeenCalledWith(
    ['/bin/bash', '-c', 'echo ok'],
    expect.objectContaining({ cwd: runtime.cwd })
  );
});
```

- [ ] **Step 2: Run process tool tests and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/bash.test.ts src/tools/ripgrep-search.test.ts
```

Expected: FAIL because tools use `spawn`/`execFile` directly.

- [ ] **Step 3: Update `bash` sync execution**

In `packages/agent/src/tools/implementations/bash.ts`, replace
`spawn('/bin/bash', ...)` with:

```typescript
if (!context.runtime) {
  return this.createError(
    'Tool context missing runtime. This is a system error.'
  );
}
const childProcess = await context.runtime.process.start(
  ['/bin/bash', '-c', command],
  {
    cwd: context.runtime.cwd,
    env: context.processEnv ?? process.env,
    signal: context.signal,
  }
);
```

Use `childProcess.stdout`, `childProcess.stderr`, `childProcess.kill()`, and
`childProcess.completion` instead of `ChildProcess` methods.

- [ ] **Step 4: Update `ripgrep_search`**

Build args as today, then call:

```typescript
const { stdout } = await context.runtime.process.exec(['rg', ...ripgrepArgs], {
  cwd: context.runtime.cwd,
  env: context.processEnv ?? process.env,
  signal: context.signal,
});
```

Report missing `rg` as missing in the active runtime:

```typescript
return this.createError(
  `ripgrep (rg) command not found in ${context.runtime.label}. Install ripgrep in the active runtime to use this tool.`
);
```

- [ ] **Step 5: Run process tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/bash.test.ts src/tools/ripgrep-search.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/tools/implementations/bash.ts packages/agent/src/tools/implementations/ripgrep_search.ts packages/agent/src/tools/bash.test.ts packages/agent/src/tools/ripgrep-search.test.ts
git commit -m "feat: run process tools through runtime"
```

---

### Task 10: Background Jobs And Delegates Rehydrate Runtime Bindings

**Files:**

- Modify: `packages/agent/src/core/conversation/runner.ts`
- Modify: `packages/agent/src/server.ts`
- Modify: `packages/agent/src/jobs/job-creation.ts`
- Modify: `packages/agent/src/jobs/job-derivation.ts`
- Modify: `packages/agent/src/jobs/shell-job.ts`
- Modify: `packages/agent/src/jobs/subagent-job.ts`
- Test: `packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`
- Test: `packages/agent/src/__tests__/agent-process.delegate.e2e.test.ts`

- [ ] **Step 1: Add failing durable runtime binding job tests**

Add these imports to
`packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`:

```typescript
import { join } from 'node:path';
import { readDurableEvents } from '../storage/event-log';
```

Add to `packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`:

```typescript
it(
  'persists runtimeBinding on shell job_started events',
  { timeout: 20_000 },
  async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    let jobId: string | undefined;
    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      if (p.type === 'job_started' && typeof p.jobId === 'string') {
        jobId = p.jobId;
      }
      return undefined;
    });
    ctx.agent.peer.onRequest('session/request_permission', async () => {
      return { decision: 'allow' };
    });

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'allow' } })
      ),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', {
        cwd: ctx.workDir,
        mcpServers: [],
      }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'job: echo runtime-binding' }],
      }),
      5_000,
      'session/prompt'
    );

    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (jobId) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      5_000,
      'job_started'
    );

    const sessionDir = join(ctx.laceDir, 'agent-sessions', created.sessionId);
    const { events } = readDurableEvents(sessionDir, {
      afterEventSeq: 0,
      limit: 100,
      types: ['job_started'],
    });
    const jobStarted = events.find((event) => event.data.jobId === jobId);

    expect(jobStarted?.data).toMatchObject({
      runtimeBinding: {
        schemaVersion: 1,
        agentPlacement: 'host',
        toolRuntime: { type: 'local' },
      },
    });
  }
);
```

- [ ] **Step 2: Run async workflow tests and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/__tests__/agent-process.async-workflow.e2e.test.ts
```

Expected: FAIL because `job_started.data.runtimeBinding` is absent.

- [ ] **Step 3: Pass runtime binding into shell job creation**

In `ConversationRunner.executeToolByName()`, when handling `bash` with
`background: true`, include the active binding:

```typescript
runtimeBinding,
```

In `packages/agent/src/server.ts`, add `runtimeBinding` to the
`persistJobStartedEvent` event data:

```typescript
...(event.runtimeBinding ? { runtimeBinding: event.runtimeBinding } : {}),
```

- [ ] **Step 4: Derive runtime binding back into JobState**

In `packages/agent/src/jobs/job-derivation.ts`, when deriving `job_started`,
read:

```typescript
const runtimeBinding = p.runtimeBinding;
```

Add it to derived `JobState` only if it parses through
`parseRuntimeExecutionBinding()`.

- [ ] **Step 5: Update shell job process to use runtime binding**

In `packages/agent/src/jobs/shell-job.ts`, reconstruct a runtime from
`job.runtimeBinding` before spawning. For this task, support only `local`
bindings:

```typescript
if (job.runtimeBinding?.toolRuntime.type !== 'local') {
  throw new Error(
    'Only local runtime shell jobs are supported before projected container runtime lands'
  );
}
const runtime = new HostToolRuntime({
  id: job.runtimeBinding.identity.runtimeId,
  cwd: job.runtimeBinding.toolRuntime.cwd,
});
```

Then call `runtime.process.start(['/bin/bash', '-c', job.command ?? ''], ...)`.

- [ ] **Step 6: Preserve delegate inheritance**

In `packages/agent/src/jobs/subagent-job.ts`, when creating/resuming a host
child delegate, pass `runtimeBinding` through session creation state. When
`personaContainerRuntime` exists, keep `agentPlacement: 'container'` behavior
unchanged.

- [ ] **Step 7: Run focused job tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/__tests__/agent-process.async-workflow.e2e.test.ts src/__tests__/agent-process.delegate.e2e.test.ts src/jobs/__tests__/shell-job.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/core/conversation/runner.ts packages/agent/src/server.ts packages/agent/src/jobs/job-creation.ts packages/agent/src/jobs/job-derivation.ts packages/agent/src/jobs/shell-job.ts packages/agent/src/jobs/subagent-job.ts packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts packages/agent/src/__tests__/agent-process.delegate.e2e.test.ts
git commit -m "feat: persist runtime bindings for async jobs"
```

---

### Task 11: Container Image Resolution And Projected Container Runtime

**Files:**

- Create: `packages/agent/src/tools/runtime/projected-container.ts`
- Create: `packages/agent/src/tools/runtime/container-image-resolver.ts`
- Test:
  `packages/agent/src/tools/runtime/__tests__/container-image-resolver.test.ts`
- Test: `packages/agent/src/tools/runtime/__tests__/projected-container.test.ts`

- [ ] **Step 1: Write failing fake adapter tests**

Create
`packages/agent/src/tools/runtime/__tests__/container-image-resolver.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { resolveContainerImageIdentity } from '../container-image-resolver';

describe('container image resolver', () => {
  it('selects a platform child manifest from an index digest', async () => {
    const adapter = {
      resolveImage: vi.fn().mockResolvedValue({
        kind: 'index',
        manifests: [
          { platform: 'linux/arm64', digest: 'sha256:' + 'a'.repeat(64) },
        ],
      }),
    };

    await expect(
      resolveContainerImageIdentity({
        requestedImage: 'example/app@sha256:' + 'b'.repeat(64),
        imagePlatform: 'linux/arm64',
        adapter,
      })
    ).resolves.toEqual({
      requestedImage: 'example/app@sha256:' + 'b'.repeat(64),
      resolvedImageDigest: 'sha256:' + 'a'.repeat(64),
      imagePlatform: 'linux/arm64',
    });
  });

  it('fails when a mutable local tag has no digest', async () => {
    const adapter = {
      resolveImage: vi.fn().mockResolvedValue({ kind: 'local-tag-only' }),
    };

    await expect(
      resolveContainerImageIdentity({
        requestedImage: 'local/dev:latest',
        imagePlatform: 'linux/arm64',
        adapter,
      })
    ).rejects.toThrow(/immutable digest/i);
  });
});
```

Create `packages/agent/src/tools/runtime/__tests__/projected-container.test.ts`:

```typescript
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { ProjectedContainerToolRuntime } from '../projected-container';

function createFakeContainerManager() {
  return {
    execStream: vi.fn().mockResolvedValue({
      stdin: new PassThrough(),
      stdout: Readable.from(['ok']),
      stderr: Readable.from([]),
      wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
      kill: vi.fn(),
    }),
  };
}

function descriptor() {
  return {
    spec: {
      name: 'projected-runtime',
      containerId: 'container_123',
      requestedImage: 'example/app@sha256:' + 'b'.repeat(64),
      resolvedImageDigest: 'sha256:' + 'a'.repeat(64),
      imagePlatform: 'linux/arm64',
      workingDirectory: '/workspace',
      mounts: [
        {
          hostPath: '/host/repo',
          containerPath: '/workspace',
          readonly: false,
        },
      ],
    },
    cwd: '/workspace',
  };
}

describe('ProjectedContainerToolRuntime', () => {
  it('maps mounted container paths back to host paths', async () => {
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: createFakeContainerManager(),
      descriptor: descriptor(),
    });

    await expect(
      runtime.paths.resolve('/workspace/src/app.ts')
    ).resolves.toEqual({
      original: '/workspace/src/app.ts',
      runtimePath: '/workspace/src/app.ts',
      hostPath: '/host/repo/src/app.ts',
      displayPath: '/workspace/src/app.ts',
    });
  });

  it('starts processes through the container manager', async () => {
    const manager = createFakeContainerManager();
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: descriptor(),
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], {
      cwd: runtime.cwd,
      env: { FOO: 'bar' },
    });

    expect(manager.execStream).toHaveBeenCalledWith(
      'container_123',
      expect.objectContaining({
        command: ['/bin/sh', '-lc', 'echo ok'],
        workingDirectory: '/workspace',
        environment: { FOO: 'bar' },
      })
    );
  });
});
```

- [ ] **Step 2: Run image resolver tests and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/container-image-resolver.test.ts src/tools/runtime/__tests__/projected-container.test.ts
```

Expected: FAIL because resolver and projected container runtime do not exist.

- [ ] **Step 3: Implement resolver contract**

Create `packages/agent/src/tools/runtime/container-image-resolver.ts`:

```typescript
import {
  normalizeImagePlatform,
  validateResolvedImageDigest,
} from './image-identity';

export type ImageResolution =
  | { kind: 'manifest'; digest: string; platform: string }
  | { kind: 'index'; manifests: Array<{ platform: string; digest: string }> }
  | { kind: 'local-tag-only' };

export interface ContainerImageResolutionAdapter {
  resolveImage(input: {
    requestedImage: string;
    imagePlatform: string;
  }): Promise<ImageResolution>;
}

export async function resolveContainerImageIdentity(input: {
  requestedImage: string;
  imagePlatform: string;
  adapter: ContainerImageResolutionAdapter;
}): Promise<{
  requestedImage: string;
  resolvedImageDigest: string;
  imagePlatform: string;
}> {
  const imagePlatform = normalizeImagePlatform(input.imagePlatform);
  const resolution = await input.adapter.resolveImage({
    requestedImage: input.requestedImage,
    imagePlatform,
  });

  if (resolution.kind === 'manifest') {
    if (normalizeImagePlatform(resolution.platform) !== imagePlatform) {
      throw new Error(
        `Image platform mismatch: ${resolution.platform} is not ${imagePlatform}`
      );
    }
    return {
      requestedImage: input.requestedImage,
      resolvedImageDigest: validateResolvedImageDigest(resolution.digest),
      imagePlatform,
    };
  }

  if (resolution.kind === 'index') {
    const match = resolution.manifests.find(
      (manifest) => normalizeImagePlatform(manifest.platform) === imagePlatform
    );
    if (!match)
      throw new Error(`No image manifest found for platform ${imagePlatform}`);
    return {
      requestedImage: input.requestedImage,
      resolvedImageDigest: validateResolvedImageDigest(match.digest),
      imagePlatform,
    };
  }

  throw new Error(
    'Projected container runtime requires an immutable image digest'
  );
}
```

- [ ] **Step 4: Implement projected container runtime fake-backed skeleton**

Create `packages/agent/src/tools/runtime/projected-container.ts` with
`paths.resolve()` mapping declared mounts to `hostPath`, and `process.start()`
delegating to `ContainerManager.execStream()`. Keep helper-backed fs operations
returning explicit "helper not installed" errors until Task 12.

- [ ] **Step 5: Run container runtime tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/container-image-resolver.test.ts src/tools/runtime/__tests__/projected-container.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/tools/runtime/container-image-resolver.ts packages/agent/src/tools/runtime/projected-container.ts packages/agent/src/tools/runtime/__tests__/container-image-resolver.test.ts packages/agent/src/tools/runtime/__tests__/projected-container.test.ts
git commit -m "feat: add projected container runtime identity"
```

---

### Task 12: Runtime Helper And Container-Local Files

**Files:**

- Create: `packages/agent/src/tools/runtime/helper-protocol.ts`
- Modify: `packages/agent/src/tools/runtime/projected-container.ts`
- Test:
  `packages/agent/src/tools/runtime/__tests__/projected-container-helper.test.ts`

- [ ] **Step 1: Write failing helper-backed file test**

Create
`packages/agent/src/tools/runtime/__tests__/projected-container-helper.test.ts`:

```typescript
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { ProjectedContainerToolRuntime } from '../projected-container';

function createFakeContainerManagerWithHelper(input: {
  response: { ok: true; value: unknown } | { ok: false; error: unknown };
}) {
  return {
    execStream: vi.fn().mockResolvedValue({
      stdin: new PassThrough(),
      stdout: Readable.from([`${JSON.stringify(input.response)}\n`]),
      stderr: Readable.from([]),
      wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
      kill: vi.fn(),
    }),
  };
}

function containerDescriptorWithHelper() {
  return {
    spec: {
      name: 'projected-runtime',
      containerId: 'container_123',
      requestedImage: 'example/app@sha256:' + 'b'.repeat(64),
      resolvedImageDigest: 'sha256:' + 'a'.repeat(64),
      imagePlatform: 'linux/arm64',
      workingDirectory: '/workspace',
      mounts: [],
    },
    cwd: '/workspace',
    helper: {
      mode: 'image' as const,
      containerPath: '/usr/local/bin/lace-runtime-helper',
      command: ['/usr/local/bin/lace-runtime-helper'],
    },
  };
}

describe('ProjectedContainerToolRuntime helper', () => {
  it('uses helper for container-local read when no hostPath exists', async () => {
    const manager = createFakeContainerManagerWithHelper({
      response: { ok: true, value: 'container-only' },
    });
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: containerDescriptorWithHelper(),
    });

    const path = await runtime.paths.resolve('/tmp/container-only.txt');
    await expect(runtime.fs.readTextFile(path)).resolves.toBe('container-only');
  });
});
```

- [ ] **Step 2: Run helper tests and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/projected-container-helper.test.ts
```

Expected: FAIL because helper protocol is not implemented.

- [ ] **Step 3: Add helper protocol request types**

Create `packages/agent/src/tools/runtime/helper-protocol.ts`:

```typescript
export type HelperRequest =
  | { op: 'stat'; path: string }
  | { op: 'readTextFile'; path: string }
  | { op: 'writeTextFile'; path: string; content: string }
  | { op: 'mkdir'; path: string; recursive?: boolean }
  | { op: 'readdir'; path: string }
  | {
      op: 'fetch';
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    };

export type HelperResponse =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };

export function encodeHelperRequest(request: HelperRequest): string {
  return `${JSON.stringify(request)}\n`;
}

export function decodeHelperResponse(line: string): HelperResponse {
  const parsed = JSON.parse(line) as HelperResponse;
  if (!parsed.ok && !parsed.error?.message) {
    throw new Error('Invalid helper error response');
  }
  return parsed;
}
```

- [ ] **Step 4: Wire helper-backed fs/network operations**

In `ProjectedContainerToolRuntime`, use `hostPath` fast path when present. When
absent, execute the configured helper command in the container, write one JSON
request, read one JSON response, and fail with
`Projected runtime helper unavailable` if helper config is missing.

- [ ] **Step 5: Run helper tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/projected-container-helper.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/tools/runtime/helper-protocol.ts packages/agent/src/tools/runtime/projected-container.ts packages/agent/src/tools/runtime/__tests__/projected-container-helper.test.ts
git commit -m "feat: add projected runtime helper protocol"
```

---

### Task 13: Runtime Network Fetch

**Files:**

- Modify: `packages/agent/src/tools/implementations/url_fetch.ts`
- Test: `packages/agent/src/tools/url-fetch.test.ts`

- [ ] **Step 1: Add failing runtime network test**

Add this import to `packages/agent/src/tools/url-fetch.test.ts`:

```typescript
import { createFakeRuntime } from './runtime/__tests__/fake-runtime';
```

Add to `packages/agent/src/tools/url-fetch.test.ts`:

```typescript
it('uses runtime network fetch and writes host temp artifact', async () => {
  const tool = new UrlFetchTool();
  const runtime = createFakeRuntime({
    fetchResult: {
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: new TextEncoder().encode('hello'),
    },
  });

  const result = await tool.execute(
    { url: 'http://127.0.0.1:3000' },
    {
      signal: new AbortController().signal,
      runtime,
      toolTempDir: tempDir,
    }
  );

  expect(result.status).toBe('completed');
  expect(runtime.network.fetch).toHaveBeenCalledWith(
    'http://127.0.0.1:3000',
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
});
```

- [ ] **Step 2: Run fetch test and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/url-fetch.test.ts
```

Expected: FAIL because `url_fetch` uses host fetch directly.

- [ ] **Step 3: Update `url_fetch`**

Replace direct fetch with:

```typescript
if (!context.runtime)
  return this.createError(
    'Tool context missing runtime. This is a system error.'
  );
const response = await context.runtime.network.fetch(args.url, {
  method: 'GET',
  signal: context.signal,
});
```

Keep large response output files under `context.toolTempDir`.

- [ ] **Step 4: Run fetch tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/url-fetch.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/tools/implementations/url_fetch.ts packages/agent/src/tools/url-fetch.test.ts
git commit -m "feat: route url fetch through runtime network"
```

---

### Task 14: MCP Schema, Placement Defaults, And Host Behavior Preservation

**Files:**

- Modify: `packages/ent-protocol/src/schemas/shared.ts`
- Modify: `packages/agent/src/config/mcp-types.ts`
- Modify: `packages/agent/src/config/mcp-config-loader.ts`
- Modify: `packages/agent/src/rpc/session-config.ts`
- Test: `packages/agent/src/config/mcp-types.test.ts`
- Test: `packages/agent/src/mcp/server-manager.test.ts`

- [ ] **Step 1: Add failing MCP placement schema tests**

Add to `packages/agent/src/config/mcp-types.test.ts`:

```typescript
it('accepts MCP placement and secretEnv', () => {
  expect(
    McpServerConfigSchema.parse({
      name: 'fs',
      command: 'mcp-fs',
      enabled: true,
      placement: 'toolRuntime',
      secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
    })
  ).toMatchObject({ placement: 'toolRuntime' });
});
```

- [ ] **Step 2: Run MCP schema tests and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/config/mcp-types.test.ts src/mcp/server-manager.test.ts
```

Expected: FAIL because placement/secretEnv are rejected or untyped.

- [ ] **Step 3: Update protocol and agent MCP config types**

Add to `McpServerConfigSchema` in `packages/ent-protocol/src/schemas/shared.ts`:

```typescript
secretEnv: z
  .record(
    z.string(),
    z.object({
      namespace: z.enum(['session', 'project', 'host-service']),
      name: NonEmptyStringSchema,
    }).strict()
  )
  .optional(),
placement: z.enum(['toolRuntime', 'host']).optional(),
```

Mirror the fields in `packages/agent/src/config/mcp-types.ts`.

- [ ] **Step 4: Default placement by config source**

In `packages/agent/src/rpc/session-config.ts`, when merging
session/persona/project MCP servers, default missing placement to `toolRuntime`
except HTTP/SSE, which defaults to `host`.

Use:

```typescript
function defaultMcpPlacement(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    placement:
      server.placement ??
      (server.transport === 'http' || server.transport === 'sse'
        ? 'host'
        : 'toolRuntime'),
  };
}
```

- [ ] **Step 5: Preserve host-placed behavior tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/mcp/server-manager.test.ts src/mcp/server-manager.env-keys.test.ts
```

Expected: PASS; existing host stdio server startup, reconnect, listing, and env
behavior remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/ent-protocol/src/schemas/shared.ts packages/agent/src/config/mcp-types.ts packages/agent/src/config/mcp-config-loader.ts packages/agent/src/rpc/session-config.ts packages/agent/src/config/mcp-types.test.ts packages/agent/src/mcp/server-manager.test.ts
git commit -m "feat: add MCP placement config"
```

---

### Task 15: MCP Reconciliation Keys And Runtime Stdio Transport

**Files:**

- Create: `packages/agent/src/tools/runtime/runtime-stdio-transport.ts`
- Modify: `packages/agent/src/mcp/server-manager.ts`
- Modify: `packages/agent/src/rpc/handlers/mcp-servers.ts`
- Test: `packages/agent/src/mcp/server-manager.test.ts`
- Test: `packages/agent/src/mcp/server-manager.env-keys.test.ts`

- [ ] **Step 1: Add failing reconciliation key tests**

Add this import to `packages/agent/src/mcp/server-manager.test.ts`:

```typescript
import { createFakeRuntime } from '../tools/runtime/__tests__/fake-runtime';
```

Add to `packages/agent/src/mcp/server-manager.test.ts`:

```typescript
it('does not alias host and runtime-placed servers with the same name', async () => {
  const runtime = createFakeRuntime();
  const hostConfig: MCPServerConfig = {
    command: 'node',
    args: ['server.js'],
    enabled: true,
    placement: 'host',
    tools: {},
  };
  const runtimeConfig: MCPServerConfig = {
    command: 'node',
    args: ['server.js'],
    enabled: true,
    placement: 'toolRuntime',
    tools: {},
  };

  await manager.startServer({
    serverId: 'fs',
    config: hostConfig,
    runtime,
    hostCwd: '/repo',
  });
  await manager.startServer({
    serverId: 'fs',
    config: runtimeConfig,
    runtime,
    hostCwd: '/repo',
  });

  expect(
    manager
      .getAllServers()
      .map((server) => server.connectionKey)
      .sort()
  ).toEqual(['fs:host:stdio:/repo', 'fs:toolRuntime:stdio:rt_1:/workspace']);
});
```

- [ ] **Step 2: Run MCP manager tests and verify failure**

Run:

```bash
npm run test --workspace=packages/agent -- src/mcp/server-manager.test.ts
```

Expected: FAIL because connections are keyed only by `serverId`.

- [ ] **Step 3: Add runtime stdio transport**

Create `packages/agent/src/tools/runtime/runtime-stdio-transport.ts`
implementing the MCP SDK `Transport` interface with
`runtime.process.start(command, opts)` streams. Expose constructor:

```typescript
export class RuntimeStdioClientTransport implements Transport {
  constructor(input: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd: string;
    runtime: ToolRuntime;
  }) {}
}
```

Implement `start()`, `send()`, and `close()` using newline-delimited JSON
messages over process stdio.

- [ ] **Step 4: Update MCPServerManager start contract**

Change `startServer()` to accept:

```typescript
{
  config: MCPServerConfig;
  runtime: ToolRuntime;
  hostCwd: string;
  serverId: string;
}
```

Choose transport:

```typescript
const placement = config.placement ?? 'host';
const transport =
  placement === 'toolRuntime'
    ? new RuntimeStdioClientTransport({
        command: config.command,
        args: config.args,
        env,
        cwd: runtime.cwd,
        runtime,
      })
    : new StdioClientTransport({
        command: config.command,
        args: config.args,
        env,
        cwd: hostCwd,
      });
```

Reject HTTP/SSE with `toolRuntime` before starting.

- [ ] **Step 5: Update reconciliation**

In `packages/agent/src/rpc/handlers/mcp-servers.ts`, compute internal connection
keys from server id, placement, transport, runtime id, and effective cwd. Keep
user-facing `serverId` unchanged in UI/status responses.

- [ ] **Step 6: Run MCP tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/mcp/server-manager.test.ts src/mcp/server-manager.env-keys.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/tools/runtime/runtime-stdio-transport.ts packages/agent/src/mcp/server-manager.ts packages/agent/src/rpc/handlers/mcp-servers.ts packages/agent/src/mcp/server-manager.test.ts packages/agent/src/mcp/server-manager.env-keys.test.ts
git commit -m "feat: support runtime-placed stdio MCP"
```

---

### Task 16: Remove Legacy Workspace Path Projection

**Files:**

- Modify: `packages/agent/src/tools/types.ts`
- Modify: `packages/agent/src/tools/tool.ts`
- Modify: `packages/agent/src/tools/__tests__/tool.test.ts`
- Modify: all tests referencing `workspaceInfo`

- [ ] **Step 1: Confirm no production users of legacy helpers remain**

Run:

```bash
rg -n "workspaceInfo|resolveWorkspacePath|hasFileBeenRead\\?: \\(path: string\\)" packages/agent/src -g '*.ts'
```

Expected: only tests and migration comments remain.

- [ ] **Step 2: Delete legacy fields and helper**

Remove from `ToolContext`:

```typescript
workspaceInfo?: {
  sessionId: string;
  projectDir: string;
  clonePath: string;
  containerId: string;
  state: string;
  containerMountPath?: string;
  branchName?: string;
};
hasFileBeenRead?: (path: string) => boolean;
```

Remove `resolvePath()`, `resolveWorkspacePath()`, and legacy
`checkFileReadProtection()` from `packages/agent/src/tools/tool.ts` after all
tools compile without them.

- [ ] **Step 3: Update tests to runtime helpers**

Replace workspace path tests with runtime path tests under
`packages/agent/src/tools/runtime/__tests__/workspace.test.ts`. Remove test
cases that assert `Tool.resolveWorkspacePathPublic()`.

- [ ] **Step 4: Run final verification**

Run:

```bash
npm run typecheck --workspace=packages/agent
npm run test --workspace=packages/agent
npm run typecheck --workspace=packages/ent-protocol
npm run test --workspace=packages/ent-protocol
```

Expected: all commands PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/tools/types.ts packages/agent/src/tools/tool.ts packages/agent/src/tools/__tests__/tool.test.ts packages/agent/src/tools/runtime/__tests__/workspace.test.ts
git commit -m "refactor: remove legacy workspace path projection"
```

---

## Final Verification

- [ ] Run full agent and protocol checks:

```bash
npm run typecheck --workspace=packages/agent
npm run test --workspace=packages/agent
npm run typecheck --workspace=packages/ent-protocol
npm run test --workspace=packages/ent-protocol
```

- [ ] Run monorepo checks if the focused checks pass:

```bash
npm run typecheck
npm test
```

- [ ] Confirm no runtime-sensitive direct host APIs remain in migrated tools:

```bash
rg -n "from 'fs/promises'|from 'child_process'|process\\.cwd\\(|resolveWorkspacePath|workspaceInfo" packages/agent/src/tools packages/agent/src/mcp packages/agent/src/jobs -g '*.ts'
```

Expected: matches only inside runtime implementations, tests, or intentionally
session-local tools.

- [ ] Run formatting:

```bash
npm run format:check
```

- [ ] Run final git status:

```bash
git status --short --branch
```

Expected: only intentional committed changes; unrelated pre-existing files
remain untouched unless explicitly handled.

## Spec Coverage Self-Review

- Runtime binding schema/versioning: Tasks 1-3.
- Durable storage paths: Task 2 and Task 10.
- Secret reauthorization: Task 4 and Task 10.
- Host/workspace/container runtime capability layer: Tasks 5, 6, 11, 12.
- Read-before-write canonical paths: Tasks 6 and 8.
- Built-in tool migration: Tasks 7-9 and Task 13.
- Background jobs and delegates: Task 10.
- MCP placement/defaulting/reconciliation/runtime stdio: Tasks 14-15.
- Container image digest/platform identity: Task 11.
- Legacy cleanup: Task 16.

No implementation code should start until this plan has been reviewed and the
execution mode has been chosen.
