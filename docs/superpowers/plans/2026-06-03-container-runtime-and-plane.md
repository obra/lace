# Container Runtime + Plane (#3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`). This plan spans **two repos** (lace TypeScript + sen-core-v2 Rust) and is **box-coordinated** — Part 2 (Rust) + the deploy change are gated on a coordinated `--recreate` (we own the box; not in production).

**Goal:** Finish making the sen-docker shim the single "plane" that owns the container spec, make lace a thin plane-client registered into `api.runtimes`, fix the shim's two live passthrough bugs, give it native exec-attach streaming, and collapse persona definitions to a **single on-disk source: the lace `.md` files** (no generated `.json`).

**Architecture:** lace already passes only `spawn <persona> <parent> <child> <jobId>` and the plane already builds the whole docker create-spec from the persona + mount registry (deny-by-default, ownership-labelled, cap-allowlisted persona-side). This plan removes the now-dead lace-side spec machinery, repoints the plane's persona source to the lace `.md` frontmatter, fixes the two remaining caller-passthrough holes, and adds streaming. The runtime becomes a `runtimes` plugin selected by `LACE_CONTAINER_RUNTIME=plane`.

## Terminology — two things were called "the shim" (Jesse, 2026-06-03)

- **"The shim" that GOES AWAY = the lace-side `ShimContainerRuntime`** (TypeScript, in `lace/packages/agent/src/containers/`). Phase 1.1 deletes it and replaces it with `PlaneRuntime`.
- **"The plane" that STAYS and is EVOLVED = the sen-docker Rust binary** (`sen-core-v2/sen-docker/`, the `docker.sock` holder). It is well-built and kept; Part 2 evolves it. Decision: *"only the lace-side client goes"* — the sen-docker binary stays as the plane.

This doc uses **"plane"** for the Rust binary throughout (it formerly went by "the sen-docker shim").

**Tech Stack:** TypeScript (strict) in `lace/packages/agent`; Rust in `sen-core-v2/sen-docker` (serde, serde_yaml). Branch: lace `pri2012-shim-lace` after the plugin-system plan (#2) lands (this rides `api.runtimes` from its Part E).

---

## ⚠️ Reality correction — the kit overstated this spec

Investigation of the live shim (`sen-core-v2/sen-docker/`, 2773 lines) found several kit "TODO" items are **already done**, so this plan does NOT redo them:

- **"The plane BUILDS the spec from persona+registry (caller passes only persona+identity)"** — already true. `ShimContainerRuntime.create()` sends only `spawn <persona> <parent> <child> <jobId>`; `build_create_argv` (spawn.rs:101-178) sources image/caps/mounts/env/labels/network/user from the persona spec + mount registry. The rich `ContainerSpec` lace builds is **ignored** on the shim path.
- **"cap-allowlist ENFORCED (spawn.rs:158 forwards verbatim today)"** — wrong; caps come **only** from the persona spec (spawn.rs:158-160), never the caller. No fix needed.
- **deny-by-default verbs, ownership-label gating, mount guard, closed persona enum** — all present (dispatch.rs:75-82, ownership.rs, mounts.rs guard_path:112, validate.rs PERSONAS:9).

**What is actually left** (this plan): (1) two real caller-passthrough bugs (exec `-e`, inspect `--format`); (2) native exec-attach **streaming** (exec is buffered `Command::output()` today; execStream has no plane path); (3) **single-source personas** — the shim parses the lace `.md` frontmatter, killing the deploy-time `.json` generation; (4) lace-side cleanup — delete the dead spec-builder, narrow `ContainerRuntime`, delete the netns sidecar + direct-docker, and register a clean plane-client into `api.runtimes`.

## Decisions taken (Jesse, 2026-06-03)

- **Single source = the lace `.md` files. No `.json` on disk.** Kill the deploy-time markdown→`.json` generation; the shim reads the persona `.md` `runtime:` frontmatter directly. The docker/egress/cap fields therefore **stay in the `.md`/lace schema** (the shim needs them) — they are *not* stripped; lace simply stops *using* them to build a spec.
- **exec-env fix: investigate, recommend in-spec.** Done below (Part 2B) — evidence + recommendation, not a blanket strip.

---

## Open coordination items (resolve during implementation; surfaced to Jesse)

1. **Mount-model reconciliation (single-source consequence).** lace's persona schema has `mounts: z.record(name, containerTarget)` (name→target); the shim's `PersonaSpec.mounts: Vec<String>` (names only) + the mount registry supplies `container_path`. With one `.md` parsed by both, the models must agree. **Recommendation:** make the registry the sole source of container paths (the shim's model); change lace's persona `mounts` to a **name list** (`z.array(mountName)`) and have lace resolve the container target from the same registry entry (`containerMounts[name]` gains `containerPath`). This is a small lace schema change + a `MountRegistryEntry` field. Settle before Part 2A's parser lands. (Alternative: keep name→target in the `.md` and have the shim read the target from frontmatter instead of the registry — but that moves container-path authority out of the single audited registry, weakening the mount-escape audit surface. Not recommended.)
2. **exec-env final policy** (Part 2B) — the recommendation below needs a sign-off because it interacts with the credentials spec (#6).
3. **Deploy:** the shim's persona dir config repoints from `/etc/sen-personas` to the lace persona `.md` path; the markdown→json generation step is removed from the deploy pipeline. Box-coordinated `--recreate`.

---

# Part 1 — lace (TypeScript): thin plane-client, delete the dead spec machinery

**Code mapped:** `containers/types.ts` (`ContainerRuntime`, `ContainerConfig`), `containers/spec.ts` (`ContainerSpec` with `sysctls/capAdd/network/gatewayRoute/browserCdpSocket`), `jobs/persona-container-spec.ts` (`buildPersonaContainerSpec` — the dead builder), `containers/shim-container-runtime.ts` (the 4-arg `spawn` wire), `containers/docker-container.ts` (`runNetnsInit:287-350`, `execStream:533`, `exec -e` build at :122), `tools/runtime/projected-container.ts` (`captureContainerImageId:96` direct `docker inspect`), `config/persona-registry.ts` (`runtimeContainerSchema:48-78`), `jobs/delegate.ts:179-216`.

## Phase 1.1 — Make `PlaneRuntime` the registered runtime; retire the docker impls from the live path

The shim path is the only one used on the box. Replace `ShimContainerRuntime extends DockerContainerRuntime` with a purpose-built `PlaneRuntime` that talks the 4-arg `spawn` wire + the new streaming/inspect verbs, and register it into `api.runtimes` (Part E) under `plane`.

**Files:**
- Create: `packages/agent/src/containers/plane-runtime.ts` (`PlaneRuntime implements ContainerRuntime`)
- Modify: `packages/agent/src/containers/manager-factory.ts` (register `plane`; keep `docker`/`apple` for non-box dev)
- Test: `packages/agent/src/containers/plane-runtime.test.ts`

- [ ] **Step 1: Write the failing test** — `create()` emits `spawn <persona> <parent> <child> <jobId>` to the plane binary and records the returned name; `exec` and `inspect` go over the plane (not direct docker). Mock the plane binary via an injected runner (mirror `ShimContainerRuntime`'s `execFileAsync` seam — inject it for the test).

```typescript
// ABOUTME: PlaneRuntime talks the plane wire (spawn/exec-stream/inspect), no direct docker
import { describe, it, expect, vi } from 'vitest';
import { PlaneRuntime } from './plane-runtime';

describe('PlaneRuntime', () => {
  it('create emits the 4-arg spawn verb and returns the daemon name', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'sen-researcher-abc\n', stderr: '', exitCode: 0 });
    const rt = new PlaneRuntime('/usr/local/bin/sen-docker-client', { run });
    const id = await rt.create({ image: 'ignored', workingDirectory: '/w', mounts: [],
      persona: 'ephemeral-shell', parentSession: 'sess_p', childSession: 'sess_c', jobId: 'job_1' } as never);
    expect(run).toHaveBeenCalledWith(['spawn', 'ephemeral-shell', 'sess_p', 'sess_c', 'job_1']);
    expect(id).toBe('sen-researcher-abc');
  });
  it('create rejects when persona selector is missing', async () => {
    const rt = new PlaneRuntime('/bin/x', { run: vi.fn() });
    await expect(rt.create({ image: 'x', workingDirectory: '/w', mounts: [] } as never)).rejects.toThrow(/persona/);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npm test -- plane-runtime`).

- [ ] **Step 3: Implement `PlaneRuntime`** — port `ShimContainerRuntime.create()`'s 4-arg `spawn` logic (it's correct), but as a standalone `implements ContainerRuntime` (not `extends DockerContainerRuntime`), with an injectable `{ run }` for tests. `exec`/`execStream`/`inspect`/`stop`/`remove` go over the plane verbs (exec-stream + inspect-template land in Phase 1.4 wired to Part 2's new verbs; for now `exec` uses the existing buffered plane `exec` verb). Keep the in-process container cache for `inspect`/`list` parity. `start` is a no-op (spawn is atomic). `adopt` re-runs `create` (idempotent spawn), as today.

> Reuse the exact `spawn`-arg assembly + error handling from `shim-container-runtime.ts:25-73`. The only structural change is the base class — `PlaneRuntime` does not inherit docker logic, so it cannot accidentally shell out to docker on the box.

- [ ] **Step 4: Register `plane` in the factory**

In `manager-factory.ts` `registerBuiltinRuntimes()` (added in plugin-system Part E), register `plane` when `LACE_DOCKER_BIN` is set; keep `docker`/`apple` for local dev:

```typescript
  const planeBin = process.env.LACE_DOCKER_BIN?.trim();
  if (planeBin) registries.runtimes.register('plane', new PlaneRuntime(planeBin));
  registries.runtimes.register('docker', makeDockerRuntime());   // dev / non-box
  registries.runtimes.register('apple', new AppleContainerRuntime());
```

The box sets `LACE_CONTAINER_RUNTIME=plane`. (`makeDockerRuntime`'s old shim branch that returned `ShimContainerRuntime` is removed — `plane` is now its own registered runtime.)

- [ ] **Step 5: Run → PASS; commit.**

```bash
git add packages/agent/src/containers/plane-runtime.ts packages/agent/src/containers/plane-runtime.test.ts packages/agent/src/containers/manager-factory.ts
git commit -m "feat(lace/containers): PlaneRuntime as a registered runtime (no docker inheritance)"
```

## Phase 1.2 — Delete the dead spec-builder + the netns sidecar + direct-docker

These only fed the docker path or the ignored `ContainerSpec`; the shim builds the real spec.

**Files:**
- Delete: `packages/agent/src/jobs/persona-container-spec.ts`'s docker-field emission — specifically `buildPersonaContainerSpec` (the whole function) and `withBrowserCdpSocketEnv`; **keep** `buildPerInvocationSpecName` (delegate uses it for the scratch path) and `resolvePersonaMountsAndEnv` only if still needed for the projected tool-runtime (see note).
- Modify: `containers/docker-container.ts` — delete `runNetnsInit` (:287-350) and its caller in `start`/`adopt`; the netns wiring is the shim's.
- Modify: `tools/runtime/projected-container.ts` — replace `captureContainerImageId`'s direct `docker inspect` (:96) with a plane `inspect` call (or drop the audit log entirely — it is best-effort).
- Modify: `jobs/delegate.ts:179-216` — stop reading `runtime.sysctls/capAdd/network/gatewayRoute/browserCdpSocket` (they were passed into the dead builder); keep reading `containerSharing` + the scratch-dir mkdir + `buildPerInvocationSpecName`.

- [ ] **Step 1: Confirm the projected tool-runtime's real needs.** The subagent's tool runtime (`ProjectedContainerToolRuntime`) needs `mounts` (host↔container path services) + `image` + `workingDirectory` for path/fs/exec — NOT caps/network/sysctls/gatewayRoute/browserCdp. Verify what `buildPersonaProjectedRuntimeBinding` actually consumes; keep only that. (grep `runtime\.\(sysctls\|capAdd\|network\|gatewayRoute\|browserCdpSocket\)` across `jobs/` and `tools/runtime/` — every hit is dead and removed.)

- [ ] **Step 2: Delete `buildPersonaContainerSpec` + `withBrowserCdpSocketEnv`** and any now-unused `ContainerSpec` docker fields they set. Run typecheck to find the now-broken references (the projected binding builder); rewire it to the narrowed shape.

- [ ] **Step 3: Delete `runNetnsInit`** and its call sites in `docker-container.ts`. Remove the `gatewayRoute`-triggered sidecar tests (`docker-container.test.ts` "runs netns-init sidecar..." ~1114-1193 — these test deleted behavior).

- [ ] **Step 4: Replace `captureContainerImageId`'s direct docker** with `planeRuntime.inspect(id)` (image id from the plane's templated inspect, Part 2C) or remove the best-effort audit log. Do not leave a `spawn('docker', ...)` in lace — the box has no docker access.

- [ ] **Step 5: Trim `delegate.ts`** to stop reading the dead runtime fields. Keep `containerSharing`, scratch mkdir, `buildPerInvocationSpecName`.

- [ ] **Step 6: typecheck + tests + commit.**

```bash
npm run typecheck && npm test -- "containers|delegate|projected"
git add -A packages/agent/src
git commit -m "refactor(lace/containers): delete dead spec-builder, netns sidecar, direct-docker (shim owns them)"
```

## Phase 1.3 — Narrow `ContainerRuntime` + the carrier types to the plane path

**Files:** `containers/types.ts`, `containers/spec.ts`

- [ ] **Step 1:** Narrow `ContainerRuntime` to the methods the plane path uses: `create`/`start`/`stop`/`remove`/`exec`/`execStream`/`inspect`/`list`/`adopt`/`daemonInspect`. Remove `inspectNetworkIp?` (it backed the lace-side egress source-IP bridge being deleted in D3/#4) — confirm no remaining caller before removing.
- [ ] **Step 2:** On `ContainerConfig`/`ContainerSpec`, **keep** the selector fields (`persona/parentSession/childSession/jobId`), `image`, `workingDirectory`, `mounts`, `env`; remove the now-unused docker carriers (`sysctls/capAdd/network/gatewayRoute/browserCdpSocket/restartPolicy/ports`) **from the lace carrier types** — they live in the persona `.md` the shim reads, not in a lace runtime call. (Schema fields in `persona-registry.ts` STAY per the single-source decision — only the *carrier types lace passes to a runtime* are narrowed.)
- [ ] **Step 3:** Remove the orphaned `mountMap`/`registerMounts`/`unregisterMounts` (left dead by the cleanup PR-A′) now that the runtime is rebuilt — if `PlaneRuntime` doesn't use them, delete them from `BaseContainerRuntime`/wherever they remain.
- [ ] **Step 4:** typecheck + tests + commit.

```bash
git commit -am "refactor(lace/containers): narrow ContainerRuntime + carriers to the plane path"
```

## Phase 1.4 — Route `execStream` + `inspect` over the plane (pairs with Part 2D/2C)

- [ ] **Step 1:** Implement `PlaneRuntime.execStream` against Part 2D's new streaming verb (attach to the plane process's stdio; return the `ExecStreamHandle` stdin/stdout/stderr + `wait()`/`kill()`). Test with a fake plane process (a script that echoes stdin).
- [ ] **Step 2:** Implement `PlaneRuntime.inspect`/`daemonInspect` against Part 2C's templated inspect verb (no caller `--format`). Map to `ContainerInfo`.
- [ ] **Step 3:** Delete the now-unreachable `DockerContainerRuntime.execStream` (`docker-container.ts:533`) if `docker` runtime is dev-only and you choose to drop streaming there; otherwise leave it for the `docker` dev runtime. (Decide: keep `docker` runtime functional for local dev, or mark dev-only. Recommend keep — it's harmless and useful off-box.)
- [ ] **Step 4:** tests + commit.

---

# Part 2 — sen-docker (Rust): single-source personas, fix the two bugs, add streaming

**Location:** `/home/jesse/git/prime-radiant/sen2/sen-core-v2/sen-docker/` (Cargo crate). Target: ~2773 → ~800-1000 lines is **not** a goal of this plan — the shim is already close to its right shape; we change four things, not rewrite it. (The "2900→800" figure in old notes referred to an abandoned broker, not this shim.)

## Phase 2A — Persona source: parse the lace `.md` frontmatter (kill the `.json`)

**Files:** `sen-docker/src/persona.rs`, `src/config.rs` (persona dir path), `Cargo.toml` (add `serde_yaml`)

`PersonaSpec` (persona.rs:30-66) stays — same fields. Only the **source** changes: from `PersonaSpec::from_json(/etc/sen-personas/<p>.json)` to parsing the lace persona `.md`'s `runtime:` frontmatter block.

- [ ] **Step 1:** Add `serde_yaml` to `Cargo.toml`.
- [ ] **Step 2:** Add `PersonaSpec::from_markdown(md: &str) -> Result<PersonaSpec>`: split YAML frontmatter (between leading `---` fences), `serde_yaml::from_str` the document, extract the `runtime:` mapping, require `type: container`, deserialize into `PersonaSpec`. Write tests against a fixture `.md` with a `runtime:` block (mirror an existing lace persona `.md`).
- [ ] **Step 3:** Repoint the persona dir (`config.rs`) from `/etc/sen-personas` to the lace persona `.md` path (a startup env, e.g. `SEN_PERSONA_MD_DIR`, trusted startup input). Resolve `<persona>.md` (+ user-persona override dir if the box uses one — match lace's bundled+user precedence if both are mounted; otherwise the single bundled dir).
- [ ] **Step 4:** Reconcile the mount model per Open Item #1 — the recommended path: persona `.md` `runtime.mounts` is a **name list**; container paths come from the mount registry. If lace's `.md` currently uses `mounts: {name: target}`, this requires the lace schema change in Open Item #1 to land first (a name list), so both parsers agree. Until then, `from_markdown` reads the mount **keys** (names) and ignores targets — document this as the interim.
- [ ] **Step 5:** Delete `PersonaSpec::from_json` + the `/etc/sen-personas` reading. Remove the markdown→json generation from the deploy pipeline (sen-deploy / image build — a separate edit, coordinated).
- [ ] **Step 6:** `cargo test` + commit.

> The `deny_unknown_fields` on `PersonaSpec` means the `.md` `runtime:` block must contain exactly the fields the shim knows. lace's `runtimeContainerSchema` is the canonical field set; keep the two in sync (the `.md` is validated by lace's zod at lace boot AND by the shim's serde — divergence fails loudly at one end). Add a doc comment in both `runtimeContainerSchema` and `PersonaSpec` pointing at each other.

## Phase 2B — Fix exec `-e` passthrough (dispatch.rs:266-271)

**Audit (done):** lace sends exec env via `ExecOptions.environment` → `docker exec -e K=V` (`docker-container.ts:122-123`); `environmentMode: 'inherit'|'replace'`. Callers pass env for tool execution — including secrets resolved by the runtime secret resolver (`ProjectedContainerProcessRunner`) and tool env overlays (`runtime.process.exec` in ripgrep/bounded-host). So a **blanket strip breaks secret + tool-env delivery to exec'd tools.**

**Recommendation (for sign-off):** deny-by-default with a **key-policy**, not a blanket strip:
- The shim rejects exec env keys that can subvert the process (`LD_PRELOAD`, `LD_LIBRARY_PATH`, `PATH`, `BASH_ENV`, `IFS`, `*PROXY*` — a small hardcoded denylist of execution-hijacking keys), and passes the rest.
- **Secrets should not ride exec `-e` at all** — they move to the credential socket (#6). Once #6 lands, exec env shrinks to non-sensitive tool env, and the key-policy is the residual guard. Note this dependency.
- This preserves today's tool-env behavior while closing the "caller injects `LD_PRELOAD`" hijack, and composes with #6.

- [ ] **Step 1:** Replace the verbatim `opts.push(val.clone())` for `-e` (dispatch.rs:271) with a `validate_exec_env_key(key)` check against the denylist; reject (`deny(...)`) on a denylisted key, pass otherwise. Keep `-i`/`-w` handling.
- [ ] **Step 2:** Tests: a denylisted key → `deny`; a normal key → forwarded. `cargo test`.
- [ ] **Step 3:** Commit. (Flag in the PR that the long-term shrink depends on #6 moving secrets off exec env.)

## Phase 2C — Fix inspect `--format` passthrough (dispatch.rs:425-430)

- [ ] **Step 1:** Replace the verbatim `--format` forward with a **closed set of templated inspect queries** the plane supports (e.g. `state` → `{{.State.Status}}`, `image` → `{{.Image}}`, `json` → a fixed safe projection). The caller names a query key, never a raw format string. Map lace's `inspect`/`daemonInspect` needs (state, image id) to these keys.
- [ ] **Step 2:** Reject any caller `--format`. Tests: known key → templated; raw format → `deny`. `cargo test`.
- [ ] **Step 3:** Commit.

## Phase 2D — Native exec-attach streaming (replace buffered `Command::output`)

Today `RealDocker::run` uses `Command::output()` (docker.rs:41) — collects all stdout into memory, no streaming. lace's `execStream` has no plane path. Add a streaming exec verb.

- [ ] **Step 1:** Add an `exec-stream` plane verb (or extend `exec` with an attach mode) that runs `docker exec -i <id> <cmd...>` with **inherited/piped stdio** (`Command::spawn` + attach), streaming stdin→child and child stdout/stderr→the plane's stdout/stderr, returning the real exit code. Keep the same ownership gate + exec-env key-policy (2B) as buffered exec.
- [ ] **Step 2:** Decide the wire: the plane is invoked per-call by lace (`execFileAsync`/`spawn`). For streaming, lace `spawn`s the plane client and attaches to its stdio (the spike validated execStream-over-plane-socket, ~6ms/hop). Implement the plane side to pass-through stdio to `docker exec`. `PlaneRuntime.execStream` (Part 1.4) attaches to this.
- [ ] **Step 3:** Tests (Rust): a streaming exec echoes stdin to stdout and returns the child exit code. Integration: lace `PlaneRuntime.execStream` round-trips. `cargo test` + the lace test from Part 1.4.
- [ ] **Step 4:** Commit.

---

## Self-review

- **Spec coverage (Part 7 #3):** `ContainerRuntime` narrowed + impl as a `runtimes` plugin ✓ (Part 1.1/1.3, rides plugin-system Part E); plane = evolved shim ✓ (Part 2); deny-by-default / plane-builds-spec / ownership / mount-guard / cap-allowlist — **already present** (reality correction, not re-done); exec-env strip ✓ (2B, as a key-policy with evidence per Jesse); inspect-format templated ✓ (2C); native exec-attach ✓ (2D); delete docker-container.ts netns + direct-docker ✓ (1.2); boot→initialize via the registry ✓ (Part E). **Single-source personas** (Jesse) ✓ (2A) — exceeds the kit, which assumed a generated `.json`.
- **Two-repo + box-coordinated:** Part 1 (lace) is mergeable independently for the `docker`/dev path; Part 2 (Rust) + the deploy repoint + `LACE_CONTAINER_RUNTIME=plane` land together under `--recreate`.
- **Open items flagged, not hidden:** mount-model reconciliation (#1, settle before 2A); exec-env policy sign-off (#2); deploy repoint + kill json-gen (#3).
- **Dependencies:** rides plugin-system Part E (`api.runtimes`). Pairs with #4 (D3 egress — `inspectNetworkIp`/source-IP bridge removal) and #6 (credentials — exec-env secret migration off `-e`). Does not block on them but is cleaner after.

## Open items carried forward

- D3 egress (#4): the shim already wires netns at spawn; #4 covers the per-agent point-to-point topology + IPAM + removing lace's source-IP bridge.
- Credentials (#6): move secrets off exec `-e` onto the credential socket (shrinks 2B's surface); CDP injection via plane `docker exec` into the browser.
- `docker`/`apple` dev runtimes: kept functional off-box; if they bitrot, mark dev-only explicitly rather than silently.
