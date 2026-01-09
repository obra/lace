# Web + TUI ENT-only migration plan (single source of truth: agent)

## Goal

Make **both** UIs (web + TUI) manage providers, provider instances (connections), credentials, model catalogs, and model enable/disable **exclusively via the ENT JSON-RPC protocol**. No code in `packages/web` or `packages/tui` should import `packages/agent` provider/catalog/instance internals, or read/write agent config files directly.

## Non-goals

- Workspaces/projects in the TUI (TUI is single-agent, runs in the cwd where it launches).
- Backward compatibility shims (requires explicit approval from Jesse before implementing).
- “Perfect” UI/UX parity in the first pass; target functional parity first.

## What “ENT-only” means (hard rules)

- Web/TUI MUST NOT:
  - read `packages/agent/**/providers/**` catalog files
  - read/write `~/.lace/**` (agent-owned state) or any `provider-instances.json` / credential files
  - call `ProviderRegistry`, `ProviderInstanceManager`, `ProviderCatalogManager`, etc
- Web/TUI MAY:
  - start/own a supervisor session / agent process
  - call ENT methods (stdio JSON-RPC) through the supervisor
  - log ENT request/response metadata (with recursive secret redaction)

## Required reading (before coding)

- `docs/about-the-protocol.md`
- `docs/protocol-spec.md`
- `docs/protocol-conformance.md`
- `packages/ent-protocol/src/schemas/methods.ts`
- `packages/agent/src/server.ts` (ENT handlers)
- Web:
  - `packages/web/lib/server/supervisor-service.ts`
  - `packages/web/app/routes/api.provider.*.ts` (to be refactored)
- TUI:
  - `packages/tui/src/app/*` (state + RPC)
  - `packages/tui/src/ui/*` (screens)

## Workstreams (do in this order)

### 1) Spec + schemas (docs + `packages/ent-protocol`)

**Deliverable:** the spec explicitly supports everything the web provider UI needs.

TODO
- Confirm/clarify the canonical entities:
  - `providerId` = catalog provider type (e.g. `openai`, `openrouter`)
  - `connectionId` = provider instance id (user-managed)
- Ensure all provider-management behaviors have ENT methods and stable schemas:
  - list catalog providers
  - list/create/update/delete connections (including endpoint/timeout/modelConfig)
  - credentials start/submit/status/clear
  - list/refresh models per connection
  - enable/disable models (persisted by agent)
- Update `ModelInfo` to include `disabledState` (UI-friendly) and keep `disabled` for compatibility.

### 2) Conformance test suite (agent-owned, runs end-to-end)

**Deliverable:** an exhaustive conformance suite in `packages/agent` that:
1) documents “best practices” usage patterns
2) tests the agent’s ENT implementation end-to-end over stdio JSON-RPC

TODO
- Expand `packages/agent/src/__tests__/ent-protocol.spec.ts` to cover every ENT method:
  - at least 1 success case (where applicable)
  - key InvalidParams / NotFound / permission-denied cases
  - schema validation on both params and results
- Avoid network flakiness:
  - tests must not require real provider credentials
  - use deterministic fake catalogs where needed (mock `fetch` or env switches)

### 3) Web: refactor provider management routes to call ENT

**Deliverable:** `packages/web` provider settings page works with **zero** agent-library usage for provider/model management.

TODO
- Replace these routes to call ENT instead of `@lace/web/lib/server/lace-imports`:
  - `packages/web/app/routes/api.provider.catalog.ts`
  - `packages/web/app/routes/api.provider.instances.ts`
  - `packages/web/app/routes/api.provider.instances.$instanceId.ts`
  - `packages/web/app/routes/api.provider.instances.$instanceId.test.ts`
  - `packages/web/app/routes/api.provider.instances.$instanceId.refresh.ts`
  - `packages/web/app/routes/api.provider.instances.$instanceId.config.ts`
- Add a “provider management agent session” (cached singleton) in
  `packages/web/lib/server/supervisor-service.ts` that:
  - ensures an agent process exists even when no workspace/project session is active
  - is used exclusively by provider-management routes
