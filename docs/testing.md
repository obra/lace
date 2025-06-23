# Testing Guide

This document outlines testing patterns and best practices for the Lace codebase.

## Terminal Interface Testing

### Overview

Testing terminal interfaces presents unique challenges due to the interaction between React components, Ink's rendering system, and terminal input/output handling.

### Testing Patterns

#### 1. Component Structure Testing

For testing component rendering and basic structure without input interaction:

```typescript
import { renderInkComponent } from '../__tests__/helpers/ink-test-utils.js';

it('should render correctly', () => {
  const { lastFrame } = renderInkComponent(<MyComponent />);
  expect(lastFrame()).toContain('expected content');
});
```

#### 2. Input Interaction Testing

**❌ Don't use `stdin.write()` for testing `useInput` handlers:**

```typescript
// This DOESN'T work in test environment
const { stdin } = renderInkComponent(<ShellInput />);
stdin.write('\t'); // Tab key won't reach useInput handler
```

**✅ Mock `useInput` and call handler directly:**

```typescript
// Capture the useInput handler for direct testing
let capturedInputHandler: ((input: string, key: any) => void) | null = null;

vi.mock('ink', async () => {
  const actual = await vi.importActual('ink');
  return {
    ...actual,
    useInput: (handler: (input: string, key: any) => void) => {
      capturedInputHandler = handler;
    }
  };
});

it('should handle Tab key', async () => {
  renderInkComponent(<ShellInput autoFocus={true} />);
  
  // Call handler directly with proper key object
  capturedInputHandler!('\t', { tab: true });
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Test the result
  expect(lastFrame()).toContain('autocomplete items');
});
```

### Why stdin.write() Doesn't Work

The issue is that Ink's input system in test environments doesn't properly connect mock stdin events to `useInput` handlers. The `renderInkComponent` helper creates a mock stdin that emits `'data'` events, but these don't flow through to `useInput` handlers like they do in real terminal environments.

### Key Object Format

When calling `useInput` handlers directly, use the correct key object format:

```typescript
// Common key patterns
capturedInputHandler('a', {}); // Regular character
capturedInputHandler('\t', { tab: true }); // Tab key
capturedInputHandler('\r', { return: true }); // Enter key
capturedInputHandler('', { escape: true }); // Escape key
capturedInputHandler('', { upArrow: true }); // Up arrow
capturedInputHandler('', { downArrow: true }); // Down arrow
capturedInputHandler('c', { ctrl: true }); // Ctrl+C
```

### Focus Management in Tests

Focus-dependent components may need special handling:

```typescript
// If component uses { isActive: isFocused }
it('should handle input when focused', () => {
  renderInkComponent(<MyComponent autoFocus={true} />);
  // Component should be active and handle input
});
```

### Async Operations

Many terminal interactions involve async operations (file completion, API calls):

```typescript
it('should handle async autocomplete', async () => {
  renderInkComponent(<ShellInput value="s" autoFocus={true} />);
  
  capturedInputHandler('\t', { tab: true });
  
  // Wait for async completion loading
  await new Promise(resolve => setTimeout(resolve, 100));
  
  expect(lastFrame()).toContain('src/');
});
```

### Testing Philosophy

1. **Test real behavior, not implementation details**
2. **Mock external dependencies, not core React/Ink behavior**
3. **Use direct handler calls for input testing**
4. **Test component structure separately from interaction logic**

### Common Pitfalls

- **Don't mock `renderInkComponent`** - it provides essential terminal environment simulation
- **Don't test stdin events directly** - they don't connect to `useInput` in tests
- **Don't forget async waits** - autocomplete, file operations, and rendering can be async
- **Don't forget focus state** - many input handlers require `autoFocus={true}` or proper focus management

### Integration vs Unit Tests

- **Unit tests**: Mock `useInput`, test individual component logic
- **Integration tests**: Test full terminal interface with real command processing
- **E2E tests**: Test actual terminal interaction through CLI

For complex input interactions like autocomplete, prefer the unit test approach with mocked `useInput` handlers for reliability and speed.