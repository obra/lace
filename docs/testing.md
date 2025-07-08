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

### Setup

Interactive E2E tests use `node-pty` which is already included as a dev dependency:

```typescript
import * as pty from 'node-pty';
```

### Basic Test Structure

```typescript
/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as pty from 'node-pty';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface PTYSession {
  terminal: pty.IPty;
  output: string;
  timeoutId: NodeJS.Timeout;
}

describe('Interactive E2E Tests', () => {
  let tempDbPath: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Set up isolated test environment
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    tempDbPath = path.join(os.tmpdir(), `lace-e2e-test-${uniqueId}.db`);
    originalEnv = process.env.LACE_DIR;
    process.env.LACE_DIR = path.dirname(tempDbPath);
  });

  afterEach(() => {
    // Clean up test environment
    if (originalEnv !== undefined) {
      process.env.LACE_DIR = originalEnv;
    } else {
      delete process.env.LACE_DIR;
    }

    try {
      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  });
```

### PTY Session Management

Create helper functions for managing pseudo-terminal sessions:

```typescript
/**
 * Helper to create a PTY session
 */
async function createPTYSession(timeout = 30000): Promise<PTYSession> {
  return new Promise((resolve, reject) => {
    const terminal = pty.spawn('node', ['dist/cli.js', '--provider', 'lmstudio'], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: {
        ...process.env,
        LACE_DIR: process.env.LACE_DIR,
        LACE_TEST_MODE: 'true',
        TERM: 'xterm-color',
      },
    });

    let output = '';
    
    terminal.onData((data) => {
      output += data;
    });

    const timeoutId = setTimeout(() => {
      terminal.kill();
      reject(new Error(`PTY session timed out after ${timeout}ms`));
    }, timeout);

    const session: PTYSession = {
      terminal,
      get output() { return output; },
      timeoutId,
    };

    resolve(session);
  });
}

/**
 * Helper to close PTY session
 */
function closePTY(session: PTYSession): void {
  clearTimeout(session.timeoutId);
  session.terminal.kill();
}
```

### Keyboard Input Simulation

Send keyboard input to the terminal using proper control characters:

```typescript
/**
 * Helper to send text to PTY session
 */
function sendText(session: PTYSession, text: string): void {
  session.terminal.write(text);
}

/**
 * Helper to send Enter key to PTY session
 */
function sendEnter(session: PTYSession): void {
  // Use Control+M (ASCII 13) for proper Enter key handling
  session.terminal.write('\x0d');
}

/**
 * Helper to send command with enter in one go
 */
async function sendCommand(session: PTYSession, command: string): Promise<void> {
  session.terminal.write(command);
  // Small delay then send enter
  await new Promise(resolve => setTimeout(resolve, 100));
  session.terminal.write('\x0d'); // Control+M (ASCII 13)
}
```

### Output Waiting and Validation

Wait for specific output to appear on screen:

```typescript
/**
 * Helper to wait for specific text in PTY output
 */
async function waitForText(session: PTYSession, expectedText: string, timeout = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkOutput = () => {
      if (session.output.includes(expectedText)) {
        resolve();
        return;
      }
      
      if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout waiting for text: "${expectedText}". Got: "${stripAnsi(session.output.slice(-500))}"`));
        return;
      }
      
      setTimeout(checkOutput, 50);
    };
    
    checkOutput();
  });
}

/**
 * Helper to strip ANSI escape sequences from text
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

/**
 * Helper to get clean output from session (ANSI stripped)
 */
function getCleanOutput(session: PTYSession): string {
  return stripAnsi(session.output);
}
```

### Example Test

```typescript
it.sequential('should handle /help command and display slash commands', async () => {
  const session = await createPTYSession();
  
  try {
    // Wait for ready state
    await waitForText(session, 'Ready');
    
    // Wait for the input prompt to appear
    await waitForText(session, '> ');
    
    // Give extra time for command executor to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Send /help command
    await sendCommand(session, '/help');
    
    // Wait for help output
    await waitForText(session, 'Available commands', 15000);
    
    const output = getCleanOutput(session);
    expect(output).toContain('Available commands');
    expect(output).toContain('/exit');
    
  } finally {
    closePTY(session);
  }
}, 30000);
```

### Key Implementation Details

#### 1. **Proper Enter Key Handling**
Use Control+M (`\x0d`, ASCII 13) instead of newline (`\n`) or carriage return (`\r`) for proper terminal Enter key simulation:

```typescript
// ✅ Correct - works with terminal interface
session.terminal.write('\x0d');

// ❌ Incorrect - doesn't trigger command execution
session.terminal.write('\r');
session.terminal.write('\n');
```

#### 2. **Environment Isolation**
Each test gets its own isolated environment:

```typescript
// Unique database path for each test
const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
tempDbPath = path.join(os.tmpdir(), `lace-e2e-test-${uniqueId}.db`);
process.env.LACE_DIR = path.dirname(tempDbPath);
```

#### 3. **Timing and Synchronization**
Wait for application readiness before sending commands:

```typescript
// Wait for application to be ready
await waitForText(session, 'Ready');

// Wait for input prompt
await waitForText(session, '> ');

// Give command processor time to initialize
await new Promise(resolve => setTimeout(resolve, 1000));
```

#### 4. **Clean Output Handling**
Strip ANSI escape sequences for readable test output and debugging:

```typescript
// Error messages use clean output
reject(new Error(`Timeout waiting for text: "${expectedText}". Got: "${stripAnsi(session.output.slice(-500))}"`));

// Test assertions use clean output
const output = getCleanOutput(session);
expect(output).toContain('Available commands');
```

### Benefits of PTY Testing

1. **Complete Integration**: Tests the actual CLI binary as users would run it
2. **Real Terminal Environment**: Tests genuine terminal interactions including ANSI sequences
3. **Keyboard Event Handling**: Tests actual keyboard input processing
4. **Screen Output Validation**: Validates what users actually see on screen
5. **Command Processing**: Tests slash commands and agent interactions end-to-end

### Best Practices

1. **Use sequential tests** (`it.sequential`) to avoid resource conflicts
2. **Clean up PTY sessions** in finally blocks to prevent hanging processes
3. **Set appropriate timeouts** for different operations (help commands vs agent responses)
4. **Wait for readiness signals** before sending input
5. **Use clean output** for assertions and debugging
6. **Test one workflow per test** to isolate failures
7. **Include provider-specific setup** if testing with specific AI providers

### Common Pitfalls

- **Don't use `\r` or `\n` for Enter** - use `\x0d` (Control+M)
- **Don't skip readiness waits** - commands may not execute if sent too early
- **Don't forget cleanup** - always close PTY sessions in finally blocks
- **Don't test multiple workflows in one test** - harder to debug when they fail
- **Don't ignore ANSI sequences** - use `stripAnsi()` for clean comparisons

### Example Test Files

See `src/__tests__/e2e-pty-terminal.test.ts` for complete examples of PTY testing patterns.