- Delete/stop exporting provider-management internals from
  `packages/web/lib/server/lace-imports.ts` once unused.

### 4) TUI: implement web-parity provider management (single-agent)

**Deliverable:** TUI can fully manage providers like web:
- browse catalog providers
- create/update/delete connections
- set credentials
- refresh catalogs and models
- enable/disable models
- select last-used connection+model automatically

TODO
- Persist last-used `connectionId` + `modelId` in the agent (preferred) or TUI config (only if the agent can’t).
- Ensure TUI never reads catalog data from disk; only ENT calls.
- Fix UX issues:
  - command palette scroll
  - avoid interpreting `?` as help unless input is exactly `?` (or empty + `?`, per web behavior)

## Testing + validation

- `npm test` (root)
- `npm test` in `packages/web` (if needed)
- `npm test` in `packages/agent`
- `cargo test` in `packages/tui`
- Manual smoke (Jesse):
  - Web Settings → Providers:
    - list providers + instances
    - create instance, set creds, refresh, toggle models
  - TUI:
    - create connection, set creds, refresh models
    - select model, chat, restart without losing last selection

## Logging (do not leak secrets)

- Web: log ENT request/response **metadata** with recursive secret redaction.
- Agent: if logging raw ENT frames, redact secrets and write under the agent’s session directory.
- TUI: write a local debug log for ENT calls and agent stderr/stdout (redacted).

## Status (as of 2026-01-08)

This section is a living checklist. If it’s checked, it’s done and validated. If it’s unchecked, it’s still work.

### ✅ Completed (validated)

- [x] Protocol docs updated for provider/model management (`docs/about-the-protocol.md`, `docs/protocol-spec.md`, `docs/protocol-conformance.md`).
- [x] Protocol schema updated for `ModelInfo.disabledState` and `ent/providers/catalog` (`packages/ent-protocol`).
- [x] Agent implements `ent/providers/catalog`; `ent/models/list` includes `disabled` + `disabledState` (agent + supervisor).
- [x] Web provider management is ENT-only (instances CRUD, credentials, refresh, model enable/disable); web does not read/write agent provider config files directly.
- [x] Web persona catalog + persona validation are ENT-only (`ent/personas/list`).
- [x] Web tool policy UI uses `ToolPolicy` from `@lace/ent-protocol` (no agent type import).
- [x] Web session naming no longer depends on `ProviderRegistry` (generated via ENT `session/prompt`).
- [x] Web local logger (`packages/web/lib/logger.ts`) replaces agent logger usage; logging is gated by env var truthiness.
- [x] Test stability: `npm test` (repo root) passes; web Vitest thread pool is capped (`packages/web/vitest.config.ts`) to avoid `vitest-worker` `onTaskUpdate` timeouts.

### 🔎 Current “reach-ins” (generated from ripgrep)

Validated (2026-01-08):

- `rg -n "@lace/agent" packages/web` → 0 hits
- `rg -n "@lace/web/lib/server/lace-imports" packages/web` → 0 hits
- `rg -n "@lace/agent" packages/tui` → 0 hits
- TUI default agent spawn has no repo-relative `../agent/dist/*` assumptions

### 🧭 Remaining work checklist (to fully complete this plan)

#### A) “Definition of Done” checks (run repeatedly)

- [x] `rg -n "@lace/agent" packages/web` returns **0 runtime hits** (tests may remain temporarily only if explicitly allowed).
- [x] `rg -n "@lace/web/lib/server/lace-imports" packages/web` returns **0 runtime hits** (tests may remain temporarily only if explicitly allowed).
- [x] `rg -n "@lace/agent" packages/tui` returns **0 hits** (should be impossible; different language).
- [x] TUI has **no** repo-relative path assumptions to spawn the agent (`../agent/dist/*` etc.).
- [x] Web/TUI do not read/write `~/.lace/**` (agent-owned).
- [x] Provider/model/credentials management remains ENT-only (web + TUI).

#### B) Protocol spec + behavior confirmations (docs + schemas)

