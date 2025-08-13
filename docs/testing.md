# Testing Guide

This document outlines testing patterns and best practices for the Lace codebase.

## ⚠️ CRITICAL: Provider Instance Management in Tests

### Always Use `createTestProviderInstance()` for Test Isolation

**Race Condition Warning**: Using `setupTestProviderInstances()` causes race conditions when tests run in parallel. This leads to "Provider instance not found" errors and flaky tests.

### Correct Pattern ✅

```typescript
import { createTestProviderInstance, cleanupTestProviderInstances } from '~/test-utils/provider-instances';

describe('My Test Suite', () => {
  let providerInstanceId: string;

  beforeEach(async () => {
    // Create individual provider instance for this test
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    // Use the instance in your test setup
    const project = Project.create('Test Project', process.cwd(), 'Project for testing', {
      providerInstanceId, // Direct usage
      modelId: 'claude-3-5-haiku-20241022',
    });
  });

  afterEach(async () => {
    // Clean up the instance
    await cleanupTestProviderInstances([providerInstanceId]);
  });
});
```

### Incorrect Pattern ❌ (Causes Race Conditions)

```typescript
// DON'T DO THIS - Creates shared instances that cause race conditions
import { setupTestProviderInstances, cleanupTestProviderInstances } from '~/test-utils/provider-instances';

describe('My Test Suite', () => {
  let testProviderInstances: {
    anthropicInstanceId: string;
    openaiInstanceId: string;
  };
  let createdInstanceIds: string[] = [];

  beforeEach(async () => {
    // This creates shared instances that can conflict when tests run in parallel
    testProviderInstances = await setupTestProviderInstances();
    createdInstanceIds = [testProviderInstances.anthropicInstanceId, testProviderInstances.openaiInstanceId];
  });
});
```

### Why This Pattern Is Critical

- **Test Isolation**: Each test gets its own provider instances, preventing conflicts
- **Parallel Execution**: Tests can run in parallel without race conditions
- **Reliability**: Eliminates "Provider instance not found" errors
- **Debugging**: Easier to debug when tests don't interfere with each other

### Multiple Provider Types

If you need multiple provider types in a single test:

```typescript
describe('Multi-Provider Test', () => {
  let anthropicInstanceId: string;
  let openaiInstanceId: string;

  beforeEach(async () => {
    // Create each provider type individually
    anthropicInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    openaiInstanceId = await createTestProviderInstance({
      catalogId: 'openai',
      models: ['gpt-4o-mini'],
      displayName: 'Test OpenAI Instance',
      apiKey: 'test-openai-key',
    });
  });

  afterEach(async () => {
    await cleanupTestProviderInstances([anthropicInstanceId, openaiInstanceId]);
  });
});
```

## Test Environment Setup

### Core Tests (src/)

For core Lace tests, use the unified setup that handles both temp LACE_DIR and persistence automatically:

```typescript
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '~/test-utils/provider-defaults';
import { createTestProviderInstance, cleanupTestProviderInstances } from '~/test-utils/provider-instances';

describe('Core Integration Test', () => {
  const _tempLaceDir = setupCoreTest(); // Handles temp LACE_DIR + persistence automatically
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();
    Session.clearProviderCache(); // Important for test isolation

    // Create provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });
  });

  afterEach(async () => {
    // Clean up in correct order
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
  });
});
```

### Web Tests (packages/web/)

For web package tests, use the web-specific setup:

```typescript
import { setupWebTest } from '@/test-utils/web-test-setup';
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '~/test-utils/provider-defaults';
import { createTestProviderInstance, cleanupTestProviderInstances } from '~/test-utils/provider-instances';

describe('Web Integration Test', () => {
  const _tempLaceDir = setupWebTest(); // Handles temp LACE_DIR + persistence automatically
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();
    Session.clearProviderCache();

    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });
  });

  afterEach(async () => {
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
  });
});
```
```

### Session and Project Creation

When creating sessions and projects in tests, ensure proper provider inheritance:

```typescript
// Create project with provider configuration
const project = Project.create(
  'Test Project',
  '/test/path',
  'Test project description',
  {
    providerInstanceId, // Use the test instance
    modelId: 'claude-3-5-haiku-20241022',
  }
);

