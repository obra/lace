# ACP Tool Calls

Source: https://agentclientprotocol.com/protocol/tool-calls.md

Tool calls enable agents to request actions during interactions with language
models.

## Creating Tool Calls

Agents report: unique identifier, human-readable title, operational category,
and execution status.

## Execution Updates

Agents send progress updates using `tool_call_update` notifications. All fields
except `toolCallId` are optional in updates.

## Permission Requests

Agents can request user approval through `session/request_permission`. Options
include:

- allow_once
- allow_always
- reject_once
- reject_always

## Status Lifecycle

Tool calls progress through statuses:

- `pending`: awaiting input/approval
- `in_progress`: currently running
- `completed`: successful
- `failed`: error occurred

## Content Types

Tool calls produce:

- Content blocks (text, images, resources)
- Diffs showing file modifications
- Terminals displaying live command output