- [x] Add/confirm a glossary in docs:
  - [x] `providerId` = catalog provider type (e.g. `openai`)
  - [x] `connectionId` = user-managed provider instance id
- [x] Confirm and document semantics:
  - [x] `ent/models/enable` + `ent/models/disable` are **provider-global** (persisted), not session-scoped.
  - [x] `ent/models/list` always includes `disabled` + `disabledState`.
  - [x] `ent/providers/refresh` and `ent/models/refresh` semantics are documented in `docs/protocol-spec.md`.
  - [x] `ent/providers/catalog` is the single source of truth for the catalog provider list + metadata.

#### C) Agent ENT conformance suite (exhaustive; best practices + implementation test)

Goal: `packages/agent/src/__tests__/ent-protocol.spec.ts` covers every method in `packages/ent-protocol/src/schemas/methods.ts` with success + key negative cases.

Coverage checklist (must be exhaustive):

- [x] `initialize`
- [x] `$/cancel_request`
- [x] `session/new`
- [x] `session/load`
- [x] `session/list`
- [x] `session/fork`
- [x] `session/set_mode`
- [x] `session/prompt`
- [x] `session/update`
- [x] `session/request_permission`
- [x] `ent/agent/ping`
- [x] `ent/agent/status`
- [x] `ent/session/compact`
- [x] `ent/session/configure`
- [x] `ent/session/rewind`
- [x] `ent/session/checkpoint`
- [x] `ent/session/inject`
- [x] `ent/session/events`
- [x] `ent/providers/list`
- [x] `ent/providers/catalog`
- [x] `ent/providers/refresh`
- [x] `ent/connections/list`
- [x] `ent/connections/upsert`
- [x] `ent/connections/delete`
- [x] `ent/connections/test`
- [x] `ent/connections/credentials/status`
- [x] `ent/connections/credentials/start`
- [x] `ent/connections/credentials/submit`
- [x] `ent/connections/credentials/clear`
- [x] `ent/models/list`
- [x] `ent/models/refresh`
- [x] `ent/models/enable`
- [x] `ent/models/disable`
- [x] `ent/job/list`
- [x] `ent/job/output`
- [x] `ent/job/kill`
- [x] `ent/job/inject`
- [x] `ent/tools/list`
- [x] `ent/personas/list`
- [x] `ent/mcp/servers/list`
- [x] `ent/mcp/servers/upsert`
- [x] `ent/mcp/servers/delete`
- [x] `ent/mcp/servers/test`
- [x] `ent/mcp/tools/list`
- [x] `ent/workspace/info`
- [x] `ent/workspace/create`

Constraints:

- [x] No real provider credentials required; deterministic behavior only.
- [x] Tests validate schemas for both params and results (strict round-trip).
- [x] Key negative cases covered (InvalidParams / NotFound / permission denied) where applicable.

#### D) Web: remove remaining agent library usage (beyond provider management)

Direct `@lace/agent/*` imports to remove:

- [x] `packages/web/types/core.ts`: remove dependency on `@lace/agent/threads/types` (duplicate minimal shapes in web for now).
- [x] `packages/web/test-utils/web-test-setup.ts`: remove `@lace/agent/test-utils/temp-lace-dir` and `ProviderRegistry` usage.
- [x] `packages/web/components/sidebar/__tests__/AgentsSection.test.tsx`: remove agent provider test utils (not needed for this test).
- [x] `packages/web/components/sidebar/__tests__/SidebarContent-agent-creation.test.tsx`: same as above.
- [x] `packages/web/app/routes/__tests__/api.projects.integration.test.ts`: remove dynamic `@lace/agent/projects/project` (projects are now web-owned).
- [x] `packages/web/app/routes/__tests__/api.projects.$projectId.sessions.test.ts`: same as above.

Runtime imports of `@lace/web/lib/server/lace-imports` to remove:

- [x] Replace `ensureLaceDir` usage with web-local initialization:
  - [x] `packages/web/lib/server/data-dir-init.ts`
  - [x] `packages/web/lib/server/supervisor-service.ts`
