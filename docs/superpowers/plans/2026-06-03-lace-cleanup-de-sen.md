# Lace cleanup (PR-A′ / de-sen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip three pieces of sen-specific / dead machinery out of lace — the `scratch-gc-reminder` helper, the accepted-but-ignored persona `timezone:` field, and the unused `translateToContainer`/`translateToHost` path-translation methods — with zero behavior change to anything kept.

**Architecture:** This is the first, ships-first cleanup PR (PR-A′) of the lace↔sen decoupling. It is pure deletion. There is no new feature, no schema redesign, no box/container coordination required on the lace side. It clears noise so the later structural specs (`lace-plugin-system`, `container-runtime+plane`, `personas-registry`) start from a smaller surface.

**Tech Stack:** TypeScript (strict), vitest, zod. Monorepo package: `packages/agent`. Branch: `pri2012-shim-lace`.

---

## Context the implementing engineer needs

**This is a deletion plan, not a feature.** Classic red-green TDD does not apply: you do not write a new failing test for removed code. The discipline here is inverted —

- The **existing** test suite is the regression guard for everything you keep.
- You delete **only** the tests that exercise the specific behavior being removed.
- After every task: `npm run typecheck` and `npm test` (scoped) must be green, then commit.

**Canonical design refs** (read for "why", do not edit): `sen-core-v2/docs/superpowers/specs/2026-06-03-lace-embedder-architecture.md` Part 1.7 (the de-leak list) and Part 7 #8 (the cleanup kit).

**Scope boundaries — what this plan deliberately does NOT do:**

- **No persona-schema narrowing** beyond removing the one `timezone:` field. Stripping the docker/egress/cap fields from `config/persona-registry.ts` belongs with the `container-runtime+plane` and `personas-registry` specs (#3 / #7), which read those fields in `delegate.ts:180-225`. Touching them here would break the build mid-cleanup.
- **No removal of the mount-tracking subsystem.** Removing `translateTo*` orphans `mountMap` / `registerMounts` / `unregisterMounts` (they become write-only but still compile). Leave them. They are deleted naturally by the `container-runtime+plane` spec (#3) when it deletes `docker-container.ts` / `shim-container-runtime.ts` and rewrites the runtime. Churning those doomed files now is waste.
- **No comment edits for PRI/sen references.** See the "Task 4" note — investigation found these are load-bearing, so there is nothing to strip.

**On-disk persona files (out-of-band, NOT in this plan):** the persona config schema is `.strict()`. After Task 2 removes the `timezone:` field, any live persona `.md` on the box that still carries `timezone:` will fail strict parse and crash-loop the embedder at boot. Per Jesse: "we will take care of the boot loops in prod together. we only have one test instance and no customers." So the prod persona-file strip is handled manually by Jesse + the operator, out of band — **do not** add it to this plan or try to coordinate it.

---

## File map

| File | Change |
|------|--------|
| `packages/agent/src/tools/implementations/scratch-gc-reminder.ts` | **Delete** |
| `packages/agent/src/tools/implementations/delegate.ts` | Remove import + call site |
| `packages/agent/src/tools/implementations/__tests__/delegate.test.ts` | Remove import, `beforeEach` reset, GC-1…GC-4 tests |
| `packages/agent/src/config/persona-registry.ts` | Remove `timezone:` field + its comment block |
| `packages/agent/src/containers/types.ts` | Remove `translateTo*` interface declarations |
| `packages/agent/src/containers/runtime.ts` | Remove `translateTo*` base implementations |
| `packages/agent/src/containers/runtime.test.ts` | Remove `translateTo*` describe blocks + the mount-cleanup test |
| `packages/agent/src/containers/__tests__/docker-container.test.ts` | Swap 2 observation assertions to `inspect()`; remove 1 assertion + the `translateTo*` describe block |
| `packages/agent/src/containers/apple-container.test.ts` | Remove the empty mount test + the `path translation` describe block |

---

## Task 1: Remove the `scratch-gc-reminder` helper

The helper schedules a daily cron reminder telling the agent to `rm -rf /var/sen/instance/work/<id>` via `delegate(persona='shell', ...)`. Both the path and the `persona='shell'` literal are sen-specific. It is a private helper (not a registered tool), called only from `delegate.ts`. The D4 workspace model (a later spec) replaces timer/reminder-driven cleanup with consumer-driven release, so this goes now.

**Files:**
- Delete: `packages/agent/src/tools/implementations/scratch-gc-reminder.ts`
- Modify: `packages/agent/src/tools/implementations/delegate.ts` (import line 24; call site lines 199–202)
- Test: `packages/agent/src/tools/implementations/__tests__/delegate.test.ts` (import line 8; `beforeEach` reset line 31; the GC-1…GC-4 block, currently lines 755–996)

- [ ] **Step 1: Delete the helper file**

```bash
git rm packages/agent/src/tools/implementations/scratch-gc-reminder.ts
```

- [ ] **Step 2: Remove the import from `delegate.ts`**

Delete this line (currently line 24):

```typescript
import { ensureScratchGcReminder } from './scratch-gc-reminder';
```

- [ ] **Step 3: Remove the call site from `delegate.ts`**

Inside `executeValidated`, in the `if (runtime.containerSharing === 'per_invocation')` block, delete this sub-block (currently lines 199–202):

```typescript
            // Schedule GC reminder (best-effort — the helper wraps in try/catch).
            if (context.reminderScheduler && context.activeSessionId) {
              await ensureScratchGcReminder(context.reminderScheduler, context.activeSessionId);
            }
```

Leave the surrounding scratch-**dir** logic (the `scratchDirHostPath` / `fs.mkdirSync` / `buildPerInvocationSpecName` lines) intact — only the reminder scheduling is removed.

- [ ] **Step 4: Remove the test import and `beforeEach` reset in `delegate.test.ts`**

Delete the import (currently line 8):

```typescript
import { _resetEnsuredThisSessionForTest } from '../scratch-gc-reminder';
```

Delete the reset call inside `beforeEach` (currently line 31):

```typescript
    _resetEnsuredThisSessionForTest();
```

Leave `originalLaceWorkDir` / `process.env.LACE_WORK_DIR = scratchBase` and all other `scratchBase`/`scratchDir` usage — those test the per_invocation scratch **dir**, which is kept.

- [ ] **Step 5: Delete the GC-1…GC-4 test block in `delegate.test.ts`**

Delete the four contiguous GC tests and their banner comments — from the `// ----` banner above `it('GC-1: ...')` through the closing `});` of `it('GC-4: ...')` (currently lines 755–996, i.e. the block ending just before `// PRI-1796 Chunk E: reaper cancel wiring` at line 998). All four assert behavior of the removed reminder:
  - GC-1: per_invocation schedules a `<scratch-gc>` reminder
  - GC-2: two per_invocation delegates dedup to exactly one reminder
  - GC-3: scheduler failure does not block delegate
  - GC-4: persistent persona does not schedule a reminder

- [ ] **Step 6: Verify typecheck and tests pass**

Run:
```bash
npm run typecheck
npm test -- delegate
```
Expected: typecheck clean; the `delegate` test file passes with the four GC tests gone and no unresolved import of `scratch-gc-reminder`.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/tools/implementations/delegate.ts \
        packages/agent/src/tools/implementations/__tests__/delegate.test.ts
git commit -m "refactor(lace): remove scratch-gc-reminder (sen-path coupled, dissolved by D4 workspace model)"
```

---

## Task 2: Remove the persona `timezone:` field

`SEN_PERSONA_TIMEZONE` / `EMPLOYEE_TIMEZONE` do not exist anywhere in lace source — they appear only in a historical comment. The only live artifact is the `timezone: z.string().optional()` field in `personaConfigSchema`, accepted-and-ignored. lace owns no timezone concept (operators set `TZ`); the field goes.

**Files:**
- Modify: `packages/agent/src/config/persona-registry.ts` (comment block lines 92–98; field line 120)

- [ ] **Step 1: Remove the explanatory comment block**

Delete this comment (currently lines 92–98), immediately above `const personaConfigSchema = z`:

```typescript
// PRI-1769: tolerate persona frontmatter that carries `timezone:`. PRI-1696
// moved the source of truth for rotation timezone from persona frontmatter to
// env vars (SEN_PERSONA_TIMEZONE / EMPLOYEE_TIMEZONE), but live persona files
// on existing coworker disks may still have the key; strict-rejecting it
// crash-loops the embedder at boot. The field is accepted-and-ignored at the
// lace layer; sen-core reads its env var directly. Other unknown keys still
// fail strict so genuine typos get caught.
```

- [ ] **Step 2: Remove the field from the schema**

Delete this line from `personaConfigSchema` (currently line 120):

```typescript
    timezone: z.string().optional(),
```

- [ ] **Step 3: Verify typecheck and tests pass**

Run:
```bash
npm run typecheck
npm test -- persona-registry
```
Expected: typecheck clean; persona-registry tests pass. If a test fixture asserts that `timezone:` is *accepted*, delete that assertion (the field is now correctly rejected as an unknown key under `.strict()`). Search: `grep -rn "timezone" packages/agent/src/config` and any `__tests__` next to it.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/config/persona-registry.ts
git commit -m "refactor(lace): drop persona timezone field — lace knows no timezones (use TZ)"
```

> NOTE for the human operator (not this engineer): after this lands, strip `timezone:` from any live persona `.md` on the box before/with the deploy, or boot will crash-loop on strict parse. Coordinated manually per Jesse.

---

## Task 3: Remove `translateToContainer` / `translateToHost`

These methods translate paths across container mount boundaries. They have **no production callers** — only tests. They are declared on the `ContainerRuntime` interface and implemented once on `BaseContainerRuntime` (subclasses inherit, none override). Remove the declarations, the implementations, and the tests that exercise them. Where a test used `translateToContainer` purely as a way to *observe* that a container was forgotten after `remove`, swap to `inspect()`, which throws `ContainerNotFoundError` for the same observation.

**Do not** remove `mountMap` / `registerMounts` / `unregisterMounts` — see scope boundaries. They become write-only but still compile.

**Files:**
- Modify: `packages/agent/src/containers/types.ts` (interface decls lines 166–167)
- Modify: `packages/agent/src/containers/runtime.ts` (impls lines 74–113)
- Test: `packages/agent/src/containers/runtime.test.ts`
- Test: `packages/agent/src/containers/__tests__/docker-container.test.ts`
- Test: `packages/agent/src/containers/apple-container.test.ts`

- [ ] **Step 1: Remove the interface declarations in `types.ts`**

Delete these two lines from the `ContainerRuntime` interface (currently lines 166–167):

```typescript
  translateToContainer(hostPath: string, containerId: string): string;
  translateToHost(containerPath: string, containerId: string): string;
```

- [ ] **Step 2: Remove the implementations in `runtime.ts`**

Delete both methods from `BaseContainerRuntime` (currently lines 74–113) — the entire `translateToContainer(...) { ... }` block and the entire `translateToHost(...) { ... }` block. Keep `list()` above them and `updateContainerState` below them.

After deletion, two imports at the top of `runtime.ts` become unused — both are referenced **only** inside the two deleted methods:
- `import { logger } from '@lace/agent/utils/logger';` — used only by the `logger.warn(...)` calls in `translateToContainer`/`translateToHost`.
- `import { join } from 'path';` — used only by the `join(...)` calls in those methods.

Remove **both** import lines. Leaving either in place fails `npm run lint` (no-unused). After removing them, re-grep to confirm no other usage remains:
```bash
grep -n "logger\|join(" packages/agent/src/containers/runtime.ts
```
Expected: no matches (or only matches you are certain are unrelated — there should be none).

- [ ] **Step 3: Fix `runtime.test.ts`**

Delete:
- the `describe('translateToContainer', ...)` block (currently lines 122–173),
- the `describe('translateToHost', ...)` block (currently lines 175–221),
- inside `describe('state management')`, the test `it('should clean up mounts when container is removed', ...)` (currently lines 247–264) — its assertions call `translateToContainer` to observe mount cleanup, which is no longer observable via the public API.

Keep the `MockContainerRuntime` class (it calls `registerMounts`/`unregisterMounts`, which remain) and all other describe blocks.

- [ ] **Step 4: Fix `docker-container.test.ts`**

Three edits:

1. In `it('remove runs \`docker rm -f <id>\` and forgets the container locally', ...)`, replace the observation (currently line 331):

   ```typescript
       expect(() => runtime.translateToContainer('/anything', id)).toThrow(ContainerNotFoundError);
   ```
   with:
   ```typescript
       expect(() => runtime.inspect(id)).toThrow(ContainerNotFoundError);
   ```

2. In `it('remove cleans local state even if docker reports no-such-container', ...)`, replace the observation (currently line 352):

   ```typescript
       expect(() => runtime.translateToContainer('/anything', id)).toThrow(ContainerNotFoundError);
   ```
   with:
   ```typescript
       expect(() => runtime.inspect(id)).toThrow(ContainerNotFoundError);
   ```

3. In the `adopt` test that asserts mount registration (currently lines 1102–1105), delete the comment + assertion:

   ```typescript
      // Mount registration is in place.
      expect(runtime.translateToContainer('/host/work/index.ts', 'sen-box-shell')).toBe(
        '/work/index.ts'
      );
   ```
   Keep the preceding `runtime.inspect('sen-box-shell')` assertions — they remain the meaningful check that adopt registered the container.

4. Delete the entire `describe('translateToContainer / translateToHost', ...)` block (currently lines 1196–1211).

- [ ] **Step 5: Fix `apple-container.test.ts`**

Two edits:

1. Delete the test `it('should register mounts correctly', () => { ... })` (currently lines 79–96). Its only assertion is the `translateToContainer` call at lines 94–95; with that gone the test has nothing left to assert.

2. Delete the entire `describe('path translation', ...)` block (currently lines 145–185).

(These tests are already runtime-skipped on non-darwin, but must still typecheck.)

- [ ] **Step 6: Verify typecheck and the container test suite pass**

Run:
```bash
npm run typecheck
npm test -- containers
```
Expected: typecheck clean (no references to `translateToContainer`/`translateToHost` remain anywhere); all `containers` tests pass.

Sanity grep — must return nothing under `src/`:
```bash
grep -rn "translateToContainer\|translateToHost" packages/agent/src
```

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/containers/types.ts \
        packages/agent/src/containers/runtime.ts \
        packages/agent/src/containers/runtime.test.ts \
        packages/agent/src/containers/__tests__/docker-container.test.ts \
        packages/agent/src/containers/apple-container.test.ts
git commit -m "refactor(lace): remove unused translateToContainer/translateToHost (no production callers)"
```

---

## Task 4 (note — no work): PRI/sen comment "cosmetics"

The kit listed "strip PRI-ticket + sen mentions from comments" as a cleanup target (tracked task #19). Investigation found **nothing to do**:

- The `PRI-####` references are load-bearing links to design decisions / specs / invariants (e.g. PRI-1769, PRI-1796). Removing them loses the "why."
- The `sen-core` mentions are functional embedder-contract notes (e.g. `job-manager.ts`, `variable-provider.ts`, `anthropic-provider.ts`, `apple-container.ts` "sen-core deploys on linux"). They describe the real consumer; they are correct documentation, not cruft.
- There are **no** `sen-docker` / `sen-${}` / `sen.broker` references in `src/` (only in compiled `dist/`).

**Action:** close task #19 as "no-op — refs are load-bearing." If a reviewer disagrees on a specific comment, edit that one comment in isolation; there is no sweep to perform.

---

## Final verification (after all tasks)

- [ ] **Full suite green**

```bash
npm run typecheck
npm run lint
npm test
```
Expected: all clean. No unresolved imports, no unused symbols introduced by the deletions.

- [ ] **Confirm the removed surfaces are gone**

```bash
test -f packages/agent/src/tools/implementations/scratch-gc-reminder.ts && echo "FAIL: helper still present" || echo "OK: helper removed"
grep -rn "ensureScratchGcReminder\|SCRATCH_GC\|scratch-gc-reminder" packages/agent/src && echo "FAIL: refs remain" || echo "OK: no scratch-gc refs"
grep -rn "translateToContainer\|translateToHost" packages/agent/src && echo "FAIL: refs remain" || echo "OK: no translate refs"
grep -n "timezone" packages/agent/src/config/persona-registry.ts && echo "FAIL: timezone remains" || echo "OK: timezone field gone"
```

---

## Self-review notes (for the spec author / reviewer)

- **Spec coverage:** Part 1.7 de-leak items addressed here = `scratch-gc-reminder`, `timezone`, dead `translateTo*`, PRI/sen comment cosmetics (no-op). Remaining 1.7 items (docker impls, `persona-container-spec.ts`, the three field-carriers, the egress observer, schema narrowing) are explicitly deferred to specs #3/#7 — by design, not omission.
- **Mount subsystem left intentionally** (write-only, compiles) — swept by #3. Documented in scope boundaries so a reviewer doesn't read it as a miss.
- **`logger` and `join` imports in `runtime.ts`** are both orphaned by the `translateTo*` deletion (each is used only inside those methods) — Task 3 Step 2 removes both. This is the only secondary-deadness this cleanup introduces. (Caught by roborev review of `b416763`.)