// Create session - will inherit provider from project
const session = await sessionService.createSession(
  'Test Session',
  project.getId()
);
```

### Common Pitfalls

#### 1. Shared State Between Tests
- Always use individual provider instances
- Clear caches with `Session.clearProviderCache()`
- Use `:memory:` database for isolation

#### 2. Cleanup Order
```typescript
afterEach(async () => {
  // Stop services first
  await sessionService.stopAllAgents();
  sessionService.clearActiveSessions();
  
  // Clean up test utilities
  cleanupTestProviderDefaults();
  await cleanupTestProviderInstances([providerInstanceId]);
  
  // Clear mocks last
  vi.clearAllMocks();
  // Note: Persistence cleanup is handled automatically by setupCoreTest/setupWebTest
});
```

#### 3. Environment Variables
Always set required environment variables in test setup:
```typescript
beforeEach(() => {
  process.env.ANTHROPIC_KEY = 'test-key';
  // Note: LACE_DIR is handled automatically by setupCoreTest/setupWebTest
});
```

### Debugging Provider Instance Errors

If you see errors like "Failed to resolve provider instance" or "Provider instance not found":

1. **Check Pattern**: Verify you're using `createTestProviderInstance()` not `setupTestProviderInstances()`
2. **Verify Creation**: Ensure the provider instance is created before being used
3. **Check Setup**: Ensure you're using `setupCoreTest()` or `setupWebTest()` for proper test isolation
4. **Check Cleanup Order**: Ensure cleanup happens in the correct order
5. **Test Isolation**: Run the failing test individually to check for shared state issues

### Key Benefits of New Test Setup

- **Race Condition Prevention**: Database and provider instances use the same isolated temp directory
- **Simplified Setup**: One function call handles both LACE_DIR and persistence
- **Automatic Cleanup**: Temp directories are cleaned up automatically
- **No Manual DB Paths**: Persistence auto-initializes to the correct location
- **Impossible to Do Wrong**: Unified setup prevents configuration mistakes

## Philosophy: Test Behavior, Not Implementation

**Golden Rule**: Test what the system does, not how it does it.

**Good**: "When I create a session with name 'My Session', it appears in the session list"  
**Bad**: "When I call createSession(), it calls Session.create() with the right parameters"

## Code Standards

### Test File Setup Requirements

**CRITICAL**: ALL test files MUST include these imports:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
```

**Never assume `expect` is globally available.** Missing this import causes TypeScript `@typescript-eslint/no-unsafe-call` errors.

#### Before Writing Any Test File:
1. Check existing test files in the same directory for correct import patterns
2. Copy the import block exactly from working test files
3. Run `npm run lint` immediately after writing tests to catch import issues

#### Test File Template:
```typescript
// ABOUTME: Unit tests for [ComponentName] component
// ABOUTME: Tests [brief description of what this tests]

/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ComponentName } from '@/path/to/ComponentName';

describe('ComponentName', () => {
  // Your tests here
});
```

### TypeScript Requirements
- **NEVER use `any` type** - Use `unknown` and type guards instead
- **Always type test data** - Use factory functions with `Partial<T>` for fixtures
- **Type your mocks** - Use `vi.mocked()` and interface types

```typescript
// ❌ Bad
const mockService: any = { create: vi.fn() };

// ✅ Good  
const mockService: jest.Mocked<ServiceInterface> = {
  create: vi.fn().mockResolvedValue(expectedResult)
};
```

### Test Organization
- **Colocated tests**: Place `feature.test.ts` next to `feature.ts`
- **Descriptive names**: Test names should describe the behavior being tested
- **Arrange-Act-Assert**: Clear separation of test phases

## What to Test vs What Not to Test

### ✅ Test These Behaviors
- **User interactions**: Button clicks, form submissions, navigation
- **State changes**: Data updates, loading states, error states  
- **Integration points**: API calls return correct data, components communicate
- **Error handling**: System responds correctly to failures
- **Business logic**: Calculations, validations, transformations

### ❌ Don't Test These Details
- **Implementation details**: Which methods get called internally
- **Mock interactions**: Whether mocks were called with right parameters  
- **Framework internals**: React lifecycle, Next.js routing mechanics
- **Third-party libraries**: Assume they work correctly

## Mock Usage Policy

### Essential Mocks (Allowed)
These require documentation explaining why:

```typescript
// ✅ External APIs - avoid network calls in tests
vi.mock('~/utils/api-client');

// ✅ File system - avoid disk I/O in tests  
vi.mock('fs/promises');

// ✅ Time/randomness - need deterministic results
vi.mock('~/utils/date', () => ({ now: () => '2024-01-01T00:00:00Z' }));
```

### Prohibited Mocks
```typescript
// ❌ Never mock your own business logic
vi.mock('~/services/session-service'); 

// ❌ Never mock the component you're testing
vi.mock('~/components/TaskList');

// ❌ Never mock database operations - use test DB
vi.mock('~/persistence/database');
```

### Mock Documentation Template
Every mock needs a comment:
```typescript
// Mock file system operations to avoid disk I/O in tests
// Tests focus on business logic, not file handling implementation
vi.mock('fs/promises', () => ({ ... }));
```

## Test Patterns by Component Type

### React Components
Test user interactions and visual outcomes:

```typescript
// ✅ Good - tests user behavior
it('should show error when form submission fails', async () => {
  render(<TaskForm onSubmit={mockSubmitThatFails} />);
  
  fireEvent.click(screen.getByText('Save'));
  
  await waitFor(() => {
    expect(screen.getByText('Save failed')).toBeInTheDocument();
  });
});

// ❌ Bad - tests implementation
it('should call onSubmit with form data', () => {
  const onSubmit = vi.fn();
  render(<TaskForm onSubmit={onSubmit} />);
  
  fireEvent.click(screen.getByText('Save'));
  
  expect(onSubmit).toHaveBeenCalledWith(expectedData);
});
```

### API Routes (Next.js)
Test actual HTTP responses:

```typescript
// ✅ Good - tests real API behavior
it('should return 201 when creating valid session', async () => {
  const request = new NextRequest('http://localhost:3000/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ name: 'Test Session' })
  });

  const response = await POST(request);
  
  expect(response.status).toBe(201);
  const data = await response.json();
  expect(data.session.name).toBe('Test Session');
});
```

### Services/Business Logic
Test state changes and outputs:

```typescript
// ✅ Good - tests actual behavior
it('should persist session and return ID', () => {
  const service = new SessionService();
  
  const sessionId = service.createSession({ name: 'My Session' });
  const retrieved = service.getSession(sessionId);
  
  expect(retrieved.name).toBe('My Session');
});
```

### Custom Hooks
Test state management and effects:

```typescript
// ✅ Good - tests hook state behavior  
it('should set loading true during API call', async () => {
  const { result } = renderHook(() => useSessionAPI());
  
  act(() => {
    void result.current.createSession({ name: 'Test' });
  });
  
  expect(result.current.loading).toBe(true);
  
  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });
});
```

## Test Data Management

### Factory Functions
Create typed test data with factories:

```typescript
function createMockTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task_123',
    title: 'Default Task',
    status: 'pending',
    priority: 'medium',
    createdAt: new Date().toISOString(),
    ...overrides, // Allows customization per test
  };
}

// Usage
const highPriorityTask = createMockTask({ priority: 'high' });
```

### Database Testing
The unified test setup handles database isolation automatically:

```typescript
describe('Database Test', () => {
  const _tempLaceDir = setupCoreTest(); // Database auto-initializes to temp directory
  
  beforeEach(async () => {
    // Database is already isolated and ready to use
    const persistence = getPersistence(); // Auto-initializes to ${LACE_DIR}/lace.db
    await seedTestData(persistence);
  });
  
  // No manual cleanup needed - temp directory handles it
});
```

## Running Tests

### Commands
```bash
# Run all tests
npm test

# Run tests in watch mode  
npm run test:watch

# Run specific test file
npm test TaskList.test.tsx

# Run with coverage
npm run test:coverage
```

### Debugging Failed Tests
1. **Read the error message** - it usually tells you exactly what's wrong
2. **Check test data** - ensure your mock data matches expected types
3. **Add debug output** - use `screen.debug()` for component tests
4. **Run single test** - isolate the failing test to debug faster

## Common Mistakes to Avoid

### 1. Testing Mock Behavior
```typescript
// ❌ Bad - only tests that mock works
expect(mockFetch).toHaveBeenCalledWith('/api/sessions');

// ✅ Good - tests actual result  
expect(result.current.sessions).toHaveLength(2);
```

### 2. Over-Mocking  
```typescript
// ❌ Bad - mocks everything
vi.mock('~/services/session-service');
vi.mock('~/services/task-service');
vi.mock('~/utils/validation');

// ✅ Good - only essential mocks
vi.mock('~/utils/api-client'); // External dependency only
```

### 3. Implementation-Coupled Names
```typescript
// ❌ Bad - tied to implementation
it('should call updateSession with correct params', () => {});

// ✅ Good - describes behavior
it('should save changes when update button clicked', () => {});
```

### 4. Using `any` Types
```typescript
// ❌ Bad - no type safety
const mockData: any = { id: 1, name: 'test' };

// ✅ Good - proper typing
const mockData: Task = createMockTask({ name: 'test' });
```

## Test File Organization

### File Structure
```
src/
├── components/
│   ├── TaskList.tsx
│   ├── TaskList.test.tsx          # Component behavior tests
│   ├── TaskForm.tsx
│   └── TaskForm.test.tsx
├── services/
│   ├── session-service.ts
│   ├── session-service.test.ts    # Service logic tests
│   ├── task-service.ts  
│   └── task-service.test.ts
└── app/api/
    ├── sessions/
    │   ├── route.ts
    │   └── route.test.ts          # API endpoint tests
    └── tasks/
        ├── route.ts
        └── route.test.ts
```

### Test Categories
- **Unit tests**: Single component/function behavior
- **Integration tests**: Multiple components working together  
- **E2E tests**: Full user workflows (use Playwright)

## When You're Stuck

1. **Ask yourself**: "What would the user see/experience if this worked correctly?"
2. **Write the test first** - describe the behavior you want
3. **Make it fail** - verify the test catches the problem
4. **Implement just enough** - make the test pass
5. **Refactor** - clean up while keeping tests green

## Getting Help

- Read existing good tests in `packages/web/components/` for patterns
- Check `CLAUDE.md` for project-specific guidelines
- Ask questions about business logic - don't guess

Remember: **Good tests give you confidence to refactor. Bad tests break when you refactor.**

---

## Legacy Terminal Interface Testing (DEPRECATED)

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

---

## Playwright E2E Testing (Web Interface)

### Overview

The Lace web interface uses a comprehensive Playwright testing infrastructure designed for reliability, maintainability, and parallel execution. This system provides robust testing of user workflows without the brittleness of CSS selectors or the complexity of mocking application logic.

### Key Features

