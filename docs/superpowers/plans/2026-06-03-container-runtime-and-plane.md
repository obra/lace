# Container Runtime + Plane (#3) Implementation Plan — rev 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`). This plan spans **two repos** (lace TypeScript + sen-core-v2 Rust) and is **box-coordinated** — Part 2 (Rust) + the deploy change land together under a coordinated `--recreate` (we own the box; not in production).

> **rev 3 (2026-06-03):** second 3-opus re-review. Decision (Jesse): **ship 2A now with a documented interim root-compromise window** (not in production, Ada-only), with the persona-`.md` lockdown AND plane-side persona-field validation as **hard pre-prod gates**. Changes from rev 2: 2E widened from cap-only to a full **persona-field validation** prod-gate (network/sysctls/image/user/command, not just caps — a tampered `.md` grants root via `user:0:0`/`network:host`/chosen image, which cap-allowlist alone does not bound); **Part 2D fully concretized** (thread model, frame→relay transition, EOF/exit/partial-chunk semantics, a shared wire-contract subsection, anti-forgery invariants, size caps, testable `Docker` abstraction); dev projected personas declared **plane-only**; 2B allowlist criterion = "inert OR plane-pinned value"; the embedder `MountRegistryEntry.containerPath` change promoted to an owned prerequisite phase; minors (both `runNetnsInit` sites, ports-u16 step, `resolvePersonaMountsAndEnv`→`containerPath` step, 2C closed leaves, YAML-anchor hardening).

> **rev 2 (2026-06-03):** rewritten after a roborev (codex/architecture) + 3-opus panel re-review. Changes from rev 1: corrected a FALSE "cap-allowlist already enforced" claim (it is NOT — now Part 2E); redesigned streaming (Part 2D) against the real one-shot wire; switched exec-env from denylist→**allowlist**; split `PlaneSpawnRequest` vs `DockerCreateConfig` so dev runtimes survive; made `buildPersonaContainerSpec`'s deletion a *split* (keep the live mount/env resolver); fixed the stale `jobs/delegate.ts` path; hard-gated Part 1 on the plugin-system `api.runtimes`; made the mount-model a hard precondition; sequenced `inspectNetworkIp` removal with #4; tightened the inspect closed-set; recorded the persona-`.md`-lockdown production prerequisite.

**Goal:** Make the sen-docker **plane** the single authority for the container spec, make lace a thin plane-client registered into `api.runtimes`, fix the plane's two caller-passthrough bugs, add a real exec-attach **streaming** path, enforce a cap-allowlist, and collapse persona definitions to a single on-disk source: the lace `.md` files.

**Architecture:** lace already passes only `spawn <persona> <parent> <child> <jobId>`; the plane already builds the whole `docker create` argv from the persona + mount registry (deny-by-default verbs, ownership labels, mount guard). This plan removes the dead lace-side spec machinery, repoints the plane's persona source to the lace `.md` frontmatter, **adds the missing cap-allowlist**, fixes the two passthrough holes, and adds streaming. The runtime becomes a `runtimes` plugin selected by `LACE_CONTAINER_RUNTIME=plane`.

**Tech Stack:** TypeScript (strict) in `lace/packages/agent`; Rust in `sen-core-v2/sen-docker` (serde, serde_yaml). 

> **HARD DEPENDENCY:** Part 1 imports `api.runtimes` / `registerBuiltinRuntimes` from the **plugin-system plan (#2) Part E**, which must land first. There is no `runtimes` registry in the tree today, and `LACE_CONTAINER_RUNTIME=plane` *throws* against the current `manager-factory.ts` enum. Do not start Part 1 before #2 Part E. (rev-1 wrongly claimed Part 1 was independently mergeable.)

## Terminology — two things were called "the shim" (Jesse, 2026-06-03)

- **"The shim" that GOES AWAY = the lace-side `ShimContainerRuntime`** (TypeScript). Phase 1.1 deletes it → `PlaneRuntime`.
- **"The plane" that STAYS and is EVOLVED = the sen-docker Rust binary** (`sen-core-v2/sen-docker/`, the `docker.sock` holder). Decision: *"only the lace-side client goes."* This doc says **"plane"** for the Rust binary.

---

## Reality correction — what the kit/rev-1 got wrong, verified against the code

Investigation of the live plane (`sen-core-v2/sen-docker/`) found:

- **Already done (do NOT redo):** the plane builds the full `docker create` argv from the persona + mount registry (`spawn.rs:101-178`); deny-by-default verb dispatch (`dispatch.rs:75-82`); ownership-label gating (`ownership.rs`); mount guard (`mounts.rs:112`); closed persona enum (`validate.rs:9`). lace passes only 4 args; the rich `ContainerSpec` is ignored on the spawn path.
- **NOT done — rev-1 was WRONG to claim "cap-allowlist enforced":** `spawn.rs:158-160` forwards persona `cap_add` **verbatim** with no allowlist. The caller can't inject caps (true), but the *persona file* can name any cap, and under single-source personas the persona file is the cap source. The security floor (`2026-06-03-lace-embedder-architecture.md:246`) requires "caps allowlisted (only NET_ADMIN) **even from a persona file**." This is **net-new work → Part 2E.**
- **Still real bugs:** exec `-e` passthrough (`dispatch.rs:266-272`) and inspect `--format` passthrough (`dispatch.rs:425-432`).
- **Streaming does not exist and the wire can't do it as-is:** the plane is one request frame → one buffered, length-prefixed response (≤16 MiB) → close (`server.rs`, `frame.rs`); `Docker::run` is `Command::output()` with **no stdin** (`docker.rs:41`). So `execStream` (and even the projected helper's stdin round-trip) need a new streaming sub-protocol → **Part 2D**.

