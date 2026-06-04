# Egress + sibling isolation (D3 / #4) Implementation Plan — rev 4

> **For agentic workers:** REQUIRED SUB-SKILL:
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`). Spans **sen-core-v2
> (Rust plane + Rust broker/proxy + the broker `entrypoint.sh` + TS
> credential-injection)** + **lace (TS)**. Box-coordinated (`--recreate`; we own
> the box; not in production).

> **rev 4 (2026-06-03):** 3rd panel found rev-3's per-agent-net change exposed
> that the broker's whole iptables/dnsmasq/capture layer is hard-keyed to ONE
> shared subnet (`SEN_QUARANTINE_SUBNET`). rev-4 makes the broker policy
> **subnet-agnostic and interface-name-independent**, re-keys capture-egress off
> source-IP, and fixes the deletion cascades + spec inaccuracies. Architecture
> (per-agent docker net + per-agent-subnet source-IP attribution + kill the
> egress token) is unchanged and panel-endorsed; rev-4 is about making the
> broker layer actually deliver isolation + forced egress for per-agent subnets.

**Goal:** Per-agent docker network (Docker-managed IPAM/veth/GC); **structural
forced egress + sibling isolation via a subnet-agnostic broker
FORWARD-policy-DROP + narrow per-subnet ACCEPTs** (no dependence on docker's
`br-<hash>` interface names); attribute egress by **per-agent-subnet source-IP →
identity** (unspoofable: agents have no `NET_RAW`/`NET_ADMIN`, so the kernel
stamps the real source, and the shim rebuilds the create argv so the caller
can't inject caps); delete the per-container token's egress role, the lace
source-IP bridge, and the synthetic-token machinery.

**Tech Stack:** Rust (`sen-core-v2/sen-docker` plane, `sen-core-v2/proxy`
broker), the broker `docker/credential-proxy/entrypoint.sh`, TS
(`sen-core-v2/src/credential-injection`, `lace/packages/agent`).

> **Dependencies:** rides #3 (plane owns spawn/rm). The unspoofability guarantee
> = **personas declare no `capAdd` + the shim rebuilds the create argv from the
> persona file so a compromised caller can't inject caps** (verified:
> `spawn.rs:158-161` sources caps only from `spec.cap_add`; persona JSONs carry
> no `capAdd`). NOTE: there is **no cap _allowlist_ in code today** — #3 Part 2E
> is supposed to add one and is still unbuilt; rev-4 recommends adding a real
> `cap_add ⊆ {NET_ADMIN}` deny in `build_create_argv` as defense-in-depth (don't
> rely on a "2E allowlist" that doesn't exist yet). #4 **owns the
> `inspectNetworkIp` removal #3 deferred.** Token's full deletion finishes in
> **#6**; #4 removes only egress's dependence on it.

---

## KEEP / NET-NEW / DELETE / REWRITE (verified against code)

**KEEP:** the broker's transparent-listener termination + re-origination
(`proxy/src/transparent.rs` REDIRECT + `SO_ORIGINAL_DST`, accept locally, fresh
upstream from the broker's default-net iface — it does NOT forward agent
packets); MITM injection (`request_pipeline.rs`/`mitm.rs`); the CONNECT
front-door auth (`auth.rs`/`extract_bearer`) **until #6**.

**REWRITE (the blocker/major):** the broker `entrypoint.sh` network policy —
today every rule is scoped `-s $SEN_QUARANTINE_SUBNET` (REDIRECT `:50-58`,
FORWARD DNS/ESTABLISHED/DROP `:74-86`, MASQUERADE `:92-96`, dnsmasq on the
single `GATEWAY_IP` `:110-118`). Make it subnet-agnostic (Part 2).

**NET-NEW:** per-spawn `docker network create` (normal bridge) +
`connect <broker>` + `inspect`; the plane (or an entrypoint hook) installs the
per-subnet broker rules at connect; a `{docker-network-id → identity}` map;
`docker network` verbs in the plane allowlist.

**DELETE:** the egress token machinery — synthetic-token mint +
`sourceIpIndex` + `resolveBySourceIp` (`runtime-registry.ts:113-153`) **and its
proxy op + wire types** (`helper-server.ts:433-443` `resolve_source_ip`,
`proxy-helper-protocol.ts:259-281` `ResolveSourceIp*`, the `ProxyHelperOp`
member `:11`), `transparent.rs`'s `resolve_source_ip`/`validate_token`
round-trip (`:267-279,388,399-421`); lace's source-IP bridge
(`container-manager.ts:117-186`, `inspectNetworkIp`
`types.ts:163`/`docker-container.ts:166-176`, the `gatewayRoute`/`network`
carrier flow); sen-core `handleNetworkAttached`
(`lace-runtime-registration.ts:111-144`); the hand-rolled netns veth wiring; the
shared `quarantine` network. (Token _injection_ `spawn.rs:138` + the
explicit/subagent-socket API die in **#6**.)

---

# Part 1 — the plane (Rust): per-agent network + register-before-start + lifecycle

## Phase 1.1 — Allowlist plane-internal `docker network` verbs

- [ ] `dispatch.rs:75-81` denies anything outside `{spawn,…,ps}`
      (`unknown_verb_denied…` `:480`). Add plane-internal
      `network create/connect/disconnect/inspect/rm` (the plane builds these
      argvs; caller-supplied `network` stays denied). Tests: plane net ops
      succeed; caller `network` denied. `cargo test`; commit.

## Phase 1.2 — Spawn onto a per-agent normal-bridge network; discover the broker gateway

- [ ] **Step 1:**
      `docker network create --label sen.broker.child-session-id=<child> --label sen.broker.persona=<p> sen-egress-<child8>`
      (**normal bridge, NOT `--internal`**; `--internal` breaks DNS —
      `docker-compose.yml:472-478`). Idempotent on adopt.
- [ ] **Step 2:** create the agent on it (`build_create_argv` `spawn.rs:117-120`
      → `--network sen-egress-<child8>`).
- [ ] **Step 3:** `docker network connect <net> <broker>`; then
      `docker network inspect <net>` and read
      **`Containers[<broker-id>].IPv4Address`** (strip `/CIDR`) for the broker's
      gateway IP on this net, and the subnet from `IPAM.Config[].Subnet`. Error
      if absent — do NOT fall back to `IPAM.Config[].Gateway` (that's the bridge
      `.1`, not the broker).
- [ ] **Step 4:** netns sidecar:
      `ip route replace default via <discovered-broker-ip>` (`spawn.rs:75`) +
      feed the **discovered** broker IP to `--dns` (`spawn.rs:162`). No agent
      `NET_ADMIN`. Relax `persona.rs:68-70` (it currently _requires_ `network`
      when `gateway_route` is set) — per-agent personas declare neither.
- [ ] **Step 5: fail-closed:** any failure → `stop`+`rm` container, deregister,
      `network disconnect <broker>` + `network rm`, before returning.
- [ ] **Step 6: teardown:** on `rm` → **deregister FIRST and require success**
      (Phase 1.3) → `network disconnect <broker>` (rm fails with an endpoint
      attached) → `network rm`. Also remove this net's broker iptables rules
      (Part 2). Reaper:
      `docker network ls --filter label=sen.broker.child-session-id -q` (a
      concrete label key — `label=sen.broker.*` is invalid filter syntax) → for
      orphans: deregister, disconnect, rm + drop rules.
- [ ] **Step 7:** Tests (docker seam faked): normal-bridge argv; broker-IP read
      from `Containers[broker].IPv4Address`; rm order deregister→disconnect→rm.
      `cargo test`; commit.

## Phase 1.3 — Register `{network-id → identity}` BEFORE `docker start`, reuse-safe

- [ ] **Step 1:** After connect+inspect, register
      `{networkId, subnet} → CallerIdentity` via the helper (replaces
      `register_runtime`'s token path `dispatch.rs:163-175`). **The barrier is
      `docker start` (`dispatch.rs:191`)** — registration must complete before
      the agent container starts (the agent can egress the instant it starts,
      via the broker gateway + the Part-2 REDIRECT, regardless of the netns
      route). (rev-3 wrongly named the netns sidecar as the barrier.) With
      fail-closed (Part 3), an early packet denies-and-retries rather than
      mis-resolving.
- [ ] **Step 2:** Key the map on the **Docker network ID** (immutable per live
      net; available from create/`inspect -f '{{.Id}}'`). **Gate `network rm` on
      deregister success** (Phase 1.2 Step 6). Resolve re-validates the
      **matched entry's network ID is still live** (Docker recycles _subnets_,
      so subnet-presence alone is unsafe). No grace TTL.
- [ ] **Step 3:** Tests: register before start; rm requires deregister; a
      recycled subnet does NOT resolve to a torn-down agent. `cargo test`;
      commit.

---

> **rev 5 (2026-06-03):** 4th panel — judge verdict READY-TO-IMPLEMENT. Closed
> the two remaining real gaps: **(1) the broker, not the plane, installs the
> per-subnet iptables/dnsmasq** (the plane is an unprivileged docker client —
> `user 1000:1000`, no NET*ADMIN, not in the broker netns — so it \_cannot*
> write rules there; the broker has NET*ADMIN and runs as root) via a **new
> plane→broker control socket** the plane calls synchronously after
> `network connect` and before `docker start` (and on teardown); **(2) the
> capture/attribution stable key = `persona+session+job`** (not "network ID",
> which exists nowhere in code), re-keyed across the \_cross-process*
> `readRecentEgress`/audit-`sourceIp` correlation too. Plus minors
> (runtime-inject the discovered net+broker-IP into
> `build_create_argv`/`finish_with_netns`; spawn-flow reorder
> register→after-connect-before-start; land the `cap_add⊆{NET_ADMIN}` deny;
> untangle DNS forwarded-vs-local; fix the Step-6 gateway_route transition
> contradiction). After this, per the judge, remaining items are competent
> in-code execution.

# Part 2 — the broker network policy (NEW): subnet-agnostic forced egress + sibling isolation

> **WHO installs the rules (rev 5):** the **broker** owns all iptables/dnsmasq
> mutation in its own netns — it has `NET_ADMIN`/`NET_RAW` + runs as root
> (`docker-compose.yml:286-290`). The **plane cannot** (unprivileged docker
> client, `docker-compose.yml:405-420`; `gated_exec` only reaches shim-owned
> containers, not the broker). Add a **broker control socket** (a small RPC:
> `install-net{subnet,brokerIp}` / `remove-net{subnet}`). The plane calls
> `install-net` **synchronously after `docker network connect` and before
> `docker start`** (so the rules + REDIRECT exist before the agent's first
> packet — no race), and `remove-net` on teardown (so rules don't leak).
> `entrypoint.sh` keeps only the static, subnet-independent setup:
> `iptables -P FORWARD DROP` + the control-socket listener + one
> `dnsmasq --bind-dynamic` (binds each per-net broker IP as the interface
> appears — one instance suffices, it's a forwarder). The per-subnet
> REDIRECT/ACCEPT/MASQUERADE are added by `install-net`.

The current `entrypoint.sh` rules are all `-s $SEN_QUARANTINE_SUBNET`-scoped → a
per-agent subnet matches NONE → not REDIRECT'd (no MITM/injection) and forwarded
by the default-ACCEPT FORWARD policy (egress leaks). And the rev-3
`-i sen-egress-+` isolation rule never fires (docker bridges are `br-<netid>`,
not the network name). Fix = **policy-based, interface-name-independent**:

**Files:** `sen-core-v2/docker/credential-proxy/entrypoint.sh` (or move
rule-installation into the plane at connect-time). `docker-compose.yml`
(`ip_forward`).

- [ ] **Step 1: `iptables -P FORWARD DROP`** on the broker (default-deny the
      chain itself, not a per-subnet rule). This alone makes sibling-to-sibling
      forwarding impossible regardless of interface names — A→B is never
      ACCEPTed.
- [ ] **Step 2: per-agent-subnet rules, installed at `network connect` (Part 1.2
      Step 3 hands the subnet + broker-IP):** for each agent subnet `S` with
      broker gateway `G`:
  - `nat PREROUTING`: `-s S -p tcp --dport 80 -j REDIRECT --to 7780` and
    `--dport 443 -j REDIRECT --to 7781` (or the existing SEN_QUAR chain,
    parameterized by `S`).
  - `FORWARD`: `-s S -d <dns/broker> -j ACCEPT` for DNS +
    `-m state --state ESTABLISHED,RELATED -j ACCEPT` — and **NO
    `-s S -d <other agent subnet>` ACCEPT ever** (sibling isolation = the
    absence of any subnet→subnet ACCEPT under policy DROP).
  - `nat POSTROUTING`: `-s S ! -d S -o <broker-external-if> -j MASQUERADE` for
    the re-originated/forwarded path.
  - These are **subnet-scoped, not interface-scoped** → no `br-<hash>`
    dependency.
- [ ] **Step 3: DNS (untangle forwarded vs local).** One
      `dnsmasq --bind-dynamic` instance suffices (a forwarder; it binds each
      per-net broker IP as the interface appears — no per-connect
      `--listen-address` churn). **The agent's `--dns` is the broker's IP on its
      net = a LOCAL destination on the broker → INPUT chain, not FORWARD** (so
      the rev-4 "FORWARD `-s S -d <dns>` ACCEPT" was partly inert). Allow it on
      INPUT (`-i <agent-nets> -p udp/tcp --dport 53 -j ACCEPT` to the broker's
      own IPs); the broker→`127.0.0.11` upstream leg is local-to-broker. Confirm
      DNS resolves on a normal (non-internal) per-agent net.
- [ ] **Step 4: anti-spoof in the RIGHT chain.** REDIRECT'd egress is consumed
      in `nat/PREROUTING` and never traverses FORWARD, so a FORWARD anti-spoof
      rule is inert. Put anti-spoof in `nat/PREROUTING`/`raw` (drop `-s` not in
      the ingress net's subnet) OR set per-interface `rp_filter` carefully (the
      broker is multi-homed — do NOT flip global strict `rp_filter`; it can drop
      the broker's own asymmetric return path). This is belt; the primary
      guarantee is no-NET_RAW.
- [ ] **Step 5:** Remove this net's rules on teardown (Part 1.2 Step 6).
- [ ] **Step 6: transition without a coverage gap (rev-5 fix).** The rev-4 plan
      contradicted itself: it relaxed `persona.rs` so per-agent personas declare
      no `gateway_route` (Part 1.2 Step 4), but `finish_with_netns` only runs
      the per-netns OUTPUT DROP `if let Some(gw) = spec.gateway_route`
      (`dispatch.rs:202`) — so on the new path that DROP never runs, leaving NO
      safety net. Resolution: **gate the per-agent-net rollout entirely behind
      box-verified broker rules** — i.e. do NOT switch agents onto per-agent
      nets (Part 1.2) until Part 2's broker FORWARD-DROP + `install-net` rules
      are confirmed (on the box) to isolate siblings + force egress. The old
      shared-`quarantine` path (with its working netns DROP) stays the live path
      until then. There is no in-between window where an agent runs on a
      per-agent net without verified broker rules.
- [ ] **Step 7:** Tests/box-checks: A→internet works (REDIRECT'd, injected); A→B
      blocked; A's DNS resolves via its broker IP; a per-agent subnet with no
      rules installed has zero egress (fail-closed). Commit.

---

# Part 3 — the broker attribution (Rust + TS): subnet→identity, fail-closed, identity-keyed, capture re-keyed

**Files:** `proxy/src/transparent.rs`, `request_pipeline.rs`, `mitm.rs`;
`sen-core-v2/src/credential-injection/{runtime-registry.ts,proxy-helper-protocol.ts,helper-server.ts,credential-capture-egress.ts}`;
`helper_client.rs`.

- [ ] **Step 1:** Replace the source-IP→synthetic-token resolver
      (`transparent.rs:267-279,388`) with **longest-prefix match of `peer.ip()`
      against the registered per-agent subnets → `CallerIdentity`** (`peer`
      already in hand; REDIRECT preserves source, so `peer.ip()` is the
      kernel-stamped agent IP). Delete `resolve_source_ip` + the
      `validate_token` round-trip (`:399-421`) + the
      synthetic-token/`sourceIpIndex` machinery (`runtime-registry.ts:113-153`)
      **and the cascade**: the `resolve_source_ip` proxy op
      (`helper-server.ts:433-443`), `ResolveSourceIp*` wire types
      (`proxy-helper-protocol.ts:259-281`), the `ProxyHelperOp` union member
      (`:11`). (Subnets disjoint by Docker IPAM → a `HashMap`/range lookup
      suffices; longest-prefix only matters if custom overlapping pools are ever
      configured — add a test if so.)
- [ ] **Step 2: FAIL CLOSED.** Today on resolve failure `transparent.rs:396-421`
      builds an **empty `CallerIdentity`** and proceeds (`:438-454`). Change: no
      subnet match ⇒ **deny the connection before any `run_mitm`/leaf-mint**;
      delete the empty-identity literal (don't leave it as a fallback). Make the
      deny distinguishable in audit from infra drops. Test "unmapped ⇒ denied."
- [ ] **Step 3: identity-keyed `request_credential` — both paths, multi-file
      (not a one-line swap).** The shared op (`request_pipeline.rs:527`)
      currently sends `ctx.execution_token`; `helper_client::request_credential`
      (`helper_client.rs:80`) puts it on the wire; `proxyRequestCredential`
      (`helper-server.ts:527/533`) does `registry.resolve({token})`. Re-key all
      three: change `ProxyRequestCredentialRequest`
      (`proxy-helper-protocol.ts:144`) to carry the resolved identity, change
      `helper_client::request_credential` to send it, change
      `proxyRequestCredential` to consume it. Source identity from
      `PipelineContext.identity_*` — **both** CONNECT (populated by
      `auth::authenticate_request`) and transparent (Step 1) paths set it before
      `request_credential` (verified: single caller, identity always populated).
      **Do NOT touch `auth.rs`/`extract_bearer`** (CONNECT front door; #6). This
      swaps both paths at once → CONNECT doesn't 401 pre-#6.
- [ ] **Step 4: re-key capture-egress (HIGH — deleting `identity.sourceIp`
      strands it otherwise).** `armEgressCapture` stores
      `sourceIp: identity.sourceIp ?? ''` (`helper-server.ts:1075`,
      `credential-capture-egress.ts:115`); the query side reads `ctx.source_ip`
      (`request_pipeline.rs:357`); `synthesizeRecentEgress`
      (`helper-server.ts:596`) + `destination-check` also read
      `identity.sourceIp`. Deleting `registration.sourceIp` (the only writer,
      `runtime-registry.ts:103`) makes the arm key `''` ≠ the query key →
      captures silently stop. **Key = `persona+session+job`** (rev-5: NOT
      "Docker network ID" — that exists nowhere in code and isn't on
      `CallerIdentity`/`PipelineContext`/the wire; `persona+session+job` is the
      only tuple on BOTH sides today — helper's `CallerIdentity` and proxy's
      `PipelineContext.identity_*`). **Re-key the whole capture path** — both
      the in-memory store (`PendingCaptureStore`, `findCandidates`/`isArmed`,
      `capture_check`/`capture_offer` wire, `armEgressCapture`) **AND the
      cross-process recent-egress correlation** (the proxy stamps `sourceIp` on
      network-boundary audit rows `request_pipeline.rs:715`; `readRecentEgress`
      matches `row.sourceIp` `audit-log.ts:108-110`; `synthesizeRecentEgress`
      `helper-server.ts:596` + `destination-check` read it). Move BOTH the
      proxy's audit stamp and `readRecentEgress`'s match onto the same key —
      re-keying only the in-memory store while the proxy keeps stamping
      `sourceIp` re-strands destination-check (same arm≠query failure as the
      original bug). Also re-key `commitCapturedCredential`/`createdBy.sourceIp`
      (`credential-setting.ts:379,475`) provenance. Test: arm+capture match AND
      destination-check recent-egress match across the re-keyed path.
- [ ] **Step 5: audit re-key.** `CallerIdentity.tokenFingerprint` (audit-only;
      `helper-server.ts:1938`, `credential-capture-egress.ts:76`; no gate keys
      on it — gates use `identity.persona`) loses its source post-token.
      Populate the audit correlation field from the network ID (or
      persona+session+job); ensure it's not left empty (an empty audit key
      silently breaks egress forensics — the thing this whole plan is about).
- [ ] **Step 6:** `PipelineContext.source_ip` keeps only an optional
      audit-string role (no identity role). Tests: A→A's identity;
      unmapped→denied; CONNECT still issues; capture still fires; audit
      correlated. `cargo test`; commit.

> **Token note (scope):** #4 removes egress's token dependence only.
> `SEN_AGENT_TOKEN` injection (`spawn.rs:138`) + the **entire subagent-socket
> credential API** (`request-credential.ts:390-498`: `issue_nonce`,
> `list_credentials`, `set_credential`, `type_replace`, `delete_credential`,
> `capture_status`, all gated by `registry.resolve({token})` at
> `helper-server.ts:350`) + the CONNECT `Proxy-Authorization` → **#6**
> (capability tool + `SO_PEERCRED`). #6 is materially larger than "swap
> request_credential."

---

# Part 4 — lace (TS): delete the source-IP bridge

- [ ] Delete `notifyNetworkAttached` + observer + call sites
      (`container-manager.ts:117-186`, 292/304/321); `inspectNetworkIp`
      (`types.ts:163`, `docker-container.ts:166-176`); the
      `gatewayRoute`/`network` carrier flow. typecheck +
      `npm test -- containers`; commit.

# Part 5 — sen-core (TS): retire the lace-event handler

- [ ] Delete `handleNetworkAttached` (`lace-runtime-registration.ts:111-144`) +
      `container_network_attached/detached`; remove `job_started` caching if it
      only fed that; `runtime-registry.ts` collapses to
      `{network-id → identity}`. Tests; commit.

# Part 6 — Decommission the shared `quarantine` network

- [ ] Remove `--network quarantine` + the `quarantine` definition
      (`docker-compose.prod.yml:23-29`) + `SEN_QUARANTINE_NETWORK` once
      per-agent nets are live. Box-coordinated `--recreate`. Box check:
      A→internet (injected), A→B blocked, DNS per net, capture fires, CONNECT
      issues.

---

## Self-review (rev 4)

- **Forced egress + sibling isolation now actually fire:** `FORWARD -P DROP` +
  narrow per-subnet ACCEPTs (never subnet→subnet) —
  **interface-name-independent** (fixes the inert `-i sen-egress-+` rule), and
  the broker's REDIRECT/MASQUERADE/dnsmasq are now per-subnet (fixes the
  single-`SEN_QUARANTINE_SUBNET` leak). The working per-netns DROP stays until
  the broker replacement is box-verified.
- **Attribution sound:** subnet source-IP, unspoofable via no-NET_RAW (real
  mechanism: empty-persona-capAdd + shim-rebuilt-argv; rev-4 also recommends a
  real cap deny in `build_create_argv`), anti-spoof in PREROUTING (not the inert
  FORWARD), fail-closed, network-ID-keyed + deregister-gated-rm +
  liveness-on-resolve (reuse-safe).
- **No stranded deps:** capture-egress re-keyed onto a stable identity key (not
  source-IP); audit re-keyed; the `resolve_source_ip` op + wire types deleted in
  the same cascade; `request_credential` re-keyed across all three files without
  breaking CONNECT.
- **Spec accuracy fixed:** register-before-`docker start` (not the netns
  sidecar); valid reaper filter; broker IP from
  `Containers[broker].IPv4Address`; persona.rs network/gateway validation
  relaxed; the "cap-allowlist" claim corrected to the real mechanism (+ a
  recommended real allowlist).
- **Honest blast radius:** #4 is NOT "a few docker calls" — it's a
  subnet-agnostic rewrite of the broker's iptables/dnsmasq + a capture-egress
  re-key. Sound architecture, real scope; box-validation of Part 2 is the gate.

## rev-5 in-code must-fixes (judge's list — resolvable during implementation)

- **Runtime-injection refactor:** the per-agent net name + broker IP are
  _discovered at runtime_ (create→connect→inspect), not declared in the persona.
  Thread them as params into `build_create_argv` (`spawn.rs:117` `--network`,
  `:162` `--dns`) and `finish_with_netns` (`dispatch.rs:202`) instead of reading
  `spec.network`/`spec.gateway_route`. (Signature change across 3 fns.)
- **Spawn-flow reorder:** `register_runtime` runs _before_ create today
  (`dispatch.rs:173`); it must move to _after_ create+connect+inspect (to key on
  the network + discover the broker IP) but _before_ `docker start` (`:191`).
  Extend the fail-closed unwind (Part 1.2 Step 5) to cover network teardown.
- **Cap deny (the #3 Part 2E dependency — UNBUILT):** add
  `cap_add ⊆ {NET_ADMIN}` enforcement in
  `build_create_argv`/`PersonaSpec::validate` so no agent gets
  NET*ADMIN/NET_RAW. Source-IP unspoofability \_depends* on this; don't ship
  Parts 2/3 relying on a "2E allowlist" that doesn't exist yet.
- **Deletion-cascade dead-refs:** when deleting the
  `resolve_source_ip`/`sourceIpIndex` machinery (Part 3 Step 1), also remove the
  op-guard line (`helper-server.ts:737`), the `runtime-registry.ts` type aliases
  (`:50-51`) + `clear()` (`:157`), and the `helper_client.rs:13` import + the
  `transparent.rs:273` match arm — or the build breaks mid-cascade. Chase Part 3
  by symbol, not the (drifted) line numbers.
- **`validate_token` proxy op** may be deletable _now_ (not #6): once Step 1
  deletes the synthetic-token mint, the transparent path no longer produces a
  token to validate, and CONNECT's identity comes from `auth.rs` — confirm and
  delete if dead.

## Open items carried forward

- Box-validate Part 2 (FORWARD-DROP + per-subnet rules isolate siblings + force
  egress + DNS resolves) before removing the per-netns DROP.
- #6 finishes the token deletion (the whole subagent-socket API → capability
  tool + SO_PEERCRED; delete the injection + the world-writable socket).
- #3 Part 2E: add the real cap deny in `build_create_argv` (no agent
  NET_ADMIN/NET_RAW) — hard dependency for source-IP unspoofability +
  forced-egress integrity; currently unbuilt.