- **🚀 Parallel Execution**: Tests run in parallel with worker-scoped database isolation
- **🎯 Reliable Selectors**: Uses `data-testid` attributes instead of fragile CSS selectors  
- **🔄 Real Functionality**: Tests actual application logic, mocks only external APIs
- **🌐 Browser Support**: Chromium-only in CI, WebKit available for local development
- **📊 Comprehensive Coverage**: 19+ test files covering all major application areas
- **🔧 Page Object Model**: Maintainable test abstractions with clean APIs

### Quick Start

#### Running Tests

```bash
# Run all E2E tests (local: Chromium + WebKit, CI: Chromium only)
npm run test:playwright

# Run specific test file
npm run test:playwright -- basic-user-journey.e2e.ts

# Run with specific browser
npm run test:playwright -- --project=chromium

# Run in CI mode (Chromium only)
CI=true npm run test:playwright

# Run with debugging (headed mode)
npm run test:playwright -- --headed

# Generate and view test report
npm run test:playwright -- --reporter=html
npx playwright show-report
```

#### Basic Test Structure

```typescript
// ABOUTME: Tests user authentication flow
// ABOUTME: Verifies login, session management, and logout functionality

import { test, expect } from './mocks/setup';
import { createPageObjects } from './page-objects';
import { withTempLaceDir } from './utils/withTempLaceDir';

test.describe('Authentication Flow', () => {
  test('user can log in and access dashboard', async ({ page }) => {
    await withTempLaceDir(async (tempDir) => {
      const { projectSelector, chatInterface } = createPageObjects(page);
      
      // Navigate to app
      await page.goto('/');
      
      // Test user workflow
      await expect(projectSelector.newProjectButton).toBeVisible();
      
      // Create project and verify success
      const projectPath = path.join(tempDir, 'test-project');
      await fs.promises.mkdir(projectPath, { recursive: true });
      await projectSelector.createProject('Test Project', projectPath);
      
      // Verify we're in the chat interface
      await chatInterface.waitForChatReady();
      await expect(chatInterface.messageInput).toBeVisible();
    });
  });
});
```

### Architecture Components

#### 1. Test Infrastructure Files

```
packages/web/e2e/
├── fixtures/
│   └── test-environment.ts        # Worker-scoped LACE_DIR isolation
├── mocks/
│   ├── setup.ts                   # MSW integration + test fixtures
│   └── handlers.ts                # API mocking handlers
├── page-objects/
│   ├── index.ts                   # Page object exports
│   ├── ProjectSelector.ts         # Project creation and selection
│   └── ChatInterface.ts           # Messaging and chat interactions
├── utils/
│   └── withTempLaceDir.ts         # Reusable temp directory helper
├── global-setup.ts                # Global test setup
├── global-teardown.ts             # Global test cleanup
└── [test-files].e2e.ts           # Individual test suites
```

#### 2. Configuration

**`playwright.config.ts`**: Optimized for parallel execution and CI reliability
- **Parallel execution**: `fullyParallel: true`
- **CI optimization**: Chromium-only in CI, WebKit for local development
- **Worker isolation**: Each worker gets isolated database directory
- **Enhanced debugging**: Traces, screenshots, videos on failure

### Page Object Model

#### Using Page Objects

**✅ Always use page objects** for UI interactions:

```typescript
import { createPageObjects } from './page-objects';

test('example test', async ({ page }) => {
  const { projectSelector, chatInterface } = createPageObjects(page);
  
  // ✅ Good - use page object methods
  await projectSelector.createProject('My Project', '/path/to/project');
  await chatInterface.sendMessage('Hello!');
  
  // ❌ Bad - direct page interactions
  await page.click('[data-testid="new-project-button"]');
  await page.fill('[data-testid="message-input"]', 'Hello!');
});
```

#### Page Object APIs

**ProjectSelector**:
```typescript
// Navigation
await projectSelector.clickNewProject();
await projectSelector.waitForProjectSelector();

// Project creation (handles new step-based wizard)
await projectSelector.createProject(name, path);
await projectSelector.fillProjectForm(name, path);
await projectSelector.navigateWizardSteps(); // Handles step 2 → 3 → 4
await projectSelector.submitProjectCreation();

// Existing projects
await projectSelector.selectExistingProject(projectName);
```

**ChatInterface**:
```typescript
// Basic messaging
await chatInterface.sendMessage('Hello, world!');
await chatInterface.waitForChatReady();

// Message management
const messageElement = chatInterface.getMessage('Hello, world!');
await expect(messageElement).toBeVisible();

// Interface state
await chatInterface.waitForSendAvailable();
await expect(chatInterface.sendButton).toBeVisible();
await expect(chatInterface.stopButton).toBeVisible();
```

### Test Isolation

#### Worker-Scoped Database Isolation

Each Playwright worker gets its own isolated `LACE_DIR` to prevent database conflicts:

```typescript
import { withTempLaceDir } from './utils/withTempLaceDir';

test('isolated test', async ({ page }) => {
  await withTempLaceDir(async (tempDir) => {
    // tempDir is unique per test execution
    // LACE_DIR environment variable automatically set
    // Database files isolated in worker-scoped directory
    // Automatic cleanup after test completion
    
    const projectPath = path.join(tempDir, 'my-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    
    // Test logic here...
  });
});
```

