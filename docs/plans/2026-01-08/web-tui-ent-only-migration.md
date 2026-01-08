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
  - read/write `~/.lace/**` or any `provider-instances.json` / credential files
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
- [x] Test stability: `npm test` (repo root) passes; web Vitest output is reduced to avoid `vitest-worker` `onTaskUpdate` timeouts.

### 🔎 Current “reach-ins” (generated from ripgrep)

Direct `@lace/agent/*` imports in web (as of 2026-01-08):

- `packages/web/test-utils/web-test-setup.ts` (`@lace/agent/test-utils/temp-lace-dir`, `@lace/agent/providers/registry`)
- `packages/web/types/core.ts` (`@lace/agent/threads/types`)
- `packages/web/app/routes/__tests__/api.projects.integration.test.ts` (dynamic `@lace/agent/projects/project`)
- `packages/web/app/routes/__tests__/api.projects.$projectId.sessions.test.ts` (dynamic `@lace/agent/projects/project`)
- `packages/web/components/sidebar/__tests__/AgentsSection.test.tsx` (agent provider test utils)
- `packages/web/components/sidebar/__tests__/SidebarContent-agent-creation.test.tsx` (agent provider test utils)
- `packages/web/lib/server/lace-imports.ts` (re-exports many `@lace/agent/*`)

Runtime imports of `@lace/web/lib/server/lace-imports` (as of 2026-01-08):

- `packages/web/lib/server/data-dir-init.ts`
- `packages/web/lib/server/supervisor-service.ts`
- `packages/web/app/routes/api.projects.ts`
- `packages/web/app/routes/api.projects.$projectId.ts`
- `packages/web/app/routes/api.projects.$projectId.environment.ts`
- `packages/web/app/routes/api.projects.$projectId.sessions.$sessionId.ts`
- `packages/web/app/routes/api.projects.$projectId.configuration.ts`
- `packages/web/app/routes/api.projects.$projectId.mcp.servers.ts`
- `packages/web/app/routes/api.projects.$projectId.mcp.servers.$serverId.ts`
- `packages/web/app/routes/api.projects.$projectId.sessions.$sessionId.mcp.servers.ts`
- `packages/web/app/routes/api.projects.$projectId.sessions.$sessionId.mcp.servers.$serverId.control.ts`
- `packages/web/app/routes/api.mcp.servers.ts`
- `packages/web/app/routes/api.mcp.servers.$serverId.ts`
- `packages/web/app/routes/api.settings.ts`

TUI reach-in (repo-layout coupling; must be removed):

- `packages/tui/src/ui/mod.rs` references `../agent/dist/main.js` (hardcoded relative path).

### 🧭 Remaining work checklist (to fully complete this plan)

#### A) “Definition of Done” checks (run repeatedly)

- [ ] `rg -n "@lace/agent" packages/web` returns **0 runtime hits** (tests may remain temporarily only if explicitly allowed).
- [ ] `rg -n "@lace/web/lib/server/lace-imports" packages/web` returns **0 runtime hits** (tests may remain temporarily only if explicitly allowed).
- [ ] `rg -n "@lace/agent" packages/tui` returns **0 hits**.
- [ ] TUI has **no** repo-relative path assumptions to spawn the agent (`../agent/dist/*` etc.).
- [ ] Provider/model/credentials management remains ENT-only (web + TUI).

#### B) Protocol spec + behavior confirmations (docs + schemas)

- [ ] Add/confirm a glossary in docs:
  - [ ] `providerId` = catalog provider type (e.g. `openai`)
  - [ ] `connectionId` = user-managed provider instance id
- [ ] Confirm and document semantics:
  - [ ] `ent/models/enable` + `ent/models/disable` are **global-per-connection** (persisted), not session-scoped.
  - [ ] `ent/models/list` always includes `disabled` + `disabledState`.
  - [ ] `ent/providers/refresh` and `ent/models/refresh` timing guarantees (what “refresh” means; whether it’s async; what to poll).
  - [ ] `ent/providers/catalog` is the single source of truth for the catalog provider list + metadata.

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

- [ ] No real provider credentials required; deterministic behavior only.
- [ ] Tests validate schemas for both params and results (strict round-trip).
- [ ] Key negative cases covered (InvalidParams / NotFound / permission denied) where applicable.

#### D) Web: remove remaining agent library usage (beyond provider management)

Direct `@lace/agent/*` imports to remove:

- [x] `packages/web/types/core.ts`: remove dependency on `@lace/agent/threads/types` (duplicate minimal shapes in web for now).
- [x] `packages/web/test-utils/web-test-setup.ts`: remove `@lace/agent/test-utils/temp-lace-dir` and `ProviderRegistry` usage.
- [x] `packages/web/components/sidebar/__tests__/AgentsSection.test.tsx`: remove agent provider test utils (not needed for this test).
- [x] `packages/web/components/sidebar/__tests__/SidebarContent-agent-creation.test.tsx`: same as above.
- [ ] `packages/web/app/routes/__tests__/api.projects.integration.test.ts`: remove dynamic `@lace/agent/projects/project` (blocked by project ownership decision below).
- [ ] `packages/web/app/routes/__tests__/api.projects.$projectId.sessions.test.ts`: same as above.

