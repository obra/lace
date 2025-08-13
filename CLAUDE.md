# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lace is a sophisticated AI coding assistant built with TypeScript and Node.js. It uses event-sourcing architecture with immutable conversation sequences that enable resumable conversations across process restarts and support for multiple interface types (CLI, web, API).

## Development Commands

### Build and Run
```bash
npm run build        # Compile TypeScript to dist/ + copy prompts
npm start           # Build and run the interactive CLI
npm run lint        # ESLint checking
npm run lint:fix    # Auto-fix linting issues
npm run format      # Format code with Prettier
```

### Debug Logging
```bash
npm run dev:debug    # Start with debug logging enabled
# Or manually:
LACE_LOG_LEVEL=debug LACE_LOG_STDERR=true npm run dev
```

**Environment Variables:**
- `LACE_LOG_LEVEL`: Set to `error`, `warn`, `info`, or `debug`
- `LACE_LOG_STDERR`: Set to `true` to output logs to stderr
- `LACE_LOG_FILE`: Optional file path for log output

### Testing
```bash
npm test            # Run tests in watch mode
npm run test:run    # Run tests once
npm run test:unit   # Unit tests only
npm run test:integration # Integration tests
npm run test:coverage # Run tests with coverage report

# Direct vitest commands (alternative)
npx vitest          # Run tests in watch mode
npx vitest --run    # Run tests once
npx vitest --run src/path/to/test.ts  # Run specific test file
```


### General code and design philosophy

YAGNI. DRY. SIMPLE. CLEAN. STRAIGHTFORWARD. TESTABLE. LOOSELY COUPLED.

TEST FIRST. Whether you're designing a new feature or fixing a bug, you write the tests first and verify that they fail. Then you implement only enough code to make them pass.

Good naming is VERY VERY important. Think hard about naming things. It's always ok to ask your human partner for naming advice.


### Development Notes
- Pre-commit hooks automatically run linting, formatting, and related tests
- All code must pass TypeScript strict mode compilation

### Import Style
- Use `~/*` path aliases for internal imports instead of relative paths
- **Omit file extensions** - prefer `import { Agent } from '~/agents/agent'` over `import { Agent } from '~/agents/agent.js'`
- **Never use inline imports** - always declare imports at the top of the file
  - ❌ `const taskTool = tool as { getTaskManager?: () => import('~/tasks/task-manager').TaskManager }`
  - ✅ `import type { TaskManager } from '~/tasks/task-manager'` (at top) then `getTaskManager?: () => TaskManager`
- Example: `import { Agent } from '~/agents/agent'` instead of `import { Agent } from '../../agents/agent.js'`
- This makes imports more readable and prevents breakage when moving files
- The `~` prefix maps to the `src/` directory via TypeScript path mapping

## Core Architecture

### Event-Sourcing Foundation
All conversations are stored as immutable event sequences that can be reconstructed into conversation state. This enables:
- Resumable conversations across process restarts
- Multiple interface types (CLI, web, API) working with same data
- Complete audit trail of all interactions
- Stateless operation - any component can rebuild state from events

### Event Flow
```
User Input → USER_MESSAGE event → Agent processes conversation history →
AGENT_MESSAGE event → TOOL_CALL events → Tool execution → 
TOOL_RESULT events → Agent continues or responds
```

### Three-Layer System
- **Data Layer**: ThreadManager/Persistence (SQLite-based with graceful degradation)
- **Logic Layer**: Agent/Tools (core conversation engine)
- **Interface Layer**: Terminal/Web/API (pluggable UI components)

### Key Components

**Agent System (`src/agents/agent.ts`)**
- Event-driven conversation engine with state machine: `idle → thinking → streaming → tool_execution → idle`
- Emits events for UI updates: `agent_thinking_start/complete`, `tool_call_start/complete`, `state_change`
- Token budget management and streaming response handling
- Abort functionality for long-running operations
- Supports multiple concurrent agents (not a singleton)

**Thread Management (`src/threads/`)**
- **ThreadManager**: High-level thread operations and event coordination
- **ThreadPersistence**: SQLite-based persistence with graceful degradation to memory-only
- **ThreadProcessor**: UI-optimized event processing with performance caching
- Stateless design - can rebuild conversation from events at any time
- `buildConversationFromEvents()` converts event sequences to provider-specific formats

**Tool System (`src/tools/`)**
- **ToolExecutor**: Central tool management with approval workflow integration
- Categories: file operations, system operations, workflow tools
- User approval system with configurable policies
- Safe execution with error handling and thread-aware context passing
- Model-agnostic interface supporting all AI providers

**Provider System (`src/providers/`)**
- Abstraction layer supporting multiple AI providers (Anthropic, OpenAI, LMStudio, Ollama)
- Normalized interface with format conversion between generic and provider-specific APIs
- Streaming support where available
- Registry system with auto-discovery