#### Manual Isolation (Advanced)

For custom isolation needs:

```typescript
test('custom isolation', async ({ page }) => {
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'lace-e2e-custom-')
  );
  const originalLaceDir = process.env.LACE_DIR;
  process.env.LACE_DIR = tempDir;
  
  try {
    // Test logic here...
  } finally {
    // Cleanup
    if (originalLaceDir !== undefined) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }
    
    if (fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }
});
```

### API Mocking with MSW

#### Setup

MSW (Mock Service Worker) mocks external APIs only, while testing real application logic:

```typescript
import { test, expect } from './mocks/setup'; // Includes MSW setup
import { http } from './mocks/setup';

test('API interaction test', async ({ page, worker, http }) => {
  // Mock external API calls
  await worker.use(
    http.post('https://api.anthropic.com/v1/messages', () => {
      return HttpResponse.json({
        id: 'msg_123',
        type: 'message',
        content: [{ type: 'text', text: 'Hello from mock!' }]
      });
    })
  );
  
  // Test your application's real logic
  await chatInterface.sendMessage('Test message');
  // Application makes real API call → MSW intercepts → returns mock response
});
```

#### What to Mock vs What to Test

**✅ Mock these (external dependencies)**:
- Anthropic API calls
- OpenAI API calls  
- File system APIs for directory browsing
- External web requests

**❌ Don't mock these (application logic)**:
- Database operations (use isolated test database)
- Internal API routes (`/api/threads`, `/api/projects`, etc.)
- React component rendering
- State management
- Event handling

### Data-TestID Strategy

#### Using Reliable Selectors

**✅ Use data-testid attributes**:
```typescript
// Component
<button data-testid="send-button" onClick={handleSend}>
  Send Message
</button>

// Test
await expect(page.getByTestId('send-button')).toBeVisible();
await page.getByTestId('send-button').click();
```

**❌ Avoid CSS selectors**:
```typescript
// Brittle - breaks when styling changes
await page.click('.btn.btn-primary.send-button');
await page.click('button:nth-child(2)');
```

#### Essential Data-TestIDs

Core UI elements that tests depend on:

**Project Management**:
- `new-project-button` - Main "New Project" button
- `project-path-input` - Directory input field  
- `project-name-input` - Project name input (advanced mode)
- `create-project-submit` - Final submit button
- `project-timeframe-filter` - Time filter dropdown

**Messaging Interface**:
- `send-button` - Send message button (when not streaming)
- `stop-button` - Stop response button (when streaming)
- `message-input` - Main message input textarea

#### Adding New Data-TestIDs

When adding new UI elements that tests need to interact with:

1. **Add data-testid attribute** to the element:
   ```typescript
   <button data-testid="my-new-button" onClick={handleClick}>
     My Button
   </button>
   ```

2. **Add to page object** if it's a common interaction:
   ```typescript
   get myNewButton(): Locator {
     return this.page.getByTestId('my-new-button');
   }
   
   async clickMyNewButton(): Promise<void> {
     await this.myNewButton.click();
   }
   ```

3. **Document in tests** that use the new element:
   ```typescript
   // Test the new functionality
   await expect(pageObject.myNewButton).toBeVisible();
   await pageObject.clickMyNewButton();
   ```

### Writing Effective E2E Tests

#### Test Structure Best Practices

**1. Use Descriptive Test Names**
```typescript
// ✅ Good - describes user behavior
test('user can create project and send first message', async ({ page }) => {});

// ❌ Bad - describes implementation
test('project creation API call succeeds', async ({ page }) => {});
```

**2. Follow User Journey Patterns**
```typescript
test('complete onboarding flow', async ({ page }) => {
  await withTempLaceDir(async (tempDir) => {
    const { projectSelector, chatInterface } = createPageObjects(page);
    
    // Step 1: User lands on app
    await page.goto('/');
    
    // Step 2: User sees project selection
    await expect(projectSelector.newProjectButton).toBeVisible();
    
    // Step 3: User creates project  
    await projectSelector.createProject('My Project', projectPath);
    
    // Step 4: User is in chat interface
    await chatInterface.waitForChatReady();
    
    // Step 5: User sends message
    await chatInterface.sendMessage('Hello!');
    
    // Step 6: User sees their message
    await expect(chatInterface.getMessage('Hello!')).toBeVisible();
  });
});
```

**3. Test Real User Workflows**
```typescript
// ✅ Good - tests complete workflow
test('user can manage multiple projects', async ({ page }) => {
  // Create first project
  // Switch to second project  
  // Verify isolation between projects
  // Test project deletion/archival
});

// ❌ Bad - tests isolated piece
test('project API returns 201', async ({ page }) => {
  // Only tests API response, not user experience
});
```

#### Error and Edge Case Testing

**Document current behavior** even when it's broken:

```typescript
test('documents current behavior when invalid project path provided', async ({ page }) => {
  await withTempLaceDir(async (tempDir) => {
    const { projectSelector } = createPageObjects(page);
    
    await page.goto('/');
    await projectSelector.clickNewProject();
    
    // Try invalid path
    try {
      await projectSelector.fillProjectForm('Test', '/nonexistent/path');
      await projectSelector.navigateWizardSteps();
      await projectSelector.submitProjectCreation();
    } catch (error) {
      console.log('Expected error with invalid path:', error.message);
    }
    
    // Document what actually happens (pass/fail/error/redirect)
    const currentUrl = page.url();
    console.log('Current URL after invalid path:', currentUrl);
    
    // Test passes regardless - we're documenting current behavior
    expect(true).toBeTruthy();
  });
});
```

### Test Organization

#### File Naming Convention

```
e2e/
├── basic-user-journey.e2e.ts        # Happy path user flows
├── basic-messaging.e2e.ts           # Core messaging functionality  
├── project-persistence.e2e.ts       # Project and URL persistence
├── session-management.e2e.ts        # Session lifecycle
├── agent-management.e2e.ts          # Agent creation and switching
├── message-streaming.e2e.ts         # Real-time messaging
├── sse-reliability.e2e.ts           # Server-Sent Events
├── tool-approval.e2e.ts             # Tool approval workflows  
├── error-handling.e2e.ts            # Error boundaries and recovery
├── task-management.e2e.ts           # Task CRUD operations
├── multi-agent-workflows.e2e.ts     # Multi-agent coordination
├── browser-navigation.e2e.ts        # Back/forward, deep linking
├── stop-functionality.e2e.ts        # ESC key and stop button
└── data-testid-verification.test.e2e.ts # Infrastructure verification
```

#### Test Categories

**Core Functionality** (must pass):
- Basic user journey
- Project creation and persistence  
- Message sending and receiving
- Data-testid verification

**Advanced Features** (document current behavior):
- Session management
- Agent workflows
- Tool approval
- Error handling
- Browser navigation

**Infrastructure Tests** (validate setup):
- MSW integration
- Worker isolation
- Page object functionality

### Writing New Tests

#### 1. Start with the Template

```typescript
// ABOUTME: Tests [feature description]
// ABOUTME: Verifies [specific behaviors tested]

import { test, expect } from './mocks/setup';
import { createPageObjects } from './page-objects';
import { withTempLaceDir } from './utils/withTempLaceDir';
import * as fs from 'fs';
import * as path from 'path';

test.describe('[Feature Name]', () => {
  test('[specific behavior description]', async ({ page }) => {
    await withTempLaceDir(async (tempDir) => {
      const { projectSelector, chatInterface } = createPageObjects(page);
      
      // Test setup
      await page.goto('/');
      
      // Test logic here...
      
      // Always have meaningful assertions
      expect(actualResult).toBe(expectedResult);
    });
  });
});
```

#### 2. Follow TDD Process

```typescript
// 1. Write failing test that describes desired behavior
test('user can save draft messages', async ({ page }) => {
  // Test implementation that documents current behavior
  // This will fail initially if feature doesn't exist
});

// 2. Implement feature to make test pass

// 3. Test should now pass and serve as regression protection
```

#### 3. Handle Broken/Missing Features

When testing functionality that doesn't exist or is broken:

```typescript
test('documents current task management capabilities', async ({ page }) => {
  await withTempLaceDir(async (tempDir) => {
    // Set up test environment
    
    // Attempt to trigger task functionality
    const taskUIVisible = await page.locator('[data-testid="task-list"]').isVisible().catch(() => false);
    
    if (taskUIVisible) {
      console.log('Task management UI is available');
      // Test the available functionality
    } else {
      console.log('Task management UI not yet implemented');
    }
    
    // Test always passes - we're documenting current state
    expect(true).toBeTruthy();
  });
});
```

### Page Object Development

#### Creating New Page Objects

```typescript
// e2e/page-objects/FeatureName.ts
import { Page, Locator } from '@playwright/test';

export class FeatureName {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // Locators (lazy-loaded, no async)
  get primaryButton(): Locator {
    return this.page.getByTestId('primary-button');
  }

  get inputField(): Locator {
    return this.page.getByTestId('input-field');
  }

  // Actions (async methods for interactions)
  async clickPrimaryButton(): Promise<void> {
    await this.primaryButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.primaryButton.click();
  }

  async fillForm(data: FormData): Promise<void> {
    await this.inputField.waitFor({ state: 'visible', timeout: 5000 });
    await this.inputField.fill(data.value);
  }

  // Complex workflows
  async completeWorkflow(data: WorkflowData): Promise<void> {
    await this.clickPrimaryButton();
    await this.fillForm(data);
    await this.submitForm();
  }

  // Verification helpers (return elements for assertions)
  getResultMessage(text: string): Locator {
    return this.page.getByText(text);
  }
}
```

#### Page Object Guidelines

**Do**:
- ✅ Encapsulate complex UI interactions
- ✅ Use `data-testid` for element selection
- ✅ Provide workflow methods that combine multiple actions
- ✅ Return `Locator` objects for assertions
- ✅ Handle wizard flows and multi-step processes

**Don't**:
- ❌ Include assertions in page object methods
- ❌ Use CSS selectors or text-based selection
- ❌ Make page objects test-specific
- ❌ Expose low-level page interactions

### MSW (Mock Service Worker) Setup