## Decisions (Jesse, 2026-06-03)

- **Single source = the lace `.md` files. No `.json`.** The plane parses the persona `.md` `runtime:` frontmatter directly; kill the deploy-time `.md`→`.json` generation. The docker/cap fields therefore **stay in the `.md`/lace schema** (the plane reads them); lace stops *using* them to build a spec.
- **Persona-`.md` write-protection is a deferred hardening, tracked as a PROD prerequisite.** Reading the `.md` live is safe **only** once the persona `.md` dir is made agent-unwritable. Jesse: *"we will make agents unable to write those .md files later."* Until that lands, the plane trusting the `.md` is an escalation path (a prompt-injected agent that can write a persona `.md` grants itself caps/mounts/image). **Part 2E's cap-allowlist is the defense-in-depth that bounds the damage even with a tampered `.md`.** See "Production prerequisites."
- **exec-env: allowlist, not denylist** (Part 2B) — a denylist of execution-hijacking env keys is unwinnable (NODE_OPTIONS, GIT_SSH_COMMAND, PYTHON*, LD_AUDIT, HOME, TMPDIR, …). Allowlist the small known set; secrets move to the credential socket in #6.

## ⚠️ Interim security window (accepted; Jesse, 2026-06-03) + hard pre-prod gates

**Blunt statement of the accepted risk:** once Part 2A points the plane at the live, **agent-writable** persona `.md` dir, a prompt-injected lace agent can rewrite a persona `.md` and obtain **root on the host** on the next `spawn` — via `user: "0:0"`, `network: host`, a chosen `image`/`command` (which also runs as root+NET_ADMIN in the netns sidecar), or `sysctls`. The cap-allowlist (2E base) does **not** close this — it locks one of several doors. This window is **accepted as temporary debt** solely because: not in production, Ada is the only runner, we own the box. It is a **root-compromisable-by-any-prompt-injection** state and must be closed before any prod / multi-tenant / adversarial-agent use.

