# ACP Prompt Turn

Source: https://agentclientprotocol.com/protocol/prompt-turn.md

A prompt turn represents one complete interaction cycle between a Client and
Agent, initiated by a user message and concluding when the Agent finishes
responding.

## Core Lifecycle Steps

**1. User Message Initiation** The client sends a `session/prompt` request
containing the user's message and any content.

**2. Agent Processing** The Agent submits the user's message to the language
model, which may respond with text, tool calls, or both.

**3. Output Reporting** The Agent notifies the client through `session/update`
messages, including:

- Agent's plan for task completion
- Text responses from the model
- Tool call requests

**4. Completion Check** If no pending tool calls exist, the Agent MUST respond
with a `StopReason`.

**5. Tool Execution** The Agent may request client permission before executing
tools, then reports status updates.

## Stop Reasons

- `end_turn`: Model finishes without requesting tools
- `max_tokens`: Token limit reached
- `max_turn_requests`: Model request limit exceeded
- `refusal`: Agent declines to continue
- `cancelled`: Client cancels the turn

## Cancellation

Clients can cancel ongoing turns via `session/cancel`.