**Interface System (`src/interfaces/`)**
- **TerminalInterface**: Rich Ink/React-based UI with real-time updates and tool approval modals
- **ThreadProcessor**: Cached processing of persisted events + real-time streaming content processing
- **NonInteractiveInterface**: Single-prompt execution mode


## Event Model

Events include: USER_MESSAGE, AGENT_MESSAGE, TOOL_CALL, TOOL_RESULT, THINKING, SYSTEM_PROMPT, USER_SYSTEM_PROMPT.

**Critical**: Events must be processed in sequence for conversation reconstruction.

## Technology Stack

- **TypeScript 5.6+** with strict mode
- **Node.js** with ES modules
- **SQLite** (better-sqlite3) for persistence
- **React 19 + NextJS 15 ** for web interface
- **Vitest and Playwright** for testing
- **ESLint + Prettier** for code quality

## Tool Development

### Schema-Based Tool Architecture
All tools extend the `Tool` base class and use Zod schemas for validation. This provides automatic parameter validation, type safety, and JSON schema generation.

### Adding New Tools
1. Create new class extending `Tool` in `src/tools/implementations/`
2. Define Zod schema for parameters
3. Implement `executeValidated()` method
4. Export from `src/tools/implementations/index.ts`
5. Register with `ToolExecutor` in main initialization

### Tool Base Class
```typescript
import { z } from 'zod';
import { Tool } from '../tool.js';

class MyTool extends Tool {
  name = 'my_tool';
  description = 'What this tool does';
  schema = z.object({
    param: z.string().min(1, 'Cannot be empty'),
    optional: z.number().optional(),
  });
  
  protected async executeValidated(
    args: z.infer<typeof this.schema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    // Validated args are fully typed
    const result = doSomething(args.param);
    
    // Use helpers for consistent output
    return this.createResult(result, { metadata: 'value' });
  }
}
```

### Common Schema Patterns
```typescript
import { NonEmptyString, FilePath, LineNumber } from '../schemas/common.js';

const schema = z.object({
  path: FilePath,              // Auto-resolves to absolute path
  content: NonEmptyString,     // Rejects empty strings
  line: LineNumber,            // Positive integers only
  maxResults: z.number().int().min(1).max(1000).default(100),
});
```

Tools are model-agnostic - the Agent class handles conversion to provider-specific formats.

## Key Patterns

### Event-Driven Architecture
All state changes go through immutable events. Agent emits events like `agent_thinking_start`, `tool_call_complete`, `state_change` for UI updates.

### Provider Abstraction
Generic `ProviderMessage[]` format converts to provider-specific APIs. Each provider handles format conversion and streaming support.

### Tool System
- User approval system with policies (ALLOW_ONCE, ALLOW_SESSION, DENY)
- 11 tools: file operations (read/write/edit/insert/list/find), system operations (bash/search/url-fetch), workflow tools (task-manager/delegate)
- Safe execution with error handling and context passing

### Thread Management
- SQLite persistence with graceful degradation to memory-only
- Resumable conversations with `--continue` flag
- Delegate thread management for sub-conversations


## Testing Strategy

- **Unit Tests**: Individual component behavior
- **Integration Tests**: Cross-component interactions
- **E2E Tests**: Full conversation workflows
- **Co-location**: Test files next to source files (e.g., `agent.ts` → `agent.test.ts`)
- **Vitest**: Primary testing framework with JSDoc environment for React components

## Code Standards

### Key Principles
- Files start with `// ABOUTME:` comment explaining purpose
- **Strict TypeScript** - Never use `any`, prefer `unknown` with type guards
- **Pure functions** - Avoid side effects, use immutable transformations
- **Structured errors** - Use error classes with context, not plain strings

### Event System
- **Immutable events** - Events should never be modified after creation
- **Event sourcing consistency** - All state changes must go through events
- **Type-safe events** - Use discriminated unions for event types
- **Event ordering critical** - Events must be processed in sequence

### Error Handling
- **Structured error classes** with context, not plain strings
- **Graceful degradation** - System should continue working when non-critical components fail
- **Fail fast** on unknown event types - don't silently drop data
- **No system crashes** on tool failures or provider errors


### Critical Architecture Patterns
- **YAGNI** - Don't add features we don't need right now
- **Stateless operation** - Any component should be able to rebuild state from events
- **Event ordering** - Events must be processed in sequence for conversation reconstruction
- **Provider abstraction** - Clean separation between generic and provider-specific formats

### Data Flow
User Input → Events → Agent Processing → Provider API → Tool Execution → Response Complete

ThreadProcessor caches processed events for performance.

## Configuration

