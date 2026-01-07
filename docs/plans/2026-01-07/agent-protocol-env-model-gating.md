# Plan: Agent Protocol Env + Provider Model Gating + Catalog Refresh

Date: 2026-01-07
Author: Bot

## Goals
- Implement protocol support in the agent for:
  1) `ent/session/configure` environment overlay (no `cwd`).
  2) `ent/providers/refresh` (catalog refresh).
  3) Provider-global model gating via `ent/models/enable` and `ent/models/disable` (persisted by agent, not web).
- Keep web/supervisor off agent internals; all flows go through Ent.
- Adhere to TDD, YAGNI, DRY; prefer clear/pragmatic code over cleverness.

## What to read first
- docs/protocol-spec.md: §§6.3 (session/configure), 6.14–6.27 (providers/models) after latest edits.
- packages/ent-protocol/src/schemas/methods.ts: existing provider/model schemas and session/configure schema (env only).
- packages/agent/src/server.ts: patterns for Ent handlers (providers/models/session/configure).
- Provider infra:
  - packages/agent/providers/catalog/manager.ts
  - packages/agent/providers/registry.ts
  - packages/agent/providers/catalog/types.ts
- Session state persistence: packages/agent/src/session/state.ts
- Tool env merge: packages/agent/src/tools/executor.ts
- Tests layout: packages/ent-protocol/src/__tests__, packages/agent/src/**/__tests__

## Scope boundary
- No `cwd` support in `ent/session/configure`.
- Model gating is provider-global, stored by agent (not per connection, not per session, not in web files).
- Do not touch web code or lace-imports.

## Work breakdown (TDD-first)
1) **Schemas (ent-protocol)**
   - Add request/response schemas: `ent/providers/refresh`, `ent/models/enable`, `ent/models/disable`.
   - Update union exports so peer accepts them.
   - Add schema tests for validation/happy path.

2) **Agent capabilities**
   - In init response, advertise `"ent/providers": { list:true, connections:true, models:true, catalogRefresh:true, modelGating:true }`.

3) **Agent handlers (server.ts)**
   - `ent/providers/refresh`: refresh catalog (all or providerId), return { ok, refreshedAt, error? }; idempotent.
   - `ent/models/enable` / `ent/models/disable`:
     - Validate providerId exists; all modelIds exist else error.
     - Update provider-global gating state (persisted by agent; see persistence below).
     - Return { providerId, enabled, disabled }; idempotent.
   - `ent/models/list`: apply provider-level gating: disabled set excludes; if enabled set present, allow-list.
   - `ent/session/configure`: accept `environment` (strings). Merge into session config; add to `applied`. No cwd.

4) **Environment plumbing**
   - ToolExecutor: merge session env overlay into processEnv before execute.
   - Verify subprocess/workspace runners already pass context.processEnv; plumb if missing (minimal changes only).

5) **Persistence for model gating (agent-owned)**
   - Add provider-level gating storage in agent-controlled config (e.g., via ProviderCatalogManager or ProviderRegistry). Keep it simple and DRY; no web writes.
   - Ensure `ent/models/enable|disable` reads/writes this store; `ent/models/list` reads it.

6) **Tests**
   - ent-protocol schema tests for new methods.
   - Agent tests:
     - providers/refresh ok & providerId filter & unknown provider error.
     - models enable/disable: happy path, idempotent, unknown model error, list respects gating.
     - session/configure env: applied contains "environment"; a simple tool sees merged env.
     - Capability flags include catalogRefresh/modelGating.

7) **Docs alignment**
   - Verify docs/protocol-spec.md matches implementation (no cwd; provider-global gating persisted by agent).
   - Note isolation: web/supervisor must not read/write agent provider/model files.

## Design choices (follow these)
- cwd: not supported; agent uses session.meta.workDir as execution root.
- Model gating: keyed by providerId, persisted by agent, not session-scoped.
- Idempotency: enable/disable are no-ops if already in desired state; unknown modelIds error.
- Isolation: no web-side file access; all persistence stays in agent-owned files.

## What NOT to do
- Don’t reintroduce cwd to the protocol or code paths.
- Don’t store gating per connection or per session.
- Don’t let web read/write agent provider/catalog files.
- Don’t skip model existence validation.
- Don’t get clever—prefer small, readable diffs.