Runtime imports of `@lace/web/lib/server/lace-imports` to remove (blocked by decisions below):

- [ ] Replace `ensureLaceDir` usage with supervisor/web-owned initialization:
  - [ ] `packages/web/lib/server/data-dir-init.ts`
  - [ ] `packages/web/lib/server/supervisor-service.ts`
- [ ] Replace agent `Project` usage (projects/workspaces decision):
  - [ ] `packages/web/app/routes/api.projects.ts`
  - [ ] `packages/web/app/routes/api.projects.$projectId.ts`
  - [ ] `packages/web/app/routes/api.projects.$projectId.environment.ts`
  - [ ] `packages/web/app/routes/api.projects.$projectId.sessions.$sessionId.ts`
  - [ ] `packages/web/app/routes/api.projects.$projectId.configuration.ts`
  - [ ] `packages/web/app/routes/api.projects.$projectId.mcp.servers.ts`
  - [ ] `packages/web/app/routes/api.projects.$projectId.mcp.servers.$serverId.ts`
  - [ ] `packages/web/app/routes/api.projects.$projectId.sessions.$sessionId.mcp.servers.ts`
  - [ ] `packages/web/app/routes/api.projects.$projectId.sessions.$sessionId.mcp.servers.$serverId.control.ts`
- [ ] Replace agent settings/MCP config loaders (ownership decision):
  - [ ] `packages/web/app/routes/api.settings.ts`
  - [ ] `packages/web/app/routes/api.mcp.servers.ts`
  - [ ] `packages/web/app/routes/api.mcp.servers.$serverId.ts`
- [ ] Cleanup `packages/web/lib/server/lace-imports.ts` after runtime is migrated (prefer delete).

#### E) TUI: web-parity provider management (single-agent) + ENT-only

Hard-rule fix first:

- [ ] `packages/tui/src/ui/mod.rs`: remove hardcoded `../agent/dist/main.js` default agent path (no repo-layout coupling).

Parity checklist:

- [ ] Provider catalog view uses `ent/providers/catalog` (not only `ent/providers/list`).
- [ ] Connection CRUD:
  - [ ] list (`ent/connections/list`)
  - [ ] create/update (`ent/connections/upsert`)
  - [ ] delete (`ent/connections/delete`)
- [ ] Credentials:
  - [ ] status (`ent/connections/credentials/status`)
  - [ ] start (`ent/connections/credentials/start`)
  - [ ] submit (`ent/connections/credentials/submit`)
  - [ ] clear (`ent/connections/credentials/clear`)
- [ ] Models:
  - [ ] list (`ent/models/list`) shows `disabled` + `disabledState`
  - [ ] enable/disable (`ent/models/enable`, `ent/models/disable`)
  - [ ] refresh (`ent/models/refresh` and/or `ent/providers/refresh`) wired without tight loops/spam
  - [ ] selection (`ent/session/configure`) works from both “Configure” and “Models…” screens
- [ ] Persistence:
  - [ ] last-used `connectionId` + `modelId` restored automatically (agent-owned preferred; otherwise TUI config as fallback only if agent can’t)
- [ ] UX parity:
  - [ ] command palette scrolls
  - [ ] `?` help only triggers when input is exactly `?`
- [ ] Diagnostics:
  - [ ] TUI writes a redacted ENT protocol log + agent stderr log to disk and shows the file path in the UI.

### Decisions required (do not implement without alignment)

- [ ] Projects/workspaces ownership:
  - [ ] Option A: move Project/workspace logic out of `packages/agent` into a shared non-agent package
  - [ ] Option B: make projects/workspaces agent-owned and expose CRUD/config over ENT
- [ ] MCP config ownership:
  - [ ] Option A: agent-owned, ENT-managed
  - [ ] Option B: supervisor/web-owned storage in a non-agent package
- [ ] User settings ownership:
  - [ ] Option A: agent-owned, ENT-managed
  - [ ] Option B: supervisor/web-owned storage in a non-agent package

### Definition of Done

- [ ] Provider/model/credentials management: web + TUI are ENT-only.
- [ ] Web runtime has no `@lace/agent/*` imports and no runtime use of `@lace/web/lib/server/lace-imports`.
- [ ] TUI has no repo-layout coupling to spawn the agent and no `@lace/agent/*` imports.
- [x] Agent ENT conformance suite is exhaustive (every method covered with success + key negative cases).
- [ ] `npm test` (root) passes.
