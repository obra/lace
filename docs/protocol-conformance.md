# Ent Protocol Conformance Checklist

This document is a living guide for validating an agent implementation against the Ent protocol specification. It pairs with `docs/protocol-spec.md` and the automated contract tests in `packages/agent/src/__tests__/ent-protocol.spec.ts`.

## How to run

```bash
npm test --workspace=packages/agent -- ent-protocol.spec.ts
```

## Coverage matrix (current test suite)

- **Providers**
  - `ent/providers/list` happy path
  - `ent/providers/catalog` happy path
  - `ent/providers/refresh` (success + unknown provider)
- **Connections**
  - `ent/connections/upsert` happy path
  - `ent/connections/list` (all + filtered)
  - `ent/connections/credentials/start|submit|clear`
  - `ent/connections/delete` and subsequent `ConnectionNotFound`
- **Models**
  - `ent/models/list` (disabled + disabledState surfaced)
  - `ent/models/enable|disable` (unknown model → InvalidParams)
  - `ent/models/refresh` success
  - Provider-level gating persistence across restart
- **Session configuration**
  - `ent/session/configure` validates environment, mcpServers, approvalMode
  - Prompt without connection/model → InvalidParams
  - `ent/agent/status` reflects configured connection/model
- **Session events**
  - `ent/session/events` (limit/afterEventSeq/types)
- **Tools & Personas**
  - `ent/tools/list` uniqueness
  - `ent/personas/list` presence
- **Jobs**
  - `ent/job/list` baseline empty
  - `ent/job/output` unknown job → JobNotFound
  - `ent/job/kill` unknown job returns success: false
- **MCP**
  - `ent/mcp/servers/list` baseline empty
  - `ent/mcp/servers/upsert|delete` without active session → SessionNotFound
  - `ent/mcp/servers/test` unknown server → McpServerNotFound
  - `ent/mcp/tools/list` unknown server → McpServerNotFound/McpServerNotRunning
- **Workspace**
  - `ent/workspace/info|create` InvalidParams + WorkspaceNotFound
- **Checkpointing & compaction**
  - `ent/session/checkpoint`
  - `ent/session/rewind` missing checkpoint → CheckpointNotFound
  - `ent/session/compact` invalid strategy → InvalidParams
- **Structured output**
  - `session/prompt` with invalid outputFormat → InvalidParams
- **Health**
  - `ent/agent/ping` timestamp sanity

## Gaps to fill (add tests before shipping)

- Job streaming pagination semantics (`tailBytes`, `afterOffset`) with real job output
- `ent/job/kill` on running job (success path) and subagent job behaviour
- `ent/job/output` blocking with `block: true` and `timeout`
- `ent/job/inject` delivery to running subagent
- `ent/session/events` ordering and durability assertions
- Budget enforcement edge cases (maxBudgetUsd unset vs zero) already covered elsewhere but should be referenced here
- Structured output success path and `StructuredOutputInvalid` if/when implemented
- Error code exhaustiveness per method (ensure `data.category` present)

## Principles

- Tests must assert spec errors (e.g., `-32602 InvalidParams`, `JobNotFound` code 8) rather than loosening expectations to match implementation quirks.
- Avoid touching agent state on disk from the client side; all mutations go through protocol calls.
- Keep test runtime reasonable; prefer targeted contract cases over long conversational flows.

## Updating this document

When adding new protocol methods or expanding tests, update both:
1. `packages/agent/src/__tests__/ent-protocol.spec.ts` with strict expectations.
2. This checklist to reflect what is covered and what remains open.
