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

Completed
- Spec/schemas updated for `ModelInfo.disabledState` and `ent/providers/catalog`.
- Agent implements `ent/providers/catalog`; supervisor forwards it.
- `ent/models/list` returns `disabled` + `disabledState`.
- Web provider-management routes are ENT-backed:
  - `GET /api/provider/catalog` → `ent/providers/catalog`
  - Instances CRUD/credentials/model refresh/config → `ent/connections/*` + `ent/models/*`

Audit findings (remaining agent-library usage in web)
- Runtime: `packages/web/app/routes/api.projects.$projectId.sessions.ts` uses `ProviderRegistry` to create an ad-hoc provider for session naming (should be moved to ENT to fully decouple).
- Runtime: many routes still import `@lace/agent/*` via `packages/web/lib/server/lace-imports.ts` for non-provider features (projects, personas, tools, MCP config, user settings).
- Client: avoid importing `packages/web/lib/server/lace-imports.ts` into React components; keep provider UI types local (started for provider UI).

## Audit: Remaining Agent-Library Reach-Ins (packages/web)

This is the exhaustive inventory as of 2026-01-08 (generated from `rg @lace/agent packages/web` and `rg lace-imports packages/web`).

### A) Direct `@lace/agent/*` imports (runtime)

- `packages/web/lib/event-stream-manager.ts`: imports `@lace/agent/utils/logger`.
  - TODO: replace with a web-local logger (or a supervisor logger) so web does not depend on agent internals.
- `packages/web/lib/server/api-utils.ts`: imports `@lace/agent/utils/logger`.
  - TODO: same as above.
- `packages/web/lib/server/supervisor-service.ts`: imports `@lace/agent/utils/logger`.
  - TODO: same as above.
- `packages/web/app/routes/api.sessions.$sessionId.files.$path.ts`: imports `@lace/agent/utils/logger`.
  - TODO: same as above.
- `packages/web/app/routes/api.sessions.$sessionId.workspace.ts`: imports `@lace/agent/utils/logger`.
  - TODO: same as above.
- `packages/web/app/routes/api.threads.$threadId.message.ts`: imports `@lace/agent/utils/logger`.
  - TODO: same as above.
- `packages/web/app/routes/api.tunnel.ts`: imports `@lace/agent/utils/logger`.
  - TODO: same as above.
- `packages/web/app/routes/api.mcp.servers.ts`: imports `@lace/agent/utils/logger`.
  - TODO: same as above.

### B) Direct `@lace/agent/*` imports (client + shared types)

- `packages/web/lib/tool-policy-resolver.ts`: imports `ToolPolicy` type from `@lace/agent/tools/types`.
  - TODO: migrate these types to `@lace/ent-protocol` (preferred) or duplicate the minimal type shapes in `packages/web/types/`.
- `packages/web/components/ui/ToolPolicyToggle.tsx`: imports `ToolPolicy` type from `@lace/agent/tools/types`.
  - TODO: same as above.
- `packages/web/components/pages/AgentPageContent.tsx`: imports `PermissionOverrideMode` type from `@lace/agent/tools/types`.
  - TODO: migrate to `@lace/ent-protocol` or duplicate minimal types in web.
- `packages/web/components/ui/PermissionModeSelector.tsx`: imports `PermissionOverrideMode` type from `@lace/agent/tools/types`.
  - TODO: same as above.
- `packages/web/components/sidebar/SessionSection.tsx`: imports `PermissionOverrideMode` type from `@lace/agent/tools/types`.
  - TODO: same as above.
- `packages/web/types/core.ts`: imports runtime event types from `@lace/agent/threads/types`.
  - TODO: define these event payload types in the protocol (`@lace/ent-protocol`) if they are part of the wire contract, or duplicate the minimal shapes in web.

### C) Direct `@lace/agent/*` imports (tests)

- `packages/web/server.test.ts`: mocks/imports `@lace/agent/utils/logger`.
  - TODO: once web stops importing agent logger, remove this test mocking dependency.
- `packages/web/test-utils/web-test-setup.ts`: imports `@lace/agent/test-utils/temp-lace-dir` and `ProviderRegistry`.
  - TODO: replace with a web-owned temp lace-dir helper (or supervisor-owned helper) and remove `ProviderRegistry` usage.
- `packages/web/components/sidebar/__tests__/AgentsSection.test.tsx`: imports agent provider test-utils.
  - TODO: replace with test fixtures driven through ENT (preferred) or move these test utilities into a test-only shared package that is not `packages/agent`.
- `packages/web/components/sidebar/__tests__/SidebarContent-agent-creation.test.tsx`: imports agent provider test-utils.
  - TODO: same as above.
- `packages/web/app/routes/__tests__/api.projects.integration.test.ts`: dynamically imports `@lace/agent/projects/project`.
  - TODO: replace with a web-owned Project implementation or ENT-driven project management (see section E below).
- `packages/web/app/routes/__tests__/api.projects.$projectId.sessions.test.ts`: dynamically imports `@lace/agent/projects/project`.
  - TODO: same as above.

### D) Indirect dependencies via `@lace/web/lib/server/lace-imports` (runtime + tests)

`packages/web/lib/server/lace-imports.ts` re-exports agent internals. Every importer below is “reaching into agent” even though it’s not a direct `@lace/agent/*` import.

Files importing `@lace/web/lib/server/lace-imports`:
- `packages/web/lib/server/data-dir-init.ts`: `ensureLaceDir`.
  - TODO: move `ensureLaceDir` into supervisor (preferred) or into a web-local helper so web does not depend on agent config code.
- `packages/web/lib/server/supervisor-service.ts`: `ensureLaceDir`.
  - TODO: same as above.
- `packages/web/app/routes/api.projects.ts`: `Project`.
  - TODO: see section E.
- `packages/web/app/routes/api.projects.$projectId.ts`: `Project`.
  - TODO: see section E.
- `packages/web/app/routes/api.projects.$projectId.environment.ts`: `Project`.
  - TODO: see section E.
- `packages/web/app/routes/api.projects.$projectId.sessions.$sessionId.ts`: `Project`.
  - TODO: see section E.
- `packages/web/app/routes/api.projects.$projectId.mcp.servers.ts`: `Project`.
  - TODO: see section E + MCP management note below.
- `packages/web/app/routes/api.projects.$projectId.mcp.servers.$serverId.ts`: `Project`.
  - TODO: see section E + MCP management note below.
- `packages/web/app/routes/api.projects.$projectId.sessions.$sessionId.mcp.servers.ts`: `Project`.
  - TODO: see section E + MCP management note below.
- `packages/web/app/routes/api.projects.$projectId.sessions.$sessionId.mcp.servers.$serverId.control.ts`: `Project`.
  - TODO: see section E + MCP management note below.
- `packages/web/app/routes/api.projects.$projectId.configuration.ts`: `Project`, `ToolCatalog`.
  - TODO: `ToolCatalog` should become ENT-driven (`ent/tools/list`) and project config should be moved out of agent (see section E).
- `packages/web/app/routes/api.projects.$projectId.sessions.ts`: `Project`, `ProviderRegistry`.
  - TODO: remove `ProviderRegistry` by doing session naming via ENT:
    - create a helper agent session (already exists)
    - configure it via `ent/session/configure`
    - call `session/prompt` to generate a title
    - update workspace session name via supervisor
- `packages/web/app/routes/api.settings.ts`: `UserSettingsManager`.
  - TODO: needs ENT methods for user settings OR relocate settings storage into supervisor/web (decision needed).
- `packages/web/app/routes/api.mcp.servers.ts`: `MCPConfigLoader`, `ToolCatalog`.
  - TODO: needs ENT methods for MCP server config management OR relocate MCP config management out of agent (decision needed).
- `packages/web/app/routes/api.mcp.servers.$serverId.ts`: `MCPConfigLoader`.
  - TODO: same as above.
- `packages/web/app/routes/api.sessions.$sessionId.agents.ts`: `personaRegistry`.
  - TODO: replace with `ent/personas/list` and remove registry access.
- `packages/web/app/routes/api.persona.catalog.ts`: `personaRegistry`, `PersonaInfo`.
  - TODO: replace with `ent/personas/list` and a web-local type derived from the protocol schema.

Test-only importers of `@lace/web/lib/server/lace-imports` (should be cleaned up after runtime paths are migrated):
- `packages/web/app/routes/__tests__/session-approval-api.integration.test.ts`
- `packages/web/app/routes/__tests__/api.threads.$threadId.message.test.ts`
- `packages/web/app/routes/__tests__/api.agents.$agentId.history.test.ts`
- `packages/web/app/routes/__tests__/api.sessions.$sessionId.agents-message-flow.test.ts`
- `packages/web/app/routes/__tests__/api.sessions.$sessionId.agents-persona-prompts.test.ts`
- `packages/web/app/routes/__tests__/api.sessions.$sessionId.agents-persona.test.ts`
- `packages/web/app/routes/__tests__/api.sessions.$sessionId.agents.test.ts`
- `packages/web/app/routes/__tests__/api.projects.$projectId.integration.test.ts`
- `packages/web/app/routes/__tests__/api.projects.$projectId.sessions.$sessionId.mcp.servers.$serverId.control.test.ts`
- `packages/web/app/routes/__tests__/api.projects.$projectId.sessions.$sessionId.mcp.servers.test.ts`
- `packages/web/app/routes/__tests__/api.projects.$projectId.sessions.$sessionId.test.ts`
- `packages/web/app/routes/__tests__/api.projects.$projectId.sessions.test.ts`
- `packages/web/app/routes/__tests__/api.projects.integration.test.ts`
- `packages/web/app/routes/api.settings.test.ts`
- `packages/web/lib/server/__tests__/session-naming-helper.test.ts`

### E) Decisions / Protocol Gaps (required before full “no agent libs”)

These are architectural decisions we should make together (do not implement without alignment):

- Projects/workspaces config currently uses `Project` (agent library). Options:
  1) Move project management out of `packages/agent` into a shared non-agent package (so web can own it without reaching into agent).
  2) Make projects/workspaces fully agent-owned and expose project CRUD/config via ENT (new methods).
- MCP config + user settings are currently read via agent config managers (`MCPConfigLoader`, `UserSettingsManager`). Options:
  1) Make them agent-owned and expose via ENT (new methods).
  2) Move them to supervisor/web-owned storage in a non-agent package.
- Tool policies/types are currently defined in agent. Options:
  1) Promote types and tool-policy-related schemas into `@lace/ent-protocol`.
  2) Duplicate minimal types in `packages/web` until the protocol owns them.

### Definition of Done (web-side “no agent libs”)

- `rg -n \"@lace/agent\" packages/web` has **zero** runtime hits (tests may be allowed temporarily if we explicitly decide so).
- `rg -n \"@lace/web/lib/server/lace-imports\" packages/web` is either empty or restricted to test-only helpers that are not agent internals.
- Provider/model/credentials management remains ENT-only (already done).
