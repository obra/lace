# ACP Session List RFD

> Source: https://agentclientprotocol.com/rfds/session-list
> Status: Draft
> Fetched: 2026-01-05

## Overview

The Session List RFD proposes adding a `session/list` JSON-RPC endpoint enabling
clients to discover and enumerate existing sessions from agents, facilitating
features like session history, session switching, and session cleanup.

## Core Problem

Currently, the ACP protocol lacks session discovery capabilities:

1. **No session discovery** - Clients cannot query what sessions exist on an agent
2. **Limited history access** - Users cannot browse past conversations
3. **Client-side complexity** - Each client must maintain its own session registry

## Proposed Solution

### New Endpoint: `session/list`

#### Request Parameters (all optional)

| Parameter | Type   | Description                              |
| --------- | ------ | ---------------------------------------- |
| `cwd`     | string | Filters sessions by working directory    |
| `cursor`  | string | Opaque pagination token from prior response |

Minimal requests require no parameters, returning all available sessions.

#### Response Structure

```typescript
interface SessionListResult {
  sessions: SessionInfo[];
  nextCursor?: string;
}

interface SessionInfo {
  sessionId: string;    // Required - unique identifier
  cwd: string;          // Required - working directory
  title?: string;       // Optional - human-readable name
  updatedAt?: string;   // Optional - ISO 8601 timestamp
  _meta?: object;       // Optional - agent-specific metadata
}
```

Empty result sets return a sessions array with no entries and no cursor.

## Key Design Features

### Capability-based

Agents advertise support via `sessionCapabilities: { list: {} }` during
initialization, allowing optional implementation.

### Cursor Pagination

Uses opaque tokens rather than offset-based pagination, providing:
- Stability across concurrent modifications
- Server-side flexibility in implementation
- No client-side parsing requirements

### Metadata Flexibility

The `_meta` field accommodates agent-specific information without constraining
the protocol.

### Separation of Concerns

Lists sessions only; full content retrieval uses existing `session/load`
mechanisms.

## Use Cases Enabled

- Session browsing and history
- Cross-device session continuity
- Session switching and management
- Cleanup of stale sessions
- Resource management visibility

## Implementation Roadmap

**Phase 1:** Protocol schema updates and documentation
**Phase 2:** Rust and TypeScript SDK implementations
**Phase 3:** Reference agent demonstrating in-memory registries and automatic
title generation

## Security and Compatibility

- Sessions remain isolated by authentication
- Agents enforce reasonable page sizes
- Fully backward-compatible; existing agents unaffected
