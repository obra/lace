# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lace is a modular AI coding assistant built with TypeScript and Node.js. The architecture follows event-sourcing patterns with clean separation of concerns, designed to support multiple AI models and interfaces.

## Development Commands

### Build and Run
```bash
npm run build        # Compile TypeScript to dist/
npm start           # Build and run the interactive CLI
```

### Testing
```bash
npm test            # Run tests in watch mode
npm run test:run    # Run tests once
npm run test:coverage  # Run tests with coverage report
```

### Code Quality
```bash
npm run lint        # Check code style
npm run lint:fix    # Auto-fix linting issues
npm run format      # Format code with Prettier
```

### Development Notes
- Pre-commit hooks automatically run linting, formatting, and related tests
- All code must pass TypeScript strict mode compilation
- Environment variable `ANTHROPIC_KEY` required for agent functionality

## Architecture Overview

### Core Design Pattern: Event-Sourcing
All conversations are stored as immutable event sequences that can be reconstructed into conversation state. This enables:
- Resumable conversations across process restarts
- Multiple interface types (CLI, web, API) working with same data
- Complete audit trail of all interactions

### Event Flow
```
User Input → USER_MESSAGE event → Agent processes conversation history →
AGENT_MESSAGE event → TOOL_CALL events → Tool execution → 
TOOL_RESULT events → Agent continues or responds
```

### Key Components

**Agent System** (`src/agents/`)
- `Agent` class: Wraps AI model interactions (currently Anthropic)
- Not a singleton - supports multiple concurrent agents
- Handles tool call extraction and response formatting

**Thread Management** (`src/threads/`)
- `ThreadManager`: Pure data layer for event storage (in-memory, SQLite planned)
- `buildConversationFromEvents()`: Converts event sequence to Anthropic message format
- Stateless design - can rebuild conversation from events at any time

**Tool System** (`src/tools/`)
- `ToolRegistry`: Central tool discovery and management
- `ToolExecutor`: Safe tool execution with error handling
- `implementations/`: Individual tool implementations (currently bash)
- Model-agnostic tool interface supporting multiple AI providers

**Main Interface** (`src/agent.ts`)
- Orchestration layer - wires components together
- Interactive CLI using readline
- Handles user I/O and message processing workflow

## Event Types and Data Model

```typescript
type EventType = 'USER_MESSAGE' | 'AGENT_MESSAGE' | 'TOOL_CALL' | 'TOOL_RESULT';

interface ThreadEvent {
  id: string;
  threadId: string;
  type: EventType;
  timestamp: Date;
  data: string | ToolCallData | ToolResultData;
}
```

Events are stored in sequence and converted to conversation format when needed. This pattern is critical for the stateless architecture.

## Tool Development

### Adding New Tools
1. Implement the `Tool` interface in `src/tools/implementations/`
2. Register with `ToolRegistry` in main initialization
3. Tools must provide:
   - `name`, `description`, `input_schema`
   - `executeTool()` method returning `ToolResult`

### Tool Interface
```typescript
interface Tool {
  name: string;
  description: string;
  input_schema: ToolInputSchema;  // JSON Schema format
  executeTool(input: Record<string, unknown>): Promise<ToolResult>;
}
```

Tools are model-agnostic - the Agent class handles conversion to provider-specific formats.

## Code Conventions

### File Structure
- Files: `kebab-case.ts`
- Every file starts with `// ABOUTME:` comment explaining purpose
- Test files: `*.test.ts` in `__tests__/` directories alongside source
- Private class members prefixed with `_`

### Critical Patterns
- **YAGNI**: Don't add features we don't need right now
- **Error Handling**: Fail fast on unknown event types, don't silently drop data
- **Event Ordering**: Events must be processed in sequence for conversation reconstruction
- **Stateless Operation**: Any component should be able to rebuild state from events

## Testing Strategy

### Current Coverage
- Conversation reconstruction with real event data
- Error handling for malformed event sequences
- Tool execution and error cases

### Test Data Patterns
Tests use actual event structures captured from real usage to ensure conversation reconstruction works correctly.

## Debugging and Development

### Event Inspection
The conversation builder (`buildConversationFromEvents`) is critical for debugging. If conversations behave unexpectedly:
1. Check event sequence in ThreadManager
2. Verify conversation reconstruction produces correct Anthropic format
3. Ensure tool calls and results are properly paired

### Common Issues
- Tool calls without corresponding results break conversation flow
- Unknown event types cause hard failures (by design)
- Event ordering is critical - events must be processed sequentially

## Logging Guidelines

### When to Log
- **DEBUG**: LLM request/response payloads, tool parsing details, performance metrics
- **INFO**: High-level operations (conversation start, tool execution, provider switching)
- **WARN**: Recoverable issues (fallback behavior, retries, deprecation warnings)
- **ERROR**: Unrecoverable failures (authentication errors, network failures, invalid configurations)

### What to Log
```typescript
// DEBUG: Raw LLM communication
logger.debug('Sending request to LLM', { provider: 'anthropic', messageCount: messages.length, tools: tools.map(t => t.name) });
logger.debug('LLM response received', { provider: 'anthropic', contentLength: response.content.length, toolCalls: response.toolCalls.length });

// INFO: User-visible operations  
logger.info('Tool execution started', { toolName: 'bash', command: input.command });
logger.info('Conversation thread created', { threadId, provider: 'lmstudio' });

// WARN: Fallback scenarios
logger.warn('LMStudio connection failed, using cached model', { modelId, errorMessage: error.message });

// ERROR: Critical failures
logger.error('Provider initialization failed', { provider: 'anthropic', error: error.message });
```

### Privacy and Security
- **Never log**: API keys, user credentials, sensitive file contents
- **Sanitize**: File paths (log relative paths only), user input (truncate if very long)
- **Hash**: User identifiers if needed for debugging

### Performance Considerations  
- Log payloads at DEBUG level only (they can be large)
- Include relevant metadata for filtering (provider, operation, threadId)
- Use structured data objects rather than string concatenation

## Future Architecture

The current design is prepared for:
- SQLite persistence (replace in-memory ThreadManager)
- Multiple interfaces (web UI, API, terminal UI)
- Additional AI providers (extend Agent abstraction)
- Concurrent agent threads (Agent class already supports this)

The event-sourcing foundation makes these additions straightforward without major architectural changes.