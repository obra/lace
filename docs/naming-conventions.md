# Naming Conventions

## Files and Directories

- **Files**: `kebab-case.ts` (e.g., `bash-tool.ts`, `thread-manager.ts`)
- **Directories**: `kebab-case/` (e.g., `src/agents/`, `src/tools/implementations/`)
- **Test files**: `*.test.ts` alongside source files

## Classes and Types

- **Classes**: `PascalCase` (e.g., `Agent`, `ToolRegistry`, `ThreadManager`)
- **Interfaces**: `PascalCase` with descriptive names (e.g., `Tool`, `ThreadEvent`, `AgentConfig`)
- **Type aliases**: `PascalCase` (e.g., `EventType`, `ToolResult`)
- **Enums**: `PascalCase` with `UPPER_CASE` values (e.g., `EventType.USER_MESSAGE`)

## Functions and Variables

- **Functions**: `camelCase` with clear, imperative verbs (e.g., `executeTool`, `createMessage`, `parseResponse`)
- **Variables**: `camelCase` with descriptive nouns (e.g., `threadId`, `toolResult`, `messageContent`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `DEFAULT_MAX_TOKENS`, `BASH_TOOL_NAME`)
- **Private members**: Prefix with `_` (e.g., `_apiKey`, `_executeInternal`)

## Specific Patterns

### Action Functions
Use clear imperative verbs that describe exactly what happens:
- `readFile` not `getFile`
- `createThread` not `newThread`
- `executeCommand` not `runCommand`
- `parseMessage` not `processMessage`

### Boolean Variables/Functions
- Variables: `isEnabled`, `hasError`, `canExecute`
- Functions: `isValid()`, `hasPermission()`, `canAccess()`

### Collections
- Use plural nouns: `tools`, `events`, `messages`
- Avoid generic names like `items`, `data`, `list`

### Event Types
Use `UPPER_SNAKE_CASE` for clarity:
- `USER_MESSAGE`
- `AGENT_MESSAGE` 
- `TOOL_CALL`
- `TOOL_RESULT`

## Examples

```typescript
// Good
class ThreadManager {
  private _events: ThreadEvent[] = [];
  
  createThread(threadId: string): Thread {
    return new Thread(threadId);
  }
  
  addEvent(event: ThreadEvent): void {
    this._events.push(event);
  }
}

interface Tool {
  name: string;
  executeCommand(input: ToolInput): Promise<ToolResult>;
}

type EventType = 'USER_MESSAGE' | 'AGENT_MESSAGE' | 'TOOL_CALL' | 'TOOL_RESULT';

// Avoid
class threadmanager {  // Wrong case
  data: any[];         // Too generic
  
  doStuff(): void {    // Unclear action
    // ...
  }
}
```