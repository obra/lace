# ACP RFD: Session Usage and Context Status

Source: https://agentclientprotocol.com/rfds/session-usage.md

## Problem

ACP lacks standardized mechanisms for agents to communicate:
- Token usage
- Context window status
- Cost information
- Prompt caching metrics

## Proposed Solution

**Token Usage in PromptResponse**: Per-turn token breakdowns—total, input, output, thought tokens, cached read/write.

**Context Window via session/update**: Agents push context window data and cumulative costs through `session/update` notifications marked `sessionUpdate: "usage_update"`.

Includes:
- Tokens currently in context
- Total context size
- Optional cost tracking (multi-currency)

## Design Principles

- Separation of concerns (per-turn vs session state)
- Agents calculate metrics, provide raw data for client verification
- Cost reporting optional
- Flexible timing for different agent capabilities
