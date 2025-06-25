# Lace Coding Standards

## Overview

These coding standards ensure consistency, maintainability, and quality across the Lace codebase. They build on existing project conventions while incorporating best practices from the broader TypeScript/Node.js ecosystem.

## TypeScript Standards

### Type Safety
- **Never use `any`** - Use `unknown` for truly unknown types, then narrow with type guards
- **Explicit nullability** - Use `T | null | undefined` when values might be absent
- **Strict mode required** - All code must compile under TypeScript strict mode
- **Interface over type aliases** for object shapes - better for extension and debugging

```typescript
// ✅ Good
interface ToolConfig {
  name: string;
  timeout?: number;
}

function processInput(input: unknown): string {
  if (typeof input === 'string') {
    return input.trim();
  }
  throw new Error('Invalid input type');
}

// ❌ Bad
function processInput(input: any): string {
  return input.trim(); // No type safety
}
```


### Function Design
- **Pure functions preferred** - Functions should not cause side effects when possible
- **Immutable transformations** - Use array methods instead of mutations
- **Single responsibility** - Functions should do one thing well

```typescript
// ✅ Good - Pure, immutable
function filterCompletedTasks(tasks: Task[]): Task[] {
  return tasks.filter(task => task.status === 'completed');
}

// ❌ Bad - Mutates input
function filterCompletedTasks(tasks: Task[]): Task[] {
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (tasks[i].status !== 'completed') {
      tasks.splice(i, 1); // Mutation!
    }
  }
  return tasks;
}
```

## Testing Standards

### Test Organization
- **Co-location** - Place test files next to source files: `agent.ts` → `agent.test.ts`
- **Descriptive names** - Test files should mirror source file names exactly with `.test.ts` suffix
- **Test structure** - Use `describe` blocks for logical grouping, clear test names

```typescript
// src/agents/agent.test.ts
describe('Agent', () => {
  describe('sendMessage', () => {
    it('should emit turn_start event with correct metrics', async () => {
      // Test implementation
    });
    
    it('should handle provider errors gracefully', async () => {
      // Test implementation  
    });
  });
});
```

### Mocking Strategy
- Create reusable mock factories for complex objects
- Mock external dependencies (Node.js built-ins, SDKs, file system)
- Mocks should behave realistically, not just return dummy data

### Test Quality
- **Test behavior, not implementation** - Focus on what the function does, not how
- **Arrange-Act-Assert pattern** - Clear test structure
- **One assertion per test** - Tests should verify one specific behavior
- **Clean up after tests** - Reset mocks and clean up resources

```typescript
// ✅ Good - Tests behavior
it('should retry failed tool execution once before failing', async () => {
  // Arrange
  const mockTool = createMockTool();
  mockTool.executeTool
    .mockRejectedValueOnce(new Error('Network error'))
    .mockResolvedValueOnce(createSuccessResult(['Success']));
  
  // Act
  const result = await executor.executeTool('test', {});
  
  // Assert
  expect(result.isError).toBe(false);
  expect(mockTool.executeTool).toHaveBeenCalledTimes(2);
});
```


## React/UI Standards

### Component Design
- **Functional components only** - Use hooks for state and lifecycle
- **Pure components** - Minimize side effects in render logic
- **Composition over inheritance** - Build complex UIs from simple components
- **Props interface definition** - Always define explicit prop interfaces

```typescript
// ✅ Good - Pure functional component
interface MessageDisplayProps {
  message: string;
  timestamp: Date;
  type: 'user' | 'agent';
}

export const MessageDisplay: React.FC<MessageDisplayProps> = ({ 
  message, 
  timestamp, 
  type 
}) => {
  const formattedTime = useMemo(() => 
    timestamp.toLocaleTimeString(), [timestamp]
  );
  
  return (
    <Box>
      <Text color={type === 'user' ? 'blue' : 'green'}>
        [{formattedTime}] {message}
      </Text>
    </Box>
  );
};
```

### State Management
- **Immutable state updates** - Never mutate state directly
- **Minimal state** - Derive values when possible instead of storing
- **Local state preferred** - Use context/global state sparingly

```typescript
// ✅ Good - Immutable state updates
const [messages, setMessages] = useState<Message[]>([]);

const addMessage = useCallback((message: Message) => {
  setMessages(prev => [...prev, message]); // Immutable
}, []);

// ❌ Bad - Direct mutation
const addMessage = useCallback((message: Message) => {
  messages.push(message); // Mutation!
  setMessages(messages);
}, [messages]);
```

### Performance
- **Strategic memoization** - Use `useMemo`/`useCallback` for expensive operations
- **Stable references** - Avoid creating new objects in render
- **Efficient list rendering** - Use proper keys for dynamic lists

