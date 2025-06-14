# Lace - AI Coding Assistant

## Goals

Build a clean, extensible AI coding assistant with:
- **Iterative development** - Step by step, no overwrought monstrosity
- **Clean separation of concerns** - Loosely coupled subsystems for easy testing
- **Model independence** - Eventually support multiple AI SDKs
- **Multi-interface support** - Terminal UI (Ink), web, API, non-interactive CLI
- **Thread persistence** - SQLite storage for resumable conversations across restarts
- **Multi-threading** - Handle multiple concurrent agent threads

## Architecture

### Core Components

1. **Core Agent**
   - Handles model interactions (streaming, function calling)
   - NOT a singleton - agents can spawn other agents
   - Model-agnostic interface for future SDK support

2. **Thread Manager** (Data Layer)
   - SQLite persistence for conversations
   - Pure data layer - no business logic about conversation state
   - Given thread ID, can resume from any point

3. **Tool System**
   - Extensible tool registry and execution
   - Starting with bash tool (refactor existing implementation)
   - Clean interface for adding new tools

4. **Interfaces** (Priority Order)
   - Non-interactive CLI (first - enables resumable threads)
   - Terminal UI (Ink-based)
   - Web interface  
   - Programmatic API

### Data Model

```
Thread:
  - id: unique identifier
  - created_at, updated_at
  - metadata (title, tags, etc.)

Event:
  - thread_id
  - event_type: 'user_message' | 'agent_message' | 'tool_call' | 'tool_result'
  - data: JSON (message content, tool call details, results, etc.)
  - timestamp
```

All conversation data (messages, tool calls, results) are stored as events in the thread, with details in the JSON data column.

## Development Principles

- **YAGNI** - Don't add features we don't need right now
- **Simple & Clean** - Maintainable over clever
- **Comprehensive Testing** - Unit, integration, E2E tests
- **Clear Documentation** - Inline docs for all code
- **Iterative** - Build incrementally, verify each step

## Current State

- Basic interactive agent in `src/agent.ts`
- TypeScript setup with basic tsconfig
- Anthropic SDK integration with bash tool
- Recursive tool call handling

## Next Steps

1. Set up development tooling (linting, testing, pre-commit hooks)
2. Extract core agent logic into separate modules
3. Implement SQLite thread persistence
4. Build non-interactive CLI interface
5. Add comprehensive test coverage
6. Refactor toward clean architecture