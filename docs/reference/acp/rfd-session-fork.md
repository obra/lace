# ACP RFD: Forking of Existing Sessions

> Source: https://agentclientprotocol.com/rfds/session-fork Fetched: 2026-01-05
> Status: Draft

## Motivation

When you want to summarize the current conversation to use it in a future chat,
sending a message asking for the summary would become part of its context,
affecting future user interactions. Session forking enables creating a branch of
the conversation, issuing additional messages, and then closing the fork without
polluting the original session's history.

This enables functionality that requires using the current chat without
polluting its history, ranging from summaries to potentially subagents.

## Proposal

Add a `session/fork` method that allows agents to declare fork support and
clients to request session forks.

### Capabilities Declaration

Agents declare fork support by returning this capability:

```json
{
  "session": {
    "fork": {}
  }
}
```

The empty object is reserved to declare future capabilities, such as forking
from a specific message checkpoint.

### Request Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/fork",
  "params": {
    "sessionId": "sess_789xyz",
    "cwd": "...",
    "mcpServers": [...]
  }
}
```

### Parameters

- **sessionId** (required): The identifier of the existing session to fork
- **cwd** (optional): Working directory for the forked session
- **mcpServers** (optional): MCP server configuration for the forked session

The request expects the same options as `session/load`, such as `cwd` and
`mcpServers`.

### Response Format

The agent would respond with optional data such as config options, the same as
`session/load`. Expected fields include:

- **sessionId**: The new forked session's identifier
- **forkedFrom**: The original session ID that was forked

### Error Handling

Agents may reply with an error if forking of that specific session or with the
given options is not supported. For example, if the agent does not support
forking with a different working directory than the initial session.

## Design Decisions

### Why Not Extend `session/new`?

The decision was that `session/fork` and `session/new` must be different methods
because they require different options:

1. `session/new` has options such as capabilities and MCP which are not
   recommended when forking, as the context being forked was built with other
   tools
2. Forking may accept a `messageId` for checkpoints in future iterations
3. Different validation and error handling requirements

### Why Accept Full `session/load` Options?

Initially, the proposal was to only accept the `sessionId`, but this would make
it more difficult to allow forking of inactive sessions in agents like
claude-code-acp, as the agent may not retain the configured MCP servers of a
session.

Limiting fork to only already active sessions would limit its usefulness.
Allowing different options also enables features like dynamically adding MCP
servers to existing sessions by forking them with new options.

## Future Extensions

The reserved object structure allows future enhancements such as:

- Forking from specific message checkpoints (`messageId` parameter)
- Enabling features like editing previous messages
- Branching conversation trees

## Timeline

- 2025-11-17: Capabilities format mentioned, FAQ updated
- 2025-11-20: Request format and updated capabilities format added
