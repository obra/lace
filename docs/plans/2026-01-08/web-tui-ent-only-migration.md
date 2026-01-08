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