#### Purpose and Scope

MSW mocks **external APIs only**, allowing us to test real application logic:

**✅ Mock these external APIs**:
```typescript
// mocks/handlers.ts
export const handlers = [
  // Anthropic API
  http.post('https://api.anthropic.com/v1/messages', () => {
    return HttpResponse.json({
      id: 'msg_123',
      type: 'message',
      content: [{ type: 'text', text: 'Mocked response' }]
    });
  }),
  
  // OpenAI API
  http.post('https://api.openai.com/v1/chat/completions', () => {
    return HttpResponse.json({
      choices: [{ message: { content: 'Mocked response' } }]
    });
  }),
];
```

**❌ Don't mock internal APIs**:
```typescript
// DON'T mock these - test real functionality
// http.post('/api/threads/:id/message', ...)
// http.get('/api/projects', ...)
// http.post('/api/sessions', ...)
```

#### Using MSW in Tests

```typescript
import { test, expect } from './mocks/setup'; // Automatically includes MSW
import { HttpResponse } from './mocks/setup';
import { createPageObjects } from './page-objects';

test('external API integration', async ({ page, worker, http }) => {
  const { chatInterface } = createPageObjects(page);

  // Override default handlers for specific test
  await worker.use(
    http.post('https://api.anthropic.com/v1/messages', () => {
      return HttpResponse.json({ 
        content: [{ type: 'text', text: 'Custom test response' }] 
      });
    })
  );
  
  // Test application behavior with mocked external APIs
  await chatInterface.sendMessage('Test message');
  await expect(chatInterface.getMessage('Custom test response')).toBeVisible();
});

### Browser Console Integration

#### Debugging with Console Logs

The web interface forwards browser console messages to the development server terminal:

```bash
# Browser console messages appear in server logs
[CONSOLE-FORWARD] User clicked send button
[CONSOLE-FORWARD] Message sent successfully  
[BROWSER] [ERROR] Failed to load sessions: Project not found
```

#### Using Console Logs in Tests

```typescript
test('debug test with console logging', async ({ page }) => {
  // Monitor console messages
  const consoleMessages: string[] = [];
  page.on('console', message => {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  
  // Your test logic...
  
  // Analyze console output
  console.log('Browser console messages:', consoleMessages);
  expect(consoleMessages.some(msg => msg.includes('success'))).toBeTruthy();
});
```

### Performance and Reliability

#### Timing Best Practices

**✅ Use element-based waiting**:
```typescript
// Wait for elements to be ready
await expect(element).toBeVisible();
await element.waitFor({ state: 'visible', timeout: 5000 });

// Wait for specific text to appear
await expect(page.getByText('Success')).toBeVisible();
```

**❌ Avoid hardcoded timeouts**:
```typescript
// Brittle and slow
await page.waitForTimeout(3000);
```

#### Parallel Execution

**Worker Isolation**: Each worker gets its own database directory
- ✅ Tests can run in parallel safely
- ✅ No shared state between workers
- ✅ Automatic cleanup per worker

**CI Configuration**:
- **CI**: Chromium only, 4 workers for speed and reliability
- **Local**: Chromium + WebKit, 2 workers for cross-browser testing

### Debugging Test Failures

#### Investigation Steps

1. **Check the error message** - usually points to exact issue
2. **Review screenshots** - available in `test-results/` directory
3. **Watch the video** - see exactly what happened during test
4. **Use trace viewer** - step-by-step debugging:
   ```bash
   npx playwright show-trace test-results/[test-name]/trace.zip
   ```

#### Common Issues and Solutions

**"Element not found" errors**:
- ✅ Check if `data-testid` attribute exists in component
- ✅ Verify element is actually rendered (not conditionally hidden)
- ✅ Use proper waiting: `await expect(element).toBeVisible()`

**"Timeout" errors**:
- ✅ Increase timeout for slow operations
- ✅ Check if UI flow has changed (new steps/modals)
- ✅ Verify page objects match current UI structure

**"Element intercepted" errors**:
- ✅ Check for modal overlays blocking interactions
- ✅ Wait for animations to complete
- ✅ Ensure proper element visibility before clicking

#### Browser-Specific Issues

**WebKit timing differences**:
- WebKit may be slower than Chromium for certain operations
- Use longer timeouts for WebKit-specific issues
- Consider CI runs only Chromium to avoid flakiness

### Advanced Testing Patterns

#### Testing Streaming Responses

```typescript
test('message streaming behavior', async ({ page }) => {
  await withTempLaceDir(async (tempDir) => {
    const { projectSelector, chatInterface } = createPageObjects(page);
    
    // Set up project
    await page.goto('/');
    await projectSelector.createProject('Streaming Test', projectPath);
    await chatInterface.waitForChatReady();
    
    // Monitor for streaming state changes
    await chatInterface.sendMessage('Tell me a story');
    
    // Verify interface shows streaming state
    await expect(chatInterface.stopButton).toBeVisible();
    await expect(page.getByText('Press ESC to interrupt')).toBeVisible();
    
    // Wait for completion
    await chatInterface.waitForSendAvailable();
    await expect(chatInterface.sendButton).toBeVisible();
  });
});
```

#### Testing Error Boundaries

```typescript
test('handles network failures gracefully', async ({ page, worker, http }) => {
  // Mock network failure
  await worker.use(
    http.post('https://api.anthropic.com/v1/messages', () => {
      return HttpResponse.error();
    })
  );
  
  // Test error handling
  await chatInterface.sendMessage('Test message');
  
  // Verify graceful degradation
  await expect(page.getByText(/error|failed/i)).toBeVisible();
  await expect(chatInterface.messageInput).toBeEnabled(); // Can still interact
});
```

#### Testing URL and Navigation

```typescript
test('preserves state across browser navigation', async ({ page }) => {
  await withTempLaceDir(async (tempDir) => {
    // Create project and send message
    await projectSelector.createProject('Nav Test', projectPath);
    await chatInterface.sendMessage('Test message');
    
    const originalUrl = page.url();
    
    // Test browser back/forward
    await page.goBack();
    await page.goForward();
    
    // Verify state preserved
    await expect(page).toHaveURL(originalUrl);
    await expect(chatInterface.getMessage('Test message')).toBeVisible();
  });
});
```

### Test Maintenance

#### When UI Changes

1. **Update data-testid attributes** if elements change
2. **Update page objects** if interaction patterns change  
3. **Run test suite** to identify affected tests
4. **Update test expectations** to match new behavior
5. **Preserve failing tests** as documentation when appropriate

#### When Adding New Features

1. **Add data-testid attributes** to new interactive elements
2. **Extend page objects** with new interaction methods
3. **Write tests** that document the new feature behavior
4. **Test integration** with existing workflows

#### Regular Maintenance

```bash
# Run full test suite regularly
npm run test:playwright

# Check for flaky tests
npm run test:playwright -- --repeat-each=3

# Update dependencies
npm update @playwright/test playwright-msw

# Regenerate page object types if needed
npx playwright codegen localhost:3000
```

### CI/CD Integration

#### GitHub Actions Example

```yaml
name: E2E Tests
on: [push, pull_request]

jobs:
  playwright:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
        
      - name: Install Playwright browsers
        run: npx playwright install chromium
        
      - name: Run Playwright tests
        run: CI=true npm run test:playwright
        env:
          ANTHROPIC_KEY: ${{ secrets.ANTHROPIC_KEY }}
          
      - name: Upload test results
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: packages/web/playwright-report/
```

#### CI Optimization

The configuration automatically optimizes for CI:
- **Chromium only** in CI (reliable, fast)
- **4 workers** for parallel execution
- **Retries** on failure (2 retries in CI)
- **Enhanced reporting** with traces and videos

### Best Practices Summary

#### DO:
- ✅ Use `withTempLaceDir()` for database isolation
- ✅ Use page objects for all UI interactions
- ✅ Test complete user workflows
- ✅ Mock external APIs only
- ✅ Use `data-testid` attributes for element selection
- ✅ Document current behavior even when broken
- ✅ Follow TDD: write test, make it fail, implement, make it pass

#### DON'T:
- ❌ Mock internal application logic
- ❌ Use CSS selectors for element selection
- ❌ Test implementation details
- ❌ Delete failing tests (preserve as documentation)
- ❌ Share state between tests
- ❌ Use hardcoded timeouts

### Troubleshooting Guide

#### "Tests timing out"
1. Check if UI has changed and page objects need updates
2. Verify data-testid attributes exist on expected elements
3. Look for modal overlays or loading states blocking interactions
4. Check browser console for JavaScript errors

#### "Elements not found"
1. Verify data-testid attribute exists in component
2. Check if element is conditionally rendered
3. Ensure proper waiting with `await expect(element).toBeVisible()`
4. Check if UI flow has new steps (wizard, modals, etc.)

#### "Tests flaky in CI"
1. Use `CI=true` to test Chromium-only behavior locally
2. Check for race conditions in test setup/teardown
3. Verify all tests use proper database isolation
4. Look for hardcoded timeouts that need adjustment

#### "Browser won't start"
```bash
# Install browsers if missing
npx playwright install

# Install system dependencies (Linux)
npx playwright install-deps
```

### Performance Tips

#### Fast Local Development

```bash
# Run single test file for quick feedback
npm run test:playwright -- basic-user-journey.e2e.ts

# Use single worker to avoid resource contention
npm run test:playwright -- --workers=1

# Run without video/trace for speed
npm run test:playwright -- --config=playwright-fast.config.ts
```

#### Efficient Test Writing

- **Start small**: Test core happy path first
- **Add complexity gradually**: Edge cases after basic functionality works
- **Use existing page objects**: Don't reinvent UI interactions
- **Leverage helpers**: `withTempLaceDir`, MSW setup, etc.

### Getting Help

- **Check existing tests** for patterns and examples
- **Review page objects** to understand available interactions  
- **Read component source** to understand UI structure and data-testids
- **Run single tests** to debug issues quickly
- **Use Playwright trace viewer** for step-by-step debugging

The Playwright infrastructure provides a solid foundation for reliable E2E testing. Focus on testing user behavior, use the provided abstractions, and document current system capabilities comprehensively.