**Hard pre-prod gates (both required before this leaves the Ada-only box):**
1. **Persona `.md` dir made agent-unwritable.** The plane must read personas from a path the agent (uid 1000 / prompt-injected lace) cannot write — operator-owned (root:0444) or image-baked — and ignore any agent-writable user-override dir. (Today's `/etc/sen-personas/*.json` is already such a surface; 2A is what introduces the writable source, so this gate restores the property.)
2. **Plane-side persona-field validation (Part 2E, widened).** Even with the lockdown, defense-in-depth: the plane validates every spec-bearing persona field against closed allowlists — `cap_add ⊆ {NET_ADMIN}`, `network ∈ {quarantine + the #4 per-agent nets}` (reject `host`/`none`/`container:*`), `sysctls` keys ⊆ a closed set, `user` pinned non-root (reject uid 0), `image ⊆` a registry-prefix allowlist (mirror the closed persona-enum discipline) — enforced in `PersonaSpec::validate()` so it binds every load path.

**Lands now (with this plan, not deferred):** the `cap_add ⊆ {NET_ADMIN}` base of 2E (cheap; a floor item). The rest of the field-validation + the lockdown are the two pre-prod gates above.

## Open coordination items (resolve before the dependent phase)

1. **Mount-model reconciliation — HARD precondition for Part 2A.** lace persona `mounts: record(name→target)`; plane `PersonaSpec.mounts: Vec<String>` (names) + registry-owned `container_path`. One `.md` parsed by both forces agreement. **Decision: the registry is the sole source of container paths.** Change lace's persona `mounts` to a **name list** (`z.array(mountName)`) and add `containerPath` to `MountRegistryEntry`; lace resolves the target from the registry, exactly as the plane does. `serde_yaml` cannot deserialize a YAML mapping into `Vec<String>`, so 2A literally cannot parse today's `.md` until this lands.
   > **Owner/sequencing:** `MountRegistryEntry` is the **embedder-supplied contract** (`server-types.ts`, populated by sen-core at `initialize`) — adding `containerPath` is a **third-party (sen-core embedder) change**, not pure-lace. It is a prerequisite PHASE with a sen-core owner that must land before 2A, not a "settle inline" item. Sequence: (a) sen-core adds `containerPath` to the registry it supplies + the `.md` mounts become a name list; (b) lace `resolvePersonaMountsAndEnv` reads `entry.containerPath`; (c) then 2A's plane parser can consume the `.md`.
2. **Plugin-system #2 Part E** (`api.runtimes`) — hard dependency for all of Part 1.
3. **Deploy:** plane's persona dir repoints to the (write-protected, prereq #1) lace `.md` path; remove the `.md`→`.json` generation step. Box-coordinated `--recreate`.

---

# Part 1 — lace (TypeScript): thin plane-client, split the carriers, delete dead machinery

**Code mapped (rev-2 corrected paths):** `containers/types.ts` (`ContainerRuntime`, `ContainerConfig`), `containers/spec.ts` (`ContainerSpec`), `jobs/persona-container-spec.ts` (`buildPersonaContainerSpec` + `resolvePersonaMountsAndEnv` + `buildPerInvocationSpecName`), `jobs/persona-projected-binding.ts` (`buildPersonaProjectedRuntimeBinding` → calls the builder), `containers/shim-container-runtime.ts` (the 4-arg `spawn` wire), `containers/docker-container.ts` (`runNetnsInit:287-350`, `execStream:533`, exec `-e` build :122), `tools/runtime/projected-container.ts` (`ProjectedContainerToolRuntime`; `captureContainerImageId:90` direct `docker inspect`, called fire-and-forget from :713), `config/persona-registry.ts` (`runtimeContainerSchema:48-78`), **`tools/implementations/delegate.ts:179-216`** (rev-1 wrongly said `jobs/delegate.ts`).

## Phase 1.1 — `PlaneRuntime` (composition, not subclass); split the request types; register `plane`

`ShimContainerRuntime extends DockerContainerRuntime` is an inheritance leak (box code can fall back to docker CLI). Replace with a standalone `PlaneRuntime` that talks the plane wire. Split the carrier so a plane spawn does not pretend to carry docker-create fields (codex/opus both flagged the ambiguous shared carrier).

**Files:**
- Create: `containers/plane-runtime.ts` (`PlaneRuntime implements ContainerRuntime`)
- Modify: `containers/types.ts` — introduce `PlaneSpawnRequest` (selector-only) distinct from `DockerCreateConfig` (dev runtimes' fields)
- Modify: `containers/manager-factory.ts` — register `plane` (when `LACE_DOCKER_BIN` set) alongside `docker`/`apple` dev runtimes
- Test: `containers/plane-runtime.test.ts`

- [ ] **Step 1: Split the request types** in `containers/types.ts`:

```typescript
/** What the plane needs to create a container: only the persona + identity. */
export interface PlaneSpawnRequest {
  persona: string;
  parentSession: string;
  childSession?: string;
  jobId: string;
}

/** What the dev docker/apple runtimes need (image, mounts, docker fields). Unchanged
 *  from today's ContainerConfig MINUS the plane selector fields. Kept so local dev
 *  runtimes keep working — NOT narrowed away (codex: don't collapse plane + dev). */
export interface DockerCreateConfig {
  image: string; workingDirectory: string; mounts: ContainerMount[];
  command?: string[]; environment?: Record<string, string>;
  sysctls?: Record<string, string>; capAdd?: string[]; network?: string;
  gatewayRoute?: string; ports?: PortMapping[]; restartPolicy?: 'unless-stopped';
}
```

`ContainerConfig` becomes `PlaneSpawnRequest & Partial<DockerCreateConfig> & { id?; name? }` for transition, or the create signature is overloaded per runtime. Pick the minimal typing that lets `PlaneRuntime.create` accept only `PlaneSpawnRequest` and the dev runtimes accept `DockerCreateConfig`.

- [ ] **Step 2: Write the failing test** — `create()` emits `spawn <persona> <parent> <child> <jobId>` via an injected runner; `exec`/`execStream`/`inspect` go over the plane, never docker; missing persona → reject; the injected runner is the ONLY egress (assert no `docker` spawn).

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PlaneRuntime } from './plane-runtime';
describe('PlaneRuntime', () => {
  it('create emits the 4-arg spawn verb and returns the daemon name', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'sen-x-abc\n', stderr: '', exitCode: 0 });
    const rt = new PlaneRuntime('/bin/sen-docker-client', { run });
    const id = await rt.create({ persona: 'ephemeral-shell', parentSession: 'sess_p', childSession: 'sess_c', jobId: 'job_1' });
    expect(run).toHaveBeenCalledWith(['spawn', 'ephemeral-shell', 'sess_p', 'sess_c', 'job_1']);
    expect(id).toBe('sen-x-abc');
  });
  it('rejects when persona is missing', async () => {
    await expect(new PlaneRuntime('/bin/x', { run: vi.fn() }).create({} as never)).rejects.toThrow(/persona/);
  });
});
```

- [ ] **Step 3: Implement `PlaneRuntime`** — port `ShimContainerRuntime.create()`'s 4-arg `spawn` assembly + error handling (it's correct) into a standalone `implements ContainerRuntime` with an injectable `{ run }`. Keep the `synthesizeJobId` fallback. `start` no-op; `adopt` re-runs `create`; in-process cache for `inspect`/`list`. `exec` → buffered plane `exec` verb; `execStream`/`inspect` wire to Part 1.4 (2D/2C). Do NOT extend `DockerContainerRuntime`.

- [ ] **Step 4: Register `plane`** in `registerBuiltinRuntimes()` (#2 Part E):

```typescript
const planeBin = process.env.LACE_DOCKER_BIN?.trim();
if (planeBin) registries.runtimes.register('plane', new PlaneRuntime(planeBin));
registries.runtimes.register('docker', makeDockerRuntime());   // dev/off-box
registries.runtimes.register('apple', new AppleContainerRuntime());
```

Box sets `LACE_CONTAINER_RUNTIME=plane`. Remove the old `ShimContainerRuntime` branch from `makeDockerRuntime`.

- [ ] **Step 5:** Run → PASS; delete `containers/shim-container-runtime.ts` + its tests. Commit (when the concurrent-writer coast is clear).

## Phase 1.2 — Split `buildPersonaContainerSpec`; delete netns + direct-docker

`buildPersonaContainerSpec` does **two jobs**: (a) dead docker-field emission (the plane rebuilds these), and (b) the **live** mount-name→host-path + env resolution the projected tool-runtime needs (`resolvePersonaMountsAndEnv`, consumed via `persona-projected-binding.ts:41` → `ProjectedContainerToolRuntime`). rev-1's "delete the whole function" would break the subagent's path/fs/exec. **Split, don't delete.**

**Files:** `jobs/persona-container-spec.ts`, `jobs/persona-projected-binding.ts`, `tools/runtime/projected-container.ts`, `containers/docker-container.ts`, `tools/implementations/delegate.ts`

- [ ] **Step 1:** Keep `resolvePersonaMountsAndEnv` + `buildPerInvocationSpecName`. Extract `buildProjectedRuntimeSpec` returning only `{ name, image, workingDirectory, mounts, env, persona, parentSession, childSession, jobId }` — NO `sysctls/capAdd/network/gatewayRoute/browserCdpSocket/ports/restartPolicy`. Delete `buildPersonaContainerSpec` + `withBrowserCdpSocketEnv` and the docker-field copies in `containerSpecToRuntimeSpec` + `projected-container.ts:243-263`. Update `persona-container-spec.test.ts` + `persona-projected-binding.test.ts` (don't delete — assert the narrowed shape).
  > **DECISION (rev 3): projected persona containers are PLANE-ONLY.** The only production path to `ContainerManager.materialize` is the projected path, and the plane rebuilds the docker fields from the persona — so dropping the docker-field copies is correct. A projected persona run on the dev `docker`/`apple` runtime would now lack network/caps/sysctls (un-quarantined) — that path is **not supported**; dev `docker`/`apple` are for non-persona local dev only. (Resolves the panel's "delete copies vs dev runtimes survive" contradiction.)
  > Also repoint `resolvePersonaMountsAndEnv` to read the container path from `entry.containerPath` (Open Item #1 / the prerequisite phase) instead of the persona mapping value.
- [ ] **Step 2:** Delete `runNetnsInit` (`docker-container.ts:287-350`) + **both** call sites (`:271` start path and `:726` create→start path — name both, or a dangling `await this.runNetnsInit(...)` is left); delete the `gatewayRoute` netns-sidecar tests in `docker-container.test.ts` (~1114-1193).
- [ ] **Step 3:** **Drop** `captureContainerImageId` entirely — it's a free fire-and-forget function with no runtime handle (can't call `planeRuntime.inspect`), and it shells out to `docker` which the box lacks. Remove the call at `projected-container.ts:713` + the function. (Best-effort audit log; no replacement needed.)
- [ ] **Step 4:** In `tools/implementations/delegate.ts` — confirm it reads only `runtime.type`/`runtime.containerSharing`/`runtime.workingDirectory` and passes `runtime` to the binding builder (it does NOT read the docker fields directly — rev-1 was wrong). Keep the scratch mkdir + `buildPerInvocationSpecName`. The dead-field removal is in `persona-container-spec.ts`, not here.
- [ ] **Step 5:** typecheck + `npm test -- "containers|delegate|projected|persona"`; commit.

## Phase 1.3 — Narrow `ContainerRuntime`; DEFER `inspectNetworkIp` removal to #4

**Files:** `containers/types.ts`

- [ ] **Step 1:** Keep the `ContainerRuntime` method set used by the plane path. **Do NOT remove `inspectNetworkIp?` here** — it has a live caller (`container-manager.ts:166`) feeding the egress source-IP bridge that #4 (D3) removes. Removing it now breaks the build; sequence it with #4. (rev-1 listed it for removal here — corrected.)
- [ ] **Step 2:** The carrier split (1.1) already keeps docker fields on `DockerCreateConfig` for dev runtimes — do NOT delete them from shared types in a way that breaks `docker`/`apple` (codex). Remove only the truly-orphaned bits.
- [ ] **Step 3:** typecheck + tests; commit.

## Phase 1.4 — `execStream` + `inspect` over the plane (pairs with 2D/2C)

- [ ] **Step 1:** `PlaneRuntime.execStream` against Part 2D's streaming client mode: spawn the plane client in `exec-stream` mode with piped stdio; map to `ExecStreamHandle` (stdin/stdout/stderr + `wait()`/`kill()`). Test against a fake plane client (echoes stdin). This is also what the projected helper's stdin round-trip rides.
- [ ] **Step 2:** `PlaneRuntime.inspect`/`daemonInspect` against Part 2C's closed query keys (`state`, `image`); map to `ContainerInfo`. Test the key→`ContainerInfo` mapping.
- [ ] **Step 3:** Keep `DockerContainerRuntime.execStream` for the dev `docker` runtime (off-box). Commit.

---

# Part 2 — sen-docker (Rust): personas-from-`.md`, fix the bugs, streaming, cap-allowlist

**Location:** `/home/jesse/git/prime-radiant/sen2/sen-core-v2/sen-docker/`.

## Phase 2A — Persona source: parse the lace `.md` frontmatter (kill the `.json`)

> Blocked on Open Item #1 (mount-model) — `serde_yaml` cannot read today's `mounts:` mapping into `Vec<String>`. Land the registry-owns-paths change first.

**Files:** `persona.rs`, `config.rs`, `Cargo.toml`

- [ ] **Step 1:** Add `serde_yaml` to `Cargo.toml`.
- [ ] **Step 2:** `PersonaSpec::from_markdown(md) -> Result<PersonaSpec>`: split the leading `---` YAML frontmatter, `serde_yaml::from_str` to a `Value`, take the `runtime:` mapping, **require + then STRIP the `type` key** (lace's `runtime.type: 'container'` is not a `PersonaSpec` field; with `deny_unknown_fields` it must be removed before deserialize, or model it via an intermediate tagged struct). Reject `type: root` personas with a clear error (the plane is only asked to spawn container personas). **YAML hardening (the `.md` is attacker-influencable until the lockdown gate):** reject documents using anchors/aliases (`&`/`*`), custom tags (`!!`), or duplicate keys before trusting any field. Then deserialize into `PersonaSpec`. Field correspondence to assert with a fixture `.md`: `image, containerSharing, workingDirectory, network?, gatewayRoute?, browserCdpSocket?, mounts(names), env, sysctls, capAdd, ports{host:u16,container:u16}, command?, user?` — lace has no `user`/`command` (both `#[serde(default)]`, fine).
- [ ] **Step 2b (lace):** clamp `portMappingSchema` (`config/persona-registry.ts:31-34`) to u16 (`z.number().int().min(0).max(65535)`) so a port lace accepts can't error the plane's `PortSpec: u16` parser. Single-source `.md` couples the two parsers — also add a doc-comment cross-link between `runtimeContainerSchema` and the Rust `PersonaSpec`, and gate lace persona-schema edits on a plane round-trip test (a future lace field would hard-fail the plane's `deny_unknown_fields` → spawn outage).
- [ ] **Step 3:** Repoint `config.rs` `persona_path` from `/etc/sen-personas/<p>.json` to `<SEN_PERSONA_MD_DIR>/<p>.md` (a trusted **write-protected** startup path — Production prereq #1). Single dir (the operator-owned/baked copy); the plane does NOT honor an agent-writable user-override dir. Change the `.json` suffix logic to `.md`. Document how that dir is mounted into the plane container (operator-owned mount or baked at image build) — load-bearing for prereq #1.
- [ ] **Step 4:** `mounts` reads the registry-supplied container path (Open Item #1). Delete `PersonaSpec::from_json` + `/etc/sen-personas` reading. Remove the `.md`→`.json` generation from the deploy pipeline (coordinated).
- [ ] **Step 5:** `cargo test` (fixture `.md` → expected `PersonaSpec`); commit.

## Phase 2B — exec env: ALLOWLIST (replace verbatim `-e` passthrough)

**Audit:** lace sends exec env via `ExecOptions.environment` → `docker exec -e K=V` (`docker-container.ts:122`); callers are the projected tool-runtime + helper (`runtime.process.exec`). A denylist is unwinnable (NODE_OPTIONS, GIT_SSH_COMMAND, GIT_EXTERNAL_DIFF, PYTHONPATH/PYTHONSTARTUP, LD_AUDIT/LD_*, PERL5OPT, RUBYOPT, HOME, TMPDIR, ENV, BASH_ENV, case-variant *proxy*, …).

- [ ] **Step 1:** At `dispatch.rs:266-272`, replace the verbatim `-e` forward with an **allowlist** check: only env keys on a small hardcoded allowlist (the exact set the tool runtime legitimately needs — derive from lace's exec callers; expect a handful) are forwarded; everything else → `deny`. Keep `-i`/`-w`. **Allowlist criterion: the value must be inert, or the value is pinned plane-side** — never allowlist a key whose caller-supplied *value* is security-bearing. Specifically `NODE_EXTRA_CA_CERTS` (a real persona env) must NOT be caller-settable via exec (an attacker CA → MITM of the credential proxy/TLS): exclude it from the exec allowlist, or accept the key but override its value with the plane's known CA path.
- [ ] **Step 2:** Tests: allowlisted inert key forwarded; non-allowlisted → deny; `-e NODE_EXTRA_CA_CERTS=/tmp/evil.pem` → denied or value-overridden. `cargo test`.
- [ ] **Step 3:** Commit. PR note: secrets must NOT ride exec `-e`; #6 moves them to the credential socket, shrinking this surface.

## Phase 2C — inspect: closed query keys (replace verbatim `--format`)

- [ ] **Step 1:** Replace caller `--format` (`dispatch.rs:425-432`) with a closed set of **templated** queries keyed by name (`state`→`{{.State.Status}}`, `image`→`{{.Image}}`, `json`→a **positive enumerated LEAF-field allowlist** — specific leaves like `.State.Status`/`.Image` only, **never a subtree** like `.Config`/`.NetworkSettings` and never a passthrough/`{{json .}}`). Reject any caller `--format`; an unknown query key → `deny`.
- [ ] **Step 2:** The projection MUST exclude sensitive fields: never expose `.Config.Env` (holds `SEN_AGENT_TOKEN`, `spawn.rs:138`), `.Config.Labels` (token-fingerprint), `.HostConfig.Binds`/`.Mounts` (host paths), `.NetworkSettings`. Keep the internal `inspect_labels` (`dispatch.rs:327-336`, returns the fingerprint label) **unreachable via the public query set** — it stays an internal call. Test: each query's output contains none of token/env/binds/mounts/fingerprint; unknown key → deny.
- [ ] **Step 3:** `cargo test`; commit.

## Phase 2D — Streaming exec-attach (new sub-protocol)

The existing request/response frame is buffered one-shot. Streaming needs a second mode on the same socket. rev-3 concretizes the design against the real blocking-I/O primitives (a single-loop relay deadlocks; the frame→relay transition and EOF/exit semantics must be pinned).

### Streaming wire contract (NORMATIVE — both the Rust plane and lace's `PlaneRuntime` cite this verbatim; do not re-derive per-repo)

- **Entry:** the connection begins with the normal length-prefixed request frame (`read_request_frame`) whose verb is `exec-stream`. After that frame, the socket switches to **chunk mode** for the rest of the connection; no response frame is ever written.
- **Chunk:** `<channel:u8><len:u32 big-endian><payload[len]>`. Channels: `stdin=0`, `stdout=1`, `stderr=2`, `exit=3`. `exit` payload = 1 byte (the process exit code; 255 for signal-killed).
- **Anti-forgery invariants (security-critical):** the **plane is the SOLE writer of the channel byte and the length** — container stdout/stderr bytes are *payload only*, never spliced onto the socket as control bytes. The `exit` chunk's code comes **only** from the child's `wait()` status, never synthesized from or triggered by container output. The client treats the **first** `exit` chunk as terminal and ignores all bytes after it. (A container that emits the exact bytes of an `exit(0)` chunk on its stdout reaches the client *inside a `stdout` chunk*, indistinguishable as data.)
- **stdin EOF:** the client signals "stdin done" with a **zero-length `channel=0` chunk** (NOT a socket half-close — the socket must stay open for stdout/exit). The plane, on the zero-len stdin chunk, closes the child's stdin.
- **Teardown ordering:** the plane drains child stdout/stderr to EOF and flushes all their chunks **before** sending the single `exit` chunk, **then** closes the socket. (Ties to the serialized-writer requirement below — out-of-order would truncate output.)
- **Size bounds:** each chunk `len ≤ MAX_FIELD_LEN` (reuse `frame.rs:10`, 16 MiB); a per-session total-byte + wall-time budget kills the child + closes on exceed (prevents an unbounded-output DoS against the sock holder).

### `frame.rs` additions
- [ ] `write_chunk(w, channel, payload)` and `read_chunk(r) -> (channel, payload)` with explicit short-read loops (read exactly 5 header bytes, then exactly `len`), `len` bounded by `MAX_FIELD_LEN`. Unit tests incl. a chunk split across reads and an over-cap `len` rejected.

### `Docker` trait — make the relay unit-testable
- [ ] Add `spawn_stream(args) -> io::Result<StreamChild>` where `StreamChild` exposes `stdin: impl Write`, `stdout: impl Read`, `stderr: impl Read`, `wait() -> ExitStatus` as a **small trait** (not concrete `std::process::Child`), so the relay logic operates on generic `Read`/`Write` halves and `FakeDocker` can supply an in-memory scripted child (no real subprocess in unit tests). `RealDocker::spawn_stream` wires `Command::spawn` with piped stdio. Buffered `run` is untouched; existing callers stay on it.

### Server `exec-stream`
- [ ] `handle_connection` must **fork before `write_response_frame`** for this verb: validate via dispatch (ownership `require_owned`; exec-env **allowlist** from 2B; **deny `-t`** — only `-i`), then hand the **raw `UnixStream` + the existing `BufReader` + the `StreamChild`** to the relay (the current `handle_request → Response` path cannot carry these; add a streaming branch). The relay **must reuse the existing `BufReader`** for the socket-read side — it may already hold stdin bytes the client pipelined after the request frame; reading from a fresh handle would drop them.
- [ ] **Thread model (REQUIRED — a single loop deadlocks on pipe-buffer fill):** `try_clone()` the socket. Run **three pumps** — (a) socket→child.stdin (drives the zero-len-chunk → close-stdin), (b) child.stdout→socket, (c) child.stderr→socket — plus the exit reaper (`wait()`). **All socket writes go through one serialized writer** (a `Mutex<UnixStream>` or a single writer thread fed by an mpsc) so stdout/stderr chunks never interleave and corrupt framing. On `wait()`: ensure (b)/(c) have drained to EOF, then emit the one `exit` chunk, then close.

### Client `exec-stream` mode
- [ ] New client function (the one-shot `run_client` shape cannot be reused): after writing the request frame, run **two threads** — process-stdin→socket(`channel=0`, zero-len on EOF) and socket→demux to process stdout/stderr; on the first `exit` chunk, stop and exit with its code.

### lace + tests
- [ ] `PlaneRuntime.execStream` (Part 1.4) spawns the client in `exec-stream` mode with piped stdio → `ExecStreamHandle`. `PlaneRuntime.exec` (buffered) **throws if `options.stdin` is set** (routes stdin callers to `execStream`) so the stdin-less buffered path can't silently drop data. The projected helper already rides `execStream` (verified: `projected-container.ts:756/840`), so its stdin round-trip works.
- [ ] **Tests:** (Rust) echo stdin→stdout + correct exit; **forgery test** — a fake child whose stdout is exactly the bytes of a forged `exit(0)` chunk → client still sees the real process exit, forged bytes delivered as stdout payload; unowned id → `no such container`, no `spawn_stream`; over-budget session → child killed; partial-chunk read. (lace) `PlaneRuntime.execStream` round-trips stdin/stdout/exit against a fake plane client implementing the wire contract above.
- [ ] `cargo test` + the lace test; commit.

## Phase 2E — Persona-field validation (cap base now; full validation = pre-prod gate)

A tampered persona `.md` escalates via MORE than caps — `user:0:0` (root), `network:host`, a chosen `image`/`command`, `sysctls`. So 2E is **persona-field validation**, all enforced in `PersonaSpec::validate()` (binds every load path), not just a cap filter.

- [ ] **Step 1 (lands now — cheap floor item):** enforce `cap_add ⊆ {NET_ADMIN}`; reject any other cap **even from the persona file**. Test: `SYS_ADMIN` rejected, `NET_ADMIN` allowed. Commit.
- [ ] **Step 2 (PRE-PROD GATE — see Interim security window):** add the rest of the closed-allowlist validation, each with a reject test:
  - `network` ∈ `{quarantine, <the per-agent nets #4 adds>}` — reject `host`, `none`, `container:*`.
  - `sysctls` keys ⊆ a closed set (today's only real entry is `net.ipv4.ip_local_port_range`).
  - `user` pinned non-root — reject uid 0 (or force `1000:1000` plane-side).
  - `image` ⊆ a registry-prefix allowlist (mirror the closed persona-enum discipline in `validate.rs:9`).
  - `command` — constrained or dropped for personas that don't need it; with `user`/`image` bounded it is far less dangerous.
  This is the defense-in-depth half of the pre-prod gate; the other half is the `.md`-dir lockdown. Until both land, the interim window (above) stands.

## Phase 2F — Egress fail-closed (tighten; coordinate with #4)

- [ ] **Step 1:** Today the container is `docker start`ed and THEN the netns iptables run (`spawn.rs` create→start→`finish_with_netns`); a netns-init failure leaves it running with open egress (fail-open). Make it **fail-closed:** on netns-init failure, `stop`+`rm` the container before returning the error. (Full structural-egress-at-create is #4/D3; this is the minimal fail-closed fix.)
- [ ] **Step 2:** Test: netns failure → container removed, error returned. `cargo test`; commit.

---

## Self-review (rev 2)

- **Floor items now correct:** cap-allowlist is BUILT (2E), not falsely claimed done; exec-env is an allowlist (2B); inspect closed-set excludes the token-bearing fields (2C); egress fail-closed (2F).
- **Streaming is buildable:** 2D specifies the actual sub-protocol (chunk framing + `spawn_stream` + client mode), not "extend exec." It also closes the stdin gap for the projected helper.
- **No projected-runtime breakage:** 1.2 splits the builder (keeps `resolvePersonaMountsAndEnv`).
- **Dev runtimes:** carriers split (`PlaneSpawnRequest` vs `DockerCreateConfig`); `docker`/`apple` keep their fields + `execStream` for **non-persona local dev**. **Projected persona containers are PLANE-ONLY** (rev 3) — running a persona on dev docker/apple is unsupported (it would be un-quarantined), resolving the panel's copy-deletion-vs-dev contradiction.
- **Streaming is now buildable, not just shaped:** 2D pins the thread model (3 server pumps + serialized writer; 2 client threads; `try_clone` halves), the `handle_connection` fork + `BufReader` reuse, stdin-EOF / drain-before-exit ordering, `read_chunk`/`write_chunk` in `frame.rs`, a testable `Docker::spawn_stream` (generic Read/Write halves, not concrete `Child`), the anti-forgery invariants (plane sole writer of channel+len; exit only from `wait()`), and size/session caps.
- **Dependencies honored:** Part 1 hard-gated on #2 Part E; 2A hard-gated on Open Item #1; `inspectNetworkIp` removal deferred to #4; paths corrected (`tools/implementations/delegate.ts`).
- **Security posture stated honestly:** the live-`.md`-source escalation is closed by Production prereq #1 (agent-unwritable `.md`, Jesse-deferred) + bounded by 2E; not hand-waved.

## Open items carried forward

- Production prereq #1 (agent-unwritable persona `.md` dir) — separate hardening, MUST precede prod trust.
- #4 (egress D3): per-agent point-to-point + IPAM + structural-egress-at-create + `inspectNetworkIp`/source-IP-bridge removal.
- #6 (credentials): move secrets off exec env onto the credential socket (shrinks 2B); CDP injection via plane `docker exec` into the browser.
- `docker`/`apple` dev runtimes: kept off-box; mark dev-only if they bitrot.