- [x] Replace agent `Project` usage with web-owned project store in `~/.lace_web`:
  - [x] `packages/web/app/routes/api.projects.ts`
  - [x] `packages/web/app/routes/api.projects.$projectId.ts`
  - [x] `packages/web/app/routes/api.projects.$projectId.environment.ts`
  - [x] `packages/web/app/routes/api.projects.$projectId.sessions.$sessionId.ts`
  - [x] `packages/web/app/routes/api.projects.$projectId.configuration.ts`
  - [x] `packages/web/app/routes/api.projects.$projectId.mcp.servers.ts`
  - [x] `packages/web/app/routes/api.projects.$projectId.mcp.servers.$serverId.ts`
  - [x] `packages/web/app/routes/api.projects.$projectId.sessions.$sessionId.mcp.servers.ts`
  - [x] `packages/web/app/routes/api.projects.$projectId.sessions.$sessionId.mcp.servers.$serverId.control.ts`
- [x] Replace agent settings/MCP config loaders with web-owned stores in `~/.lace_web`:
  - [x] `packages/web/app/routes/api.settings.ts` (uses `UserSettingsManager` in web)
  - [x] `packages/web/app/routes/api.mcp.servers.ts` / `api.mcp.servers.$serverId.ts` (uses `McpConfigStore` in web)
- [x] Ensure `packages/web/lib/server/lace-imports.ts` has **no** `@lace/agent/*` imports (deprecated legacy surface only).

#### E) TUI: web-parity provider management (single-agent) + ENT-only

Hard-rule fix first:

- [x] `packages/tui/src/ui/mod.rs`: remove hardcoded `../agent/dist/main.js` default agent path (no repo-layout coupling).
- [x] TUI stores state/logs under its own dir (defaults to `~/.lace_tui`, override with `LACE_TUI_DIR`), not `~/.lace/**`.

Parity checklist:

- [x] Provider catalog selection uses `ent/providers/catalog` (not only `ent/providers/list`).
- [x] Connection CRUD:
  - [x] list (`ent/connections/list`)
  - [x] create/update (`ent/connections/upsert`)
  - [x] delete (`ent/connections/delete`)
- [x] Credentials:
  - [x] status (`ent/connections/credentials/status`)
  - [x] start (`ent/connections/credentials/start`)
  - [x] submit (`ent/connections/credentials/submit`)
  - [x] clear (`ent/connections/credentials/clear`)
- [x] Models:
  - [x] selection list (“Models…”) shows enabled models only (`ent/models/list`)
  - [x] enable/disable is managed via “Connections…” → “Models…” (`ent/models/enable`, `ent/models/disable`)
  - [x] refresh wired via `ent/models/refresh` (no tight loop/spam)
  - [x] selection (`ent/session/configure`) works from both “Configure” and “Models…” screens
- [x] Persistence:
  - [x] last-used `connectionId` + `modelId` restored automatically (currently TUI prefs)
- [x] UX parity:
  - [x] command palette scrolls
  - [x] help toggle requires bare `F1` with no modifiers (avoids terminals mapping `?` → `F1`+Shift)
  - [x] Diagnostics:
  - [x] TUI writes a redacted ENT protocol log + agent stderr log to disk and shows the file path in the UI.

### Decisions required (do not implement without alignment)

- [x] Projects/workspaces ownership: **web-owned** (backward incompatible; stored in `~/.lace_web`).
- [x] MCP config ownership: **web-owned** for web UI config (stored in `~/.lace_web`), passed to agents via ENT when starting sessions.
- [x] User settings ownership: **web-owned** (stored in `~/.lace_web`).

### Definition of Done

- [x] Provider/model/credentials management: web + TUI are ENT-only.
- [x] Web runtime has no `@lace/agent/*` imports and no runtime use of `@lace/web/lib/server/lace-imports`.
- [x] TUI has no repo-layout coupling to spawn the agent and no `@lace/agent/*` imports.
- [x] Agent ENT conformance suite is exhaustive (every method covered with success + key negative cases).
- [x] `npm test` (root) passes.
