# Remove Container Agent Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy `agentPlacement: container` path so container personas always run the Lace agent on the host and project tools into containers.

**Architecture:** `runtime.type: container` becomes the only persona-level container mode. Delegate always builds a `RuntimeExecutionBinding` for container personas; subagent process spawning is always native host stdio; container effects are performed by `ProjectedContainerToolRuntime`.

**Tech Stack:** TypeScript, Zod, Vitest, Lace `RuntimeExecutionBinding`, Sen persona templates.

---

### Task 1: Make Lace Tests Describe A Single Projected Container Mode

**Files:**
- Modify: `packages/agent/src/config/__tests__/persona-registry.test.ts`
- Modify: `packages/agent/src/tools/implementations/__tests__/delegate.test.ts`
- Modify: `packages/agent/src/jobs/__tests__/subagent-container-spawn.test.ts`
- Modify: `packages/agent/src/tools/runtime/__tests__/validation.test.ts`
- Modify: `packages/ent-protocol/src/schemas/__tests__/protocol-shapes.test.ts`

- [ ] **Step 1: Write failing tests for removed placement**

Replace the persona-registry test that accepts `agentPlacement: container` with one that rejects any `agentPlacement` key:

```ts
expect(() => registry.parsePersona('legacy-placement')).toThrow(/agentPlacement/);
```

In delegate tests, remove expectations for `personaContainerRuntime` and assert container personas always pass `runtimeBinding.toolRuntime.type === 'container'`.

- [ ] **Step 2: Run focused tests and verify red**

Run:

```bash
npm test --workspace=packages/agent -- src/config/__tests__/persona-registry.test.ts src/tools/implementations/__tests__/delegate.test.ts src/tools/runtime/__tests__/validation.test.ts
```

Expected: failure because production schemas still accept `agentPlacement`, and delegate still has the in-container branch.

### Task 2: Remove Lace Production Support For Container-Placed Agents

**Files:**
- Modify: `packages/agent/src/config/persona-registry.ts`
- Modify: `packages/agent/src/tools/implementations/delegate.ts`
- Modify: `packages/agent/src/jobs/subagent-spawn.ts`
- Modify: `packages/agent/src/jobs/subagent-job.ts`
- Modify: `packages/agent/src/jobs/job-manager.ts`
- Modify: `packages/agent/src/server-types.ts`
- Modify: `packages/agent/src/tools/runtime/types.ts`
- Modify: `packages/agent/src/tools/runtime/validation.ts`
- Modify: `packages/agent/src/tools/runtime/factory.ts`
- Modify: `packages/agent/src/tools/runtime/identity.ts`
- Modify: `packages/ent-protocol/src/schemas/shared.ts`

- [ ] **Step 1: Remove placement from runtime binding types**

Delete `AgentPlacement` and `RuntimeExecutionBinding.agentPlacement`. Runtime binding creation no longer records host placement, and parsing no longer accepts placement.

- [ ] **Step 2: Remove placement from persona runtime schema**

Delete `agentPlacementSchema` and the `agentPlacement` field from `runtimeContainerSchema`. Because the schema is strict, legacy persona files with `agentPlacement` fail loudly.

- [ ] **Step 3: Collapse delegate to the projected path**

Delete `personaContainerRuntime` handling. For every container persona, call `buildPersonaProjectedRuntimeBinding()`, pass the resulting `runtimeBinding` into `createJob`, and keep the existing `containerSharing`, scratch dir, and `containerSpecName` behavior.

- [ ] **Step 4: Delete in-container spawn infrastructure**

Remove `personaContainerRuntime` from job creation/state types and persistence. Remove `spawnContainerSubagent`, `materializeAndExecStream`, `IN_CONTAINER_LACE_ENTRY`, and `ContainerManager`/mount arguments that were only used for in-container agent spawn.

- [ ] **Step 5: Run focused Lace tests and verify green**

Run:

```bash
npm test --workspace=packages/agent -- src/config/__tests__/persona-registry.test.ts src/tools/implementations/__tests__/delegate.test.ts src/jobs/__tests__/subagent-job-projected-runtime.test.ts src/jobs/__tests__/subagent-job-reaper.test.ts src/tools/runtime/__tests__/validation.test.ts src/tools/runtime/__tests__/factory.test.ts
npm test --workspace=packages/ent-protocol
```

Expected: all selected tests pass.

### Task 3: Remove Sen Template Placement Field

**Files:**
- Modify: `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2-worktrees/remove-container-agent-placement/templates/agent-personas/shell.md`
- Modify: `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2-worktrees/remove-container-agent-placement/templates/agent-personas/box-shell.md`
- Modify: `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2-worktrees/remove-container-agent-placement/templates/agent-personas/browser-driver.md`
- Modify: `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2-worktrees/remove-container-agent-placement/tests/fixtures/personas-pre-pri-1664/*.md`
- Modify: `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2-worktrees/remove-container-agent-placement/tests/automated/templates/*.test.ts`
- Modify: `/Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/sen-core-v2-worktrees/remove-container-agent-placement/tests/automated/instance/*.test.ts`

- [ ] **Step 1: Write failing Sen tests**

Update persona schemas in tests to omit `agentPlacement`, and assert `runtime` has no `agentPlacement` property:

```ts
expect(data.runtime).not.toHaveProperty('agentPlacement');
```

- [ ] **Step 2: Remove template fields**

Delete `agentPlacement: host` from every Sen container persona template and fixture.

- [ ] **Step 3: Run focused Sen tests**

Run:

```bash
npm test -- tests/automated/templates/shell-persona.test.ts tests/automated/templates/box-shell-persona.test.ts tests/automated/instance/browser-driver-persona.test.ts tests/automated/instance/persona-rewrite.test.ts
```

Expected: all selected tests pass.

### Task 4: Full Verification And Commits

**Files:**
- Verify both worktrees.

- [ ] **Step 1: Search for removed concepts**

Run in Lace:

```bash
rg -n "agentPlacement|personaContainerRuntime|spawnContainerSubagent|IN_CONTAINER_LACE_ENTRY|lace-in-container" packages docs --glob '!dist'
```

Expected: no production/test references except historical docs that are either removed or explicitly marked obsolete.

Run in Sen:

```bash
rg -n "agentPlacement" templates tests src docs
```

Expected: no active template or test references.

- [ ] **Step 2: Run full verification**

Run in Lace:

```bash
npm run typecheck
npm test
git diff --check
```

Run in Sen:

```bash
npm run typecheck
npm test
git diff --check
```

- [ ] **Step 3: Commit each repo**

Commit Lace first with the runtime removal. Commit Sen second with template/test cleanup.
