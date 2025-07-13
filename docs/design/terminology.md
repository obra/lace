# Lace Terminology Dictionary

This document defines the key terms and concepts used throughout the lace codebase. Understanding these terms is essential for working with the architecture.

## Core Concepts

### Thread
A **thread** is a conversation session between a user and an agent, identified by a unique `threadId`. Threads are the fundamental unit of conversation persistence in lace. Each thread contains an immutable sequence of events that can be reconstructed into conversation state.

- **ThreadId**: Branded type following the pattern `lace_YYYYMMDD_xxxxxx` (e.g., `lace_20250113_abc123`)
- **Delegate Thread**: Sub-conversation spawned from a parent thread, with IDs like `lace_20250113_abc123.1`, `lace_20250113_abc123.2`
- **Canonical ID**: Stable thread identifier that persists through compaction and versioning

### Agent
The **agent** is your AI counterparty in a thread - the entity you're having a conversation with. It's effectively a facade that:
- Processes conversation history from events
- Talks to AI models through providers
- Manages state transitions (idle → thinking → streaming → tool_execution)
- Emits events for UI updates

Key principle: An agent can switch models/providers mid-conversation.

### Timeline
A **timeline** is the human-visible rendering of a thread. It's the UI-friendly representation that users see, with processed events, formatted messages, and visual elements. The timeline is what gets displayed in the terminal or web interface.

### Provider
A **provider** is a service that hosts AI models. Examples include:
- Anthropic (Claude models)
- OpenAI (GPT models)
- LMStudio (local models)
- Ollama (local models)

Providers handle API communication, format conversion, and streaming support.

### Model
A **model** is a specific AI system within a provider (e.g., `claude-3-opus`, `gpt-4`). Models can be switched during a conversation without losing context.

## Event System

### Event Sourcing
Lace uses **event sourcing** - all state changes are stored as immutable events that can be replayed to reconstruct state. This enables:
- Resumable conversations
- Complete audit trails
- Multiple interfaces working with same data
- Stateless operation

### Event Types
- **USER_MESSAGE**: Message from the user
- **AGENT_MESSAGE**: Response from the agent
- **TOOL_CALL**: Request to execute a tool
- **TOOL_RESULT**: Result from tool execution
- **SYSTEM_PROMPT**: System-level instructions
- **USER_SYSTEM_PROMPT**: User's custom instructions
- **LOCAL_SYSTEM_MESSAGE**: System notifications (tasks, etc.)

### Event Flow
```
User Input → USER_MESSAGE event → Agent processes → AGENT_MESSAGE event → 
TOOL_CALL events → Tool execution → TOOL_RESULT events → Agent continues
```

## Architecture Layers

### Data Layer
- **ThreadManager**: High-level thread operations and event coordination
- **ThreadPersistence**: SQLite-based storage with graceful degradation
- **DatabasePersistence**: Actual database operations
- **Schema Migrations**: Versioned database updates

### Logic Layer
- **Agent**: Core conversation engine
- **ToolExecutor**: Central tool management
- **Provider**: AI model abstraction
- **TokenBudgetManager**: Token usage tracking

### Interface Layer
- **TerminalInterface**: Rich terminal UI with React/Ink
- **NonInteractiveInterface**: Single-prompt mode
- **ThreadProcessor**: UI-optimized event processing

## Tool System

### Tool
A **tool** is a capability the agent can use (file operations, bash commands, etc.). Tools:
- Extend the base `Tool` class
- Use Zod schemas for validation
- Require user approval for destructive operations
- Return structured `ToolResult` objects

### Tool Execution Flow
1. Agent requests tool via `TOOL_CALL` event
2. ToolExecutor validates arguments
3. User approval requested if needed
4. Tool executes with context
5. Result returned via `TOOL_RESULT` event

### Content Blocks
Tools return **content blocks** - structured content that can be:
- **Text**: Plain text output
- **Image**: Image data with metadata
- **Resource**: File contents or other resources

## Token Management

### Token Budget
The **token budget** tracks conversation size to prevent exceeding model limits. Components:
- **TokenBudgetManager**: Tracks usage across providers
- **BudgetStatus**: Current usage statistics
- **BudgetRecommendations**: Optimization suggestions

### Compaction
**Compaction** reduces token usage by summarizing old conversation parts:
- **CompactionStrategy**: Interface for compaction approaches
- **Shadow Thread**: New thread version created during compaction
- **Thread Shadowing**: Automatic versioning for token optimization

## Streaming and Real-time

### Streaming
**Streaming** provides token-by-token response generation for responsive UI:
- **Ephemeral Messages**: Temporary streaming content
- **Incremental Processing**: O(1) performance for updates
- **Thinking Blocks**: Special blocks for model reasoning

### Timeline Processing
- **ProcessedThreadItems**: Cached events from persistence
- **EphemeralTimelineItems**: Real-time streaming items
- **StreamingTimelineProcessor**: Efficient incremental processor

## User Interaction

### Approval System
Tools require approval for destructive operations:
- **ApprovalDecision**: ALLOW_ONCE, ALLOW_SESSION, or DENY
- **ApprovalCallback**: Interface for requesting approval
- **Approval Policies**: Auto-approval configuration

### Focus System
Terminal UI navigation:
- **Focus Management**: Keyboard navigation between elements
- **Tool Approval Modals**: Interactive approval dialogs
- **Scrolling**: Automatic and manual scroll control

## Session Management

### Resume/Continue
Conversations can be resumed across process restarts:
- Use `--continue` flag to resume latest thread
- Threads reconstruct from event history
- Complete state restoration from events

### Stateless Operation
Key principle: Any component can rebuild state from events. This enables:
- Process restart resilience
- Multiple interface support
- Clean architecture boundaries

## Development Concepts

### Graceful Degradation
System continues working when non-critical components fail:
- Database falls back to memory-only operation
- Provider errors don't crash conversations
- Tool failures are captured and reported

### Type Safety
- **Branded Types**: `ThreadId`, `ProviderName` for compile-time safety
- **Discriminated Unions**: Type-safe event handling
- **Zod Schemas**: Runtime validation for tools

### Testing Strategy
- **Unit Tests**: Component behavior
- **Integration Tests**: Cross-component interactions
- **E2E Tests**: Full conversation workflows
- **Co-location**: Tests next to source files

## File Organization

### Key Directories
- `src/agents/`: Agent and conversation logic
- `src/threads/`: Thread management and persistence
- `src/providers/`: AI provider implementations
- `src/tools/`: Tool implementations
- `src/interfaces/`: UI components
- `src/config/`: Configuration and prompts

### Import Conventions
- Use `~/*` for internal imports (maps to `src/`)
- Omit file extensions in imports
- Example: `import { Agent } from '~/agents/agent'`

## Common Pitfalls

### API Usage
- Use `Agent` as the primary API, not `ThreadManager` directly
- `Timeline` is for UI display, `Thread` is for data
- Events must be processed in order
- Never modify events after creation

### State Management
- All state changes must go through events
- Components should be stateless when possible
- Rebuild state from events rather than caching

### Error Handling
- Use structured error classes, not strings
- Fail fast on unknown event types
- Provide graceful degradation paths
- Never lose user data

This terminology forms the foundation of lace's architecture. When in doubt, refer to the event flow and remember that everything is built on immutable events that can reconstruct any state.