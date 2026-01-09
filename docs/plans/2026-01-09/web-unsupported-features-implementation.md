# Web “Not Supported” features — implementation plan (post ENT-only migration)

Jesse — this plan covers the remaining **web** features that are currently labeled “not supported” (excluding the file API and browser feature gates, per your request).

## Scope (what we are fixing)

1) **Context visualizer / token usage**
- Web UI has `ContextBreakdownModal` + `ContextTreemap`, but `GET /api/agents/:agentId/context` returns `501 NOT_SUPPORTED`.
- Web agent detail currently returns `tokenUsage: undefined`.

2) **Session tool permissions (“toolPolicies”)**
- Web has tool policy UI/state and a resolver, but session-level tool policies are explicitly unsupported in API tests (`api.sessions.$sessionId.configuration.tool-permissions.test.ts`).
- Today, only coarse `approvalMode` exists on the agent (`ent/session/configure`), and user approvals happen through supervisor.

3) **Provider credential `additionalAuth`**
- Web accepts `credential.additionalAuth` in input schema, but rejects it with `CREDENTIAL_ADDITIONAL_AUTH_UNSUPPORTED`.
- Root cause: ENT `ent/connections/credentials/submit` only allows `values: Record<string,string>`.

## Non-goals / constraints

- Do **not** touch file API limitations (symlink/binary rules) or browser features (speech input).
- Keep web/tui ENT-only boundaries intact (no reading `~/.lace/**` in UIs; no agent-library reach-ins).
- No backward compatibility shims without explicit approval from you.
- TDD: add/adjust tests *first* for each feature, then implement.

## Required reading (minimal)

- Protocol + schemas
  - `docs/protocol-spec.md`
  - `packages/ent-protocol/src/schemas/methods.ts`
  - `packages/ent-protocol/src/types/shared.ts`
- Agent
  - `packages/agent/src/server.ts` (ENT handlers)
  - `packages/agent/src/storage/session-store.ts` (what’s persisted)
  - `packages/agent/src/utils/token-estimation.ts` (token estimation)
  - `packages/agent/src/token-management/context-breakdown-types.ts` (types only today)
- Supervisor + web bridging
  - `packages/supervisor/src/supervisor.ts` (wrappers)
  - `packages/web/lib/server/supervisor-service.ts` (agentRequest/agentNotify + logging)
  - Web API routes:
    - `packages/web/app/routes/api.agents.$agentId.ts`
    - `packages/web/app/routes/api.agents.$agentId.context.ts`
    - `packages/web/app/routes/api.sessions.$sessionId.configuration.ts`
    - `packages/web/app/routes/api.provider.instances.ts`

## Work plan (ordered)

### A) Context visualizer + token usage (end-to-end)

#### A1) Decide the protocol surface (smallest reasonable)

We need two pieces:
- **Totals** (input/output/total tokens, cost, limits)
- **Breakdown** (categories for visualization)

Proposed ENT additions (new methods; cleaner than overloading `ent/agent/status`):
- `ent/session/token_usage`
  - returns:
    - totals `{ inputTokens, outputTokens, totalTokens }`
    - `contextLimit` (if known) + `percentUsed` + `nearLimit`
    - cost summary `{ costUsd, maxBudgetUsd?, budgetUsedUsd? }`
- `ent/session/context_breakdown`
  - returns a `ContextBreakdown` tree/flat list (matching web’s `packages/web/types/context.ts`)
  - includes `contextLimit` and totals so UI doesn’t have to call two endpoints if we don’t want it

Notes:
- This stays session-scoped (fits the feature) and avoids leaking UI concerns into `ent/agent/status`.
- If you’d rather not add methods, fallback is to extend `ent/agent/status` + add `ent/session/context_breakdown` only.

#### A2) TDD: add protocol tests first

Files:
- `packages/ent-protocol/src/schemas/methods.ts`
- `packages/ent-protocol/src/__tests__/methods-*.test.ts` (add schema tests)
- `packages/agent/src/__tests__/ent-protocol.spec.ts` (agent conformance)