- **Environment**: ANTHROPIC_KEY, OPENAI_API_KEY, LACE_DIR
- **User Instructions**: `~/.lace/instructions.md`
- **System Prompts**: Template-based generation in `src/config/prompts/`
- **Database**: SQLite storage in LACE_DIR with graceful degradation

## Security & Safety

- User approval required for all destructive operations
- Complete audit trail of tool executions
- Local-only data storage (SQLite)
- Read-only vs destructive tool classification
- Configurable approval policies


## Debugging and Development

Because the UI is a full terminal application, it's hard for you to debug it interactively. Sometimes, it's better to refactor components into smaller, more easily testable pieces. Sometimes, it's better to ask your human partner to test something for you. 

### Server-Side Debugging
You MUST NEVER use console.log for server-side debugging. Instead, use the logger system and inspect the logs after runs.

### Web Development Debugging  
For the Next.js web interface (`packages/web`), browser console messages are automatically forwarded to your development server terminal. This means you CAN use `console.log`, `console.error`, etc. in React components and client-side code - they will appear in your server logs with colored `[BROWSER]` prefixes and proper object serialization (including circular references and dates).

The console forwarding system:
- Only runs in development mode  
- Buffers and batches console calls to avoid network spam
- Uses SuperJSON for robust object serialization
- Provides colored, timestamped output in your terminal
- Handles complex objects, circular references, and errors gracefully

### Event Inspection
The conversation builder (`buildConversationFromEvents`) is critical for debugging. If conversations behave unexpectedly:
1. Check event sequence in ThreadManager
2. Verify conversation reconstruction produces correct Anthropic format
3. Ensure tool calls and results are properly paired

### Common Issues
- Tool calls without corresponding results break conversation flow
- Unknown event types cause hard failures (by design)
- Event ordering is critical - events must be processed sequentially

## Logging
- DEBUG: LLM payloads, tool details; INFO: Operations; WARN: Fallbacks; ERROR: Failures
- Never log API keys or sensitive content
- Use structured data objects with relevant metadata

## Linting Rules to Follow

### TypeScript ESLint Rules
- **@typescript-eslint/no-floating-promises**: Always await promises or explicitly use `void` operator
  - ❌ `manager.deleteTask(taskId, context);`
  - ✅ `await manager.deleteTask(taskId, context);`
  - ✅ `void manager.deleteTask(taskId, context);`

- **@typescript-eslint/no-unsafe-assignment**: Never use `any` type without proper typing
  - ❌ `const data = await response.json();`
  - ✅ `const data = (await response.json()) as { error: string };`

- **@typescript-eslint/no-unused-vars**: Remove unused imports and variables
  - ❌ `import type { SessionService } from '@/lib/server/session-service';` (if not used)
  - ✅ Only import what you actually use

- **@typescript-eslint/no-explicit-any**: Avoid using `any` type
  - ❌ `} as any;`
  - ✅ `} as typeof TextEncoder;`

### Next.js Specific Rules
- **no-relative-import-paths**: Use absolute imports with @ prefix
  - ❌ `import { GET } from '../route';`
  - ✅ `import { GET } from '@/app/api/tasks/stream/route';`


 **Prefer `unknown` to `any`**  
   ```ts
   function parseJSON(input: string): unknown {
     return JSON.parse(input);
   }
   ```

 **Use generics & utility types**  
   ```ts
   // Generic instead of any[]
   function first<T>(arr: T[]): T | undefined { … }

   // Utility types
   type PartialUser = Partial<User>;
   type UserMap     = Record<string, User>;
   type FetchRet    = ReturnType<typeof fetchUser>;
   ```

 **Write runtime type-guards**  
   ```ts
   function isUser(u: any): u is User {
     return u && typeof u.id === "number" && typeof u.name === "string";
   }
   ```

---

# Testing-Specific Rules

 **Import real types**  
   Always reference your production interfaces/classes in test files.

 **Use typed mocks**  
   ```ts
   import type { ServiceClient } from "../clients";

   const mockClient: jest.Mocked<ServiceClient> = {
     fetch: jest.fn().mockResolvedValue({ /* typed payload */ }),
     // …
   };
   ```

 **Factory fixtures with `Partial<T>`**  
   ```ts
   function makeUser(overrides?: Partial<User>): User {
     return {
       id: 1,
       name: "Alice",
       email: "alice@example.com",
       ...overrides,
     };
   }
   ```

 **Assert via `unknown` → cast**  
   ```ts
   const raw: unknown = JSON.parse(jsonString);
   // perform runtime checks…
   const user = raw as User;
   ```

 **Ban test `any` / `@ts-ignore`**  
   Localize any bypass to a single line and document it with `// TODO:`.

 **Use type-aware tools**  
   Employ `ts-jest` or similar to verify snapshots and mocks against your TS types.
- always use tempdir utilities when making temp dirs in tests
- Also, don't forget that we use superjson exclusively in the web interface and have serialization helpers