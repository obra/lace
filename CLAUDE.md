# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 📍 Finding Your Way

**[CODE-MAP](docs/architecture/CODE-MAP.md)** - Complete directory structure showing where everything lives in the codebase.

## Project Overview

Lace is a sophisticated AI coding assistant built as a TypeScript monorepo. The core uses event-sourcing architecture with immutable conversation sequences that enable resumable conversations across process restarts. It supports multiple interface types including a React Router v7 web interface with project/session/task management.

## Development Commands

### Build and Run
```bash
npm run build        # Build core and web packages
npm run dev          # Start web dev server (packages/web)
npm run lint         # ESLint checking across workspaces
npm run lint:fix     # Auto-fix linting issues
npm run format       # Format code with Prettier
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

### SQL Profiling
```bash
# Enable SQL profiling to log all database queries with timing
LACE_SQL_PROFILING=true LACE_LOG_LEVEL=debug npm run dev

# Or with file output
LACE_SQL_PROFILING=true LACE_LOG_LEVEL=debug LACE_LOG_FILE=sql-profile.log npm run dev
```

When `LACE_SQL_PROFILING=true`:
- All SQL queries are logged at DEBUG level with execution time, parameters, and row counts
- Slow queries (>100ms) are additionally logged at INFO level
- Zero overhead when disabled - no performance impact on production
- Logs include operation type (run/get/all/exec), duration, affected/returned rows

### Testing
```bash
npm test            # Run tests in watch mode
npm run test    # Run tests once
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

We NEVER leave backward-compatibility or legacy code in place. This is a pre-release v1 and we car e deeply about having a clean, uncluttered architecture. If you EVER see back-compat code, stop and ask me what to do.

### Development Notes
- Pre-commit hooks automatically run linting, formatting, and related tests
- All code must pass TypeScript strict mode compilation

### Import Style

**Core Package (`packages/core`):**
- Use `~/*` path aliases for internal imports: `import { Agent } from '~/agents/agent'`
- **Omit file extensions** in source code
- The `~` prefix maps to the `packages/core/src/` directory

**Web Package (`packages/web`):**
- Use `@/` path aliases for internal imports: `import { Button } from '@/components/ui/button'`
- Import from core package using workspace reference: `import { Agent } from '@lace/core/agents/agent'`
- React Router v7 file-based routing in `app/routes/`

**Never use inline imports** - always declare at the top:
  - <bad>`const taskTool = tool as { getTaskManager?: () => import('~/tasks/task-manager').TaskManager }`</bad>
  - <good>`import type { TaskManager } from '~/tasks/task-manager'` (at top)</good>

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

**Agent System (`packages/core/src/agents/agent.ts`)**
- Event-driven conversation engine with state machine: `idle → thinking → streaming → tool_execution → idle`
- Emits events for UI updates: `agent_thinking_start/complete`, `tool_call_start/complete`, `state_change`
- Token budget management and streaming response handling
- Abort functionality for long-running operations
- Supports multiple concurrent agents (not a singleton)

**Thread Management (`packages/core/src/threads/`)**
- **ThreadManager**: High-level thread operations and event coordination
- SQLite-based persistence with graceful degradation to memory-only
- Stateless design - can rebuild conversation from events at any time
- `buildConversationFromEvents()` converts event sequences to provider-specific formats

**Tool System (`packages/core/src/tools/`)**
- **ToolExecutor**: Central tool management with approval workflow integration
- **MCP (Model Context Protocol)** integration for external tools
- Categories: file operations, system operations, workflow tools
- User approval system with configurable policies
- Safe execution with error handling and thread-aware context passing
- Model-agnostic interface supporting all AI providers

**Provider System (`packages/core/src/providers/`)**
- Abstraction layer supporting multiple AI providers (Anthropic, OpenAI, LMStudio, Ollama, OpenRouter)
- Provider catalogs with model discovery and capabilities
- Instance management for provider configurations
- Streaming support where available
- Registry system with auto-discovery

**Project & Session System (`packages/core/src/projects/`, `packages/core/src/sessions/`)**
- **Projects**: Top-level containers with environment variables and settings
- **Sessions**: Conversation contexts within projects
- **Tasks**: Work items with status tracking and agent assignment
- **MCP integration**: External tool servers and capabilities per project/session

**Web Interface (`packages/web/`)**
- **React Router v7** with file-based routing (`app/routes/`)
- **Global EventStreamManager** for real-time SSE updates
- **API client** with centralized error handling and retry logic
- **DaisyUI + Tailwind CSS** component system
- **Project → Session → Agent/Task hierarchy** in UI


## Event Model

Events include: USER_MESSAGE, AGENT_MESSAGE, TOOL_CALL, TOOL_RESULT, THINKING, SYSTEM_PROMPT, USER_SYSTEM_PROMPT.

**Critical**: Events must be processed in sequence for conversation reconstruction.

## Technology Stack

- **TypeScript 5.6+** with strict mode
- **Node.js 20.18+** with ES modules
- **SQLite** (better-sqlite3) for persistence
- **React Router v7** for web interface (file-based routing)
- **React 18.3** with modern patterns
- **Vitest and Playwright** for testing
- **ESLint + Prettier** for code quality
- **Monorepo** with npm workspaces (`packages/core`, `packages/web`)

**CSS Architecture:**
- **Tailwind CSS** for utility-first styling
- **DaisyUI** for component library and themes  
- **CSS Variables** for dynamic theming and font management

## UI Component System Philosophy

**Our component system is built on a core principle: strongly-typed, developer-friendly wrappers around DaisyUI components.**

### The Problem
Raw DaisyUI usage is error-prone and inconsistent:
```tsx
// Easy to mess up - typos, wrong structure, missing features
<div className="alert alert-sucess"> {/* typo! */}
  <span>Some message</span> {/* no icon, inconsistent structure */}
</div>
```

### Our Solution
Strongly-typed component wrappers that prevent developer errors:
```tsx
// Can't mess this up - typed, structured, consistent
<Alert variant="success" title="Settings saved" description="Changes applied" />
```

### Component Design Principles

1. **Strong TypeScript Interfaces**
   - Use union types for variants: `type AlertVariant = 'success' | 'warning' | 'error' | 'info'`
   - Required and optional props clearly defined
   - No room for typos or invalid configurations

2. **Named Semantic Props**
   - `title`, `description`, `variant` instead of raw markup
   - Props that map to the component's purpose, not implementation
   - Clear developer intent through prop names

3. **Built-in Best Practices**
   - Consistent icon usage per variant
   - Proper accessibility attributes
   - Standard features like dismiss functionality
   - Responsive design patterns

4. **DaisyUI Foundation**
   - Always use DaisyUI classes under the hood (`alert alert-success`, `btn btn-primary`, etc.)
   - Leverage DaisyUI's theming system
   - Inherit DaisyUI's accessibility features
   - Stay consistent with DaisyUI's design language

5. **Consistent Structure**
   - Standardized content hierarchy (title/description/children)
   - Predictable prop patterns across similar components
   - Uniform styling approach

### Example: Alert Component Architecture
```tsx
// DaisyUI foundation with typed wrapper
export function Alert({ variant, title, description, onDismiss }: AlertProps) {
  const config = alertConfig[variant]; // Type-safe config lookup
  
  return (
    <div className={`alert ${config.alertClass}`}> {/* DaisyUI classes */}
      <FontAwesomeIcon icon={config.icon} />     {/* Consistent icons */}
      <div>
        <div className="font-medium">{title}</div>        {/* Structured content */}
        {description && <div className="opacity-80">{description}</div>}
      </div>
      {onDismiss && <DismissButton onClick={onDismiss} />} {/* Standard features */}
    </div>
  );
}
```

### Benefits
- **Developer Experience**: Clear props, strong typing, IntelliSense support
- **Consistency**: Uniform patterns across the entire application
- **Maintainability**: Centralized styling and behavior changes
- **Quality**: Impossible to create malformed components
- **Accessibility**: Built-in best practices and ARIA attributes
- **Theming**: Automatic DaisyUI theme support

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
- **Core tools**: file operations (read/write/edit), system operations (bash/url-fetch)
- **MCP integration**: External tools via Model Context Protocol
- **Session/Project management**: Tasks, delegation, project context
- Safe execution with error handling and context passing

### Thread Management
- SQLite persistence with graceful degradation to memory-only
- Resumable conversations with `--continue` flag
- Delegate thread management for sub-conversations

### Web API Architecture

**Centralized API Client (`packages/web/lib/api-client.ts`)**:
- Structured error handling with retry logic
- Timeout support and abort signal handling
- Automatic JSON parsing with SuperJSON serialization
- Type-safe request/response interfaces

**API Route Structure**:
```
/api/projects/:projectId/sessions/:sessionId/tasks     # Task CRUD
/api/agents/:agentId/message                          # Agent messaging
/api/threads/:threadId/approvals                      # Tool approvals
/api/events/stream                                    # Global SSE stream
/api/mcp/servers                                      # MCP server management
```

**Real-time Updates**:
- **Global EventStreamManager** singleton
- "Firehose" SSE pattern - single stream, client-side filtering
- Automatic Session registration forwards TaskManager events
- LaceEvent format with context hierarchy (project/session/thread/task)


## Testing Strategy

- **Unit Tests**: Individual component behavior
- **Integration Tests**: Cross-component interactions
- **E2E Tests**: Full conversation workflows
- **Co-location**: Test files next to source files (e.g., `agent.ts` → `agent.test.ts`)
- **Vitest**: Primary testing framework for both packages
- **Playwright**: E2E testing for web interface
- **MSW**: API mocking for frontend tests
- **React Testing Library**: Component testing patterns

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

- **Environment**: LACE_DIR for data storage
- **User Settings**: Stored in database with config management
- **Agent Personas**: Template-based generation in `packages/core/config/agent-personas/`
- **MCP Servers**: Configuration for external tool integration
- **Provider Settings**: API keys and model configurations
- **Project Settings**: Environment variables and MCP server assignments
- **Database**: SQLite storage in LACE_DIR with graceful degradation

## Security & Safety

- User approval required for all destructive operations
- Complete audit trail of tool executions
- Local-only data storage (SQLite)
- Read-only vs destructive tool classification
- Configurable approval policies



### Server-Side Debugging

You MUST NEVER use console.log for server-side debugging. Instead, use the `logger` system and inspect the logs after runs.

### Web Development Debugging  
For the React Router web interface (`packages/web`), browser console messages are automatically forwarded to your development server terminal. This means you CAN use `console.log`, `console.error`, etc. in React components and client-side code - they will appear in your server logs with colored `[BROWSER]` prefixes and proper object serialization (including circular references and dates).

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
  - <bad>`manager.deleteTask(taskId, context);`</bad>
  - <good>`await manager.deleteTask(taskId, context);`</good>
  - <good>`void manager.deleteTask(taskId, context);`</good>

- **@typescript-eslint/no-unsafe-assignment**: Never use `any` type without proper typing
  - <bad>`const data = await response.json();`</bad>
  - <good>`const data = (await response.json()) as { error: string };`</good>

- **@typescript-eslint/no-unused-vars**: Remove unused imports and variables
  - <bad>`import type { SessionService } from '@/lib/server/session-service';` (if not used)</bad>
  - <good>Only import what you actually use</good>

- **@typescript-eslint/no-explicit-any**: Avoid using `any` type
  - <bad>`} as any;`</bad>
  - <good>`} as typeof TextEncoder;`</good>

### React Router v7 Specific Rules
- **no-relative-import-paths**: Use absolute imports with @ prefix
  - <bad>`import { loader } from '../route';`</bad>
  - <good>`import { loader } from '@/routes/api.projects.$projectId.tasks';`</good>
- **File-based routing**: Routes must be defined in both `app/routes/` files AND `app/routes.ts`
  - Route files use dot notation: `api.projects.$projectId.sessions.$sessionId.tasks.ts`
  - Frontend routes: `project.$projectId.session.$sessionId.agent.$agentId.tsx`
  - Must also register in `routes.ts`: `route('api/projects/:projectId/sessions/:sessionId/tasks', 'routes/api.projects.$projectId.sessions.$sessionId.tasks.ts')`


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

- explain the WHY any time you disable a linting rule