Tests to add:
- Schema validation for both new methods (params/results).
- Agent conformance:
  - After `session/new`, `ent/session/token_usage` returns zeros and a valid shape.
  - After a deterministic `session/prompt` using the test provider, totals become `> 0`.
  - `ent/session/context_breakdown` returns a stable shape with non-negative token counts.
  - Negative cases:
    - calling without an active session → `SessionNotFound`
    - invalid params (wrong types) → `InvalidParams`

#### A3) Agent implementation

Files:
- `packages/agent/src/server.ts`
- (likely) new helper module: `packages/agent/src/token-management/context-breakdown.ts` (implementation)
- `packages/agent/src/token-management/context-breakdown-types.ts` (may need small type tweaks if web needs extra fields)

Implementation approach (pragmatic; works offline):
- Totals:
  - reuse `state.activeSession.state.tokenUsage` (already persisted)
  - reuse `state.activeSession.state.sessionCostUsd` (already persisted)
- `contextLimit`:
  - use current effective `connectionId` + `modelId`
  - look up model info via the provider model catalog already used by `ent/models/list` (or the same internal provider resolution used by prompting)
  - if unknown, omit `contextLimit` and set `percentUsed` to `0` (explicitly documented)
- Breakdown:
  - reconstruct the effective “prompt inputs” from durable events:
    - system/context injection events
    - user prompts
    - assistant messages
    - tool calls/results (if included in context)
  - compute token counts via `estimateTokens` (clearly document “estimated” vs provider-reported)
  - group into the categories expected by the web treemap (keep the category list stable)

Output requirements:
- counts must be deterministic for tests (use the test provider + deterministic token estimation).
- must not include secrets in breakdown labels.

#### A4) Supervisor + web wiring

Web route updates (TDD-first):
- `packages/web/app/routes/api.agents.$agentId.ts`
  - set `tokenUsage` from ENT `ent/session/token_usage`
- `packages/web/app/routes/api.agents.$agentId.context.ts`
  - replace `501 NOT_SUPPORTED` with an ENT call to `ent/session/context_breakdown`

Update web tests:
- Replace the “not supported” assertions in:
  - `packages/web/app/api/compaction-simple.test.ts`
  - `packages/web/app/api/compaction-integration.test.ts`
  with positive assertions about returned `tokenUsage`/breakdown.

UI:
- `ContextBreakdownModal` already calls `/api/agents/${agentId}/context`; it should “just work” once the route is implemented.

### B) Session tool permissions (`toolPolicies`)

#### B1) Clarify ownership (where the policy is enforced)

Tool approval requests are currently mediated by supervisor/web, not the agent. That means:
- The agent can **request** permissions.
- The supervisor/web decides **allow/deny**.

So tool policies should be enforced in the **supervisor layer** (ideal), not in the agent.

Proposed behavior:
- Store session `toolPolicies` in the supervisor store (alongside agent session meta).
- When a permission request arrives:
  - if policy says `allow` → auto-allow (no pending entry)
  - if `deny`/`disable` → auto-deny
  - if `ask` or missing → create pending permission as today

This keeps the decision authority in the same place as interactive approvals.

#### B2) TDD: tests first

Where to test:
- `packages/supervisor/src/__tests__/...` (new E2E-style test)
  - configure a workspace session with `toolPolicies: { bash: 'deny' }`
  - prompt a command that would invoke `bash`
  - assert the permission request is auto-denied (no pending list item; agent receives denial)
- `packages/web/app/routes/__tests__/api.sessions.$sessionId.configuration.tool-permissions.test.ts`
  - flip from “unsupported” to “supported”:
    - GET includes `toolPolicies`
    - PUT accepts updates and persists them

#### B3) Implementation

Files (likely):
- `packages/supervisor/src/workspace-session-store.ts`
  - extend persisted agent meta to include `toolPolicies` for the workspace session and/or agent session
- `packages/supervisor/src/pending-permissions-tracker.ts`
  - apply tool policy before creating a pending request
- `packages/supervisor/src/supervisor.ts`
  - plumb policy config into the permission callback path
- `packages/web/app/routes/api.sessions.$sessionId.configuration.ts`
  - accept and persist session tool policy changes

Web UI:
- Session edit modal already manipulates `toolPolicies`; once the API accepts it, this becomes functional.

Key details:
- Reuse the existing `ToolPolicy` type from `@lace/ent-protocol`.
- Apply “progressive restriction” rules (web already has a resolver + validator); decide whether enforcement belongs in web API or supervisor:
  - Suggested: validate in web API for friendly errors; supervisor also guards against invalid values.

### C) Provider credentials: `additionalAuth`

#### C1) Extend ENT schema

Current: `ent/connections/credentials/submit` only allows `values: Record<string,string>`.

Proposed minimal extension:
- allow an optional `additionalAuth` field:
  - `additionalAuth?: Record<string, unknown>`
- keep `values` as string map (don’t break existing clients).

#### C2) TDD: tests first

Files:
- `packages/ent-protocol/src/schemas/methods.ts` (schema)
- `packages/agent/src/__tests__/ent-protocol.spec.ts` (conformance)
- `packages/web/app/routes/__tests__/api.provider.instances*.test.ts` (web integration)

Tests:
- Schema accepts `additionalAuth` object.
- Agent accepts and persists the credential payload.
- Web `POST /api/provider/instances` no longer rejects non-empty `additionalAuth`.

#### C3) Agent implementation

Files:
- `packages/agent/src/server.ts` (credentials submit handler)
- wherever credentials are persisted/validated for a connection

Behavior:
- Treat `additionalAuth` as opaque JSON and store alongside credentials for the connection.
- Redact it in logs (same redaction rules as other credential keys).

#### C4) Web wiring

Files:
- `packages/web/app/routes/api.provider.instances.ts`
  - remove `CREDENTIAL_ADDITIONAL_AUTH_UNSUPPORTED` gate
  - forward `additionalAuth` to ENT credentials submit

UI:
- If the web UI doesn’t currently collect additionalAuth, this is still valuable for future providers; keep it YAGNI: implement the wire format + backend support, don’t invent new UI until we have a provider needing it.

## Concrete checklist (definition of done)

### Context visualizer
- [ ] Protocol docs updated with new methods + semantics.
- [ ] `packages/ent-protocol` schemas + tests for new methods.
- [ ] Agent implements new methods (deterministic behavior with test provider).
- [ ] Web:
  - [ ] `/api/agents/:agentId` returns `tokenUsage`
  - [ ] `/api/agents/:agentId/context` returns real breakdown (no `501`)
  - [ ] Existing modal renders meaningful data end-to-end.
- [ ] Update/remove the “not supported” tests and add positive assertions.

### Tool policies
- [ ] Session configuration API supports `toolPolicies` (GET/PUT).
- [ ] Supervisor enforces policies (auto allow/deny) without creating pending permissions.
- [ ] Web tests updated to assert supported behavior.

### additionalAuth
- [ ] ENT schema accepts `additionalAuth`.
- [ ] Web no longer rejects `additionalAuth` on provider instance creation.
- [ ] Agent persists `additionalAuth` and redacts it in logs.
- [ ] Tests cover round-trip.

## Open questions for you (blocking decisions)

1) Do you want **new ENT methods** (`ent/session/token_usage`, `ent/session/context_breakdown`), or do you prefer extending `ent/agent/status` to include token usage + adding only breakdown?
2) For session tool policies: should policies be stored per **workspace session** or per **agent session** in supervisor? (My suggestion: per agent session, so multi-agent sessions can differ; default inherits from project/global in web.)
3) For `additionalAuth`: do we need structured JSON, or can we constrain it to `Record<string,string>` for transport simplicity?

