# Tool Status State Machine

This document describes the state machine for `tool_use` status transitions in
Lace's tool execution lifecycle.

## State Diagram

```
         ┌─────────────┐
         │   pending   │
         └──────┬──────┘
                │ (tool_use event emitted)
                ▼
      ┌─────────────────────┐
      │ awaiting_permission │
      └──────┬──────────────┘
             │
       ┌─────┼──────────────────────────┐
       │     │                          │
       ▼     ▼                          ▼
  ┌────────┐ ┌──────┐  (denied)   ┌────────┐
  │completed│ │failed│ (timeout)  │ denied │
  └────────┘ └──────┘  (cancelled)└────────┘
```

## Status Meanings

### `pending`

- **Meaning**: Tool execution has been requested but not yet initiated.
- **When**: Tool call is created but waiting for approval or execution
  scheduling.
- **Transition**: Moves to `awaiting_permission` when tool executor begins
  processing.

### `awaiting_permission`

- **Meaning**: Tool is waiting for user approval before execution.
- **When**: Tool requires approval and system is waiting for user decision.
- **Approval Options**:
  - `ALLOW_ONCE`: Execute this specific tool call
  - `ALLOW_SESSION`: Execute all future calls to this tool in the session
  - `DENY`: Reject execution and move to `denied` status
- **Transition**: Moves to `completed` or `failed` on approval, or `denied` on
  rejection.

### `completed`

- **Meaning**: Tool executed successfully and returned a result.
- **When**: Execution finished without errors, regardless of the tool's output
  content.
- **Metadata**: Includes tool result, execution time, and output summary.
- **Terminal State**: Yes - no further transitions.

### `failed`

- **Meaning**: Tool execution encountered an error.
- **When**: Tool crashed, threw an exception, or returned a ToolResult with
  `isError: true`.
- **Metadata**: Includes error message, error type, and execution context.
- **Terminal State**: Yes - no further transitions.
- **Recovery**: Agent may retry based on error type and context.

### `denied`

- **Meaning**: User rejected the tool execution.
- **When**: User selected "Deny" or approval timed out without response.
- **Metadata**: Includes reason (explicit denial vs. timeout) and user context.
- **Terminal State**: Yes - no further transitions.

### `timeout`

- **Meaning**: Tool execution exceeded time limit.
- **When**: Tool did not complete within configured timeout window.
- **Metadata**: Includes elapsed time, partial output (if any), and timeout
  duration.
- **Terminal State**: Yes - no further transitions.

### `cancelled`

- **Meaning**: Tool execution was cancelled by user or system.
- **When**: User interrupted execution, parent task was cancelled, or system
  shutdown.
- **Metadata**: Includes cancellation reason and partial output (if any).
- **Terminal State**: Yes - no further transitions.

## Transition Rules

### From `pending`

- → `awaiting_permission`: When tool requires approval and approval check begins
- → `completed`: When tool executes and completes successfully (no approval
  required)
- → `failed`: When tool cannot be prepared or initialization fails
- → `denied`: When approval pre-check fails (e.g., tool not allowed in this
  context)

### From `awaiting_permission`

- → `completed`: When user approves and execution completes successfully
- → `failed`: When user approves but execution encounters an error
- → `denied`: When user rejects or approval timeout expires
- → `timeout`: When approval request times out (separate from tool execution
  timeout)

### From Terminal States

- No transitions possible from `completed`, `failed`, `denied`, `timeout`, or
  `cancelled`

## Timeline Representation

When tool events are displayed in a timeline or activity log:

```
pending ───────────────────┐
                           │
                           ▼ (User sees approval request)
                    awaiting_permission
                           │
                           ▼ (After user decision)
                    completed / failed / denied / timeout / cancelled
```

## State Transition Matrix

| Current State       | Next State          | Trigger                                | Notes                            |
| ------------------- | ------------------- | -------------------------------------- | -------------------------------- |
| pending             | awaiting_permission | Tool requires approval                 | Normal approval flow             |
| pending             | completed           | No approval needed, execution succeeds | Read-only tools                  |
| pending             | failed              | Initialization error                   | Invalid parameters, missing deps |
| awaiting_permission | completed           | User approves + success                | Tool runs successfully           |
| awaiting_permission | failed              | User approves + error                  | Tool throws or validation fails  |
| awaiting_permission | denied              | User rejects                           | Explicit denial                  |
| awaiting_permission | timeout             | Approval timeout                       | No response from user            |
| awaiting_permission | cancelled           | User cancels request                   | Interruption during approval     |

## Examples

### Example 1: Read-Only Tool (No Approval)

```
[pending] ──execute──> [completed]
          (no approval needed, reads file successfully)
```

### Example 2: Destructive Tool with Approval

```
[pending] ──check──> [awaiting_permission] ──user approves──> [completed]
                                                (file deleted successfully)
```

### Example 3: Rejected Execution

```
[pending] ──check──> [awaiting_permission] ──user denies──> [denied]
                                            (tool never executes)
```

### Example 4: Execution Error

```
[pending] ──check──> [awaiting_permission] ──user approves──> [failed]
                                                (directory doesn't exist)
```

### Example 5: User Cancellation

```
[pending] ──check──> [awaiting_permission] ──user cancels──> [cancelled]
                                            (interrupts approval request)
```

### Example 6: Approval Timeout

```
[pending] ──check──> [awaiting_permission] ──timeout (10s)──> [timeout]
                                            (no user response)
```

## Implementation Notes

### Status Persistence

- Tool statuses are stored in the event stream as `tool_use` events with status
  field
- Each status change is a new event in the immutable event log
- Timeline views reconstruct full execution history from events

### Approval Integration

- The approval system (`ApprovalCallback` interface) handles transitions between
  `pending` and `awaiting_permission`
- Different interfaces (CLI, web) implement approval UI but share the same state
  machine
- Approval decisions return `ApprovalDecision` enum: `ALLOW_ONCE`,
  `ALLOW_SESSION`, or `DENY`

### Error Handling

- Failed state includes `ToolResult` with `isError: true` and error message
- Agent may implement retry logic based on error classification
- Error context preserved for debugging and user feedback

### Cancellation

- `cancelled` status distinct from `failed` - indicates intentional interruption
- User can cancel during approval or (with async support) during execution
- Partial output preserved where available

### Timeout Handling

- Separate timeout status distinct from failed state
- Supports both approval timeout and execution timeout
- Configurable per session or globally

## Session-Level Approval Caching

When user selects `ALLOW_SESSION`, all future calls to that tool in the session
skip the `awaiting_permission` state:

```
First call:
[pending] → [awaiting_permission] → (user selects ALLOW_SESSION) → [completed]

Subsequent calls:
[pending] → [completed]  (approval cached, skips awaiting_permission)
```

## Related Documentation

- [Tool System Guide](tools.md) - Complete tool implementation guide
- [Tool Approval System](tools.md#tool-approval-system) - Approval callback
  architecture
- Protocol Spec - session/update event types for tool status changes
