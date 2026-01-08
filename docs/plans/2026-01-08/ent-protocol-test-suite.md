# Plan: Full Ent Protocol Test Suite (agent package)

Audience: contributors adding/maintaining Ent protocol support. Goal: executable contract tests that double as usage examples and guard rails for regressions.

Current location (as of 2026-01-08): `packages/agent/src/__tests__/ent-protocol.spec.ts`.

Principles
- Run agent as a subprocess over stdio JSON-RPC; no direct file poking beyond temp dirs.
- Fresh temp `LACE_DIR` and workdir per suite; deterministic fixtures.
- Table-driven cases: for each method, cover happy path, required param missing, invalid type, unknown IDs, idempotency, persistence (where applicable).
- Assert both responses and side effects: state persistence, notifications, stored gating files, etc.
- Capability-aware: check `initialize` capabilities before optional methods.

Test matrix (per method)
1) `initialize`
   - Valid call returns protocolVersion and advertised capabilities.
   - Invalid params → -32602.
2) `ent/agent/status`
   - Before session: currentSession absent.
   - After session/new + configure: connectionId/modelId present; models list populated; pendingPermissions empty.
3) `session/new`, `session/load`
   - New returns sessionId; workDir honored; invalid path rejected.
   - Load unknown session → SessionNotFound.
4) `session/prompt` (+notifications)
   - Happy path: text_delta + turn_end; streaming ends.
   - Missing config (no connection/model) → InvalidParams.
   - Concurrent prompt while active → SessionBusy.
5) `session/request_permission` (inbound)
   - Agent emits; client replies allow/deny; verify session/update reflects decision.
   - Invalid option id → error.
6) `ent/providers/list`
   - Returns only supported provider types.
   - Empty catalog still returns [].
6.1) `ent/providers/catalog`
   - Returns catalog providers with models + metadata; dynamic enrichment allowed when credentials exist.
7) `ent/providers/refresh`
   - All providers; provider-specific.
   - Unknown providerId → ok: false with error (no throw).
   - Regression: refresh with missing catalogs retains previous cache (no Unknown provider afterward).
8) `ent/connections/list`
   - No filter vs providerId filter; returns credentialState.
   - Empty set OK.
9) `ent/connections/upsert`
   - Create requires providerId + config; returns created: true.
   - Update preserves provider binding; created: false.
   - Config must be object; credentials rejected; provider mismatch rejected.
10) `ent/connections/credentials/start`
    - Ready connection → kind != needs_input.
    - needs_input returns fields; secret respected.
    - Unknown connection → ConnectionNotFound.
11) `ent/connections/credentials/submit`
    - Happy path marks ready.
    - Missing required field → InvalidParams.
    - Unknown connection → ConnectionNotFound.
12) `ent/models/list`
    - Requires connectionId; unknown connection → ConnectionNotFound.
    - Returns providerId, connectionId, models with `disabled` + `disabledState` reflecting gating.
13) `ent/models/refresh`
    - Refresh valid; unknown connection → ConnectionNotFound; idempotent.
14) `ent/models/enable` / `ent/models/disable`
    - Valid providerId/modelIds updates gating; sorted enabled/disabled arrays.
    - Unknown providerId/modelId → InvalidParams.
    - Idempotent; persisted across agent restart.
15) `ent/tools/list`
    - Tools returned without duplicates; kinds validated.
16) `ent/personas/list`
    - Personas returned; optional fields handled.
17) `ent/session/configure`
    - Applies connectionId, modelId, approvalMode, environment (string:string), mcpServers (stdio only).
    - Unknown connection/model → InvalidParams.
    - ApprovalMode validation; environment replaced when changed; applied list accurate; config persists.
18) `ent/session/compact`
    - Strategies (truncate/summarize/selective if supported); invalid strategy → InvalidParams; SessionBusy handling.
19) `ent/session/rewind`
    - Rewinds to earlier eventSeq; invalid seq → error; SessionBusy handled.
20) `ent/session/checkpoint`
    - Creates checkpoint; returns files + eventSeq; label optional.
21) `session/list` (supporting API)
    - Lists sessions for workDir; invalid workDir → error; empty ok.
22) Notifications `session/update`
    - For prompt with tool use: text_delta/tool_use/turn_end present with turnSeq/turnId.
    - job_started/job_finished emitted for tool exec jobs.

Persistence checks
- Model gating stored in `provider-model-gating.json` and reloaded after restart.
- User catalog overrides survive restart.
- Session config (env, approvalMode, mcpServers) persists across session/load.

Fixtures & helpers
- Helper to spawn agent binary with temp `LACE_DIR` and workdir; returns send/recv JSON-RPC helpers.
- Fake provider instance creator with 2–3 models for gating tests.
- Helper to await notifications of a given type with timeout.
- JSON-RPC helper: request(method, params) → response/error; assert codes/messages.

Test files to add
- `packages/agent/tests/ent_protocol_spec.ts` (or `.test.ts`) covering the matrix above.
- `packages/agent/tests/helpers/agent.ts` (spawn, rpc helpers, notification waiters).
- Small fixture provider catalogs/instances under `tests/fixtures/` as needed.

Make target
- Add `ent-spec` target in `packages/agent/package.json` scripts or Makefile to run the suite.

Next steps
- Implement helpers, then fill out spec cases method by method.
- Ensure CI runs this suite (can be gated behind a job to keep runtime reasonable).

Completeness criteria
- Every ENT method documented in `docs/protocol-spec.md` and present in `packages/ent-protocol/src/schemas/methods.ts` has at least:
  - one happy-path test (where applicable)
  - one InvalidParams test (shape/type validation)
  - one NotFound/unknown-ID test (where applicable)
- Optional methods are gated by advertised capabilities from `initialize`.
