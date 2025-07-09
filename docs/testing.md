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

## Interactive E2E Testing with node-pty

### Overview

For true end-to-end testing of the terminal interface, Lace uses `node-pty` to spawn real pseudo-terminal processes and simulate actual user interactions. This approach tests the complete CLI experience including keyboard input, screen output, and command execution.

The testing infrastructure provides clean, reusable utilities that eliminate boilerplate and make E2E tests focused on the actual testing logic.

### Setup

Interactive E2E tests use shared utilities from `src/__tests__/helpers/terminal-e2e-helpers.ts`:

```typescript
import { it, expect } from 'vitest';
import {
  describeE2E,
  createPTYSession,
  waitForText,
  waitForReady,
  sendCommand,
  getOutput,
  closePTY,
  HELP_COMMAND_TIMEOUT,
  AGENT_RESPONSE_TIMEOUT,
  type PTYSession,
} from './helpers/terminal-e2e-helpers.js';
```

### Basic Test Structure

```typescript
/**
 * @vitest-environment node
 */

import { it, expect } from 'vitest';
import { describeE2E, createPTYSession, waitForReady, sendCommand, getOutput, closePTY } from './helpers/terminal-e2e-helpers.js';

describeE2E('My Terminal Tests', () => {
  it.sequential('should handle user interaction', async () => {
    const session = await createPTYSession();
    
    try {
      // Wait for application to be ready
      await waitForReady(session);
      
      // Send commands and verify output
      await sendCommand(session, '/help');
      
      const output = getOutput(session);
      expect(output).toContain('Available commands');
      
    } finally {
      closePTY(session);
    }
  });
});
```

### Available Utilities

#### Session Management
- `createPTYSession(provider?, timeout?)` - Create a new PTY session
- `closePTY(session)` - Clean up PTY session
- `getOutput(session)` - Get raw terminal output
- `getCleanOutput(session)` - Get ANSI-stripped output

#### Input Simulation
- `sendCommand(session, command)` - Send command with proper Enter key
- `waitForText(session, text, timeout?)` - Wait for specific text to appear
- `waitForReady(session, timeout?)` - Wait for application to be ready for commands

#### Environment Management
- `describeE2E(name, testFn)` - Describe block with automatic environment setup/teardown
- `setupE2EEnvironment()` - Manual environment setup
- `cleanupE2EEnvironment(env)` - Manual environment cleanup

#### Constants
- `POLLING_INTERVAL` - How often to check for text (50ms)
- `DEFAULT_TIMEOUT` - Default timeout for operations (10s)  
- `COMMAND_DELAY` - Delay between typing and Enter (100ms)
- `PTY_SESSION_TIMEOUT` - Session creation timeout (30s)
- `HELP_COMMAND_TIMEOUT` - Help command response timeout (15s)
- `AGENT_RESPONSE_TIMEOUT` - Agent response timeout (15s)

### Example Test

```typescript
describeE2E('PTY Terminal E2E Tests', () => {
  it.sequential('should handle /help command', async () => {
    const session = await createPTYSession();
    
    try {
      // Wait for ready state
      await waitForReady(session);
      
      // Send /help command
      await sendCommand(session, '/help');
      
      // Wait for help output
      await waitForText(session, 'Available commands', HELP_COMMAND_TIMEOUT);
      
      const output = getOutput(session);
      expect(output).toContain('Available commands');
      expect(output).toContain('/exit');
      
    } finally {
      closePTY(session);
    }
  }, 30000);
});
```

### Key Implementation Details

#### 1. **Shared Utilities**
The `terminal-e2e-helpers.ts` file provides all necessary utilities:
- Eliminates boilerplate from test files
- Provides consistent behavior across all E2E tests
- Includes proper Enter key handling (Control+M)
- Handles environment isolation automatically

#### 2. **Environment Isolation**
Each test gets its own isolated environment using `describeE2E()`:
- Unique database path per test run
- Automatic cleanup after tests
- Proper environment variable management

#### 3. **Timing and Synchronization**
Use `waitForReady()` helper instead of manual waits:
```typescript
// ✅ Correct - uses helper
await waitForReady(session);

// ❌ Avoid - manual timing
await waitForText(session, 'Ready');
await waitForText(session, '> ');
await new Promise(resolve => setTimeout(resolve, 1000));
```

#### 4. **Clean Output Handling**
Use appropriate output functions:
```typescript
// Raw output (includes ANSI)
const output = getOutput(session);

// Clean output (ANSI stripped)
const cleanOutput = getCleanOutput(session);
```

#### 5. **Configurable Timeouts**
Use predefined constants for consistent timing:
```typescript
// Use constants for predictable timeouts
await waitForText(session, 'Available commands', HELP_COMMAND_TIMEOUT);
await waitForText(session, '4', AGENT_RESPONSE_TIMEOUT);
```

### Benefits of PTY Testing

1. **Complete Integration**: Tests the actual CLI binary as users would run it
2. **Real Terminal Environment**: Tests genuine terminal interactions including ANSI sequences
3. **Keyboard Event Handling**: Tests actual keyboard input processing
4. **Screen Output Validation**: Validates what users actually see on screen
5. **Command Processing**: Tests slash commands and agent interactions end-to-end
6. **Reusable Infrastructure**: Clean utilities reduce test complexity

### Best Practices

1. **Use `describeE2E()`** for automatic environment management
2. **Use `waitForReady()`** instead of manual readiness checks
3. **Use sequential tests** (`it.sequential`) to avoid resource conflicts
4. **Clean up PTY sessions** in finally blocks to prevent hanging processes
5. **Use appropriate timeout constants** for different operations
6. **Test one workflow per test** to isolate failures
7. **Import only needed utilities** to keep tests focused

### Common Pitfalls

- **Don't recreate utilities** - use the shared helpers
- **Don't skip `waitForReady()`** - commands may not execute properly
- **Don't forget cleanup** - always close PTY sessions in finally blocks
- **Don't test multiple workflows in one test** - harder to debug when they fail
- **Don't use manual environment setup** - use `describeE2E()` instead

### Example Test Files

See `src/__tests__/e2e-pty-terminal.test.ts` for complete examples of the clean PTY testing approach.