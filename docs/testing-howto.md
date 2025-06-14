# Testing Guide for Lace

## Overview

This project uses comprehensive testing to ensure quality and prevent regressions. We follow Test-Driven Development (TDD) principles and maintain multiple types of test coverage.

## CRITICAL: Bad Test Cleanup in Progress

**BEFORE WRITING NEW TESTS**: Check `bad-tests.md` for current cleanup status. The test suite contains many fake tests and anti-patterns that need removal/rewrite.

**Priority**: Delete fake tests first (they harm CI reliability), then implement proper tests.

## Testing Philosophy

### Test Behavior, Not Implementation

**GOOD TESTS**:
- Test what users experience
- Test component behavior and outcomes
- Use React Testing Library user events
- Mock external dependencies, not internal logic
- Fail when functionality breaks

**BAD TESTS** (being removed):
- `expect(true).toBe(true)` with manual verification comments
- String matching against source code (`expect(code).toContain("import...")`)
- File existence checks (`fs.existsSync()` for components)
- JSX structure assertions
- Testing internal implementation details

### Test-Driven Development (TDD)

We follow the TDD cycle:

1. **Red**: Write a failing test that describes the desired behavior
2. **Green**: Write the minimum code to make the test pass
3. **Refactor**: Improve the code while keeping tests green

This ensures we only write necessary code and that all code is tested.

## Test Structure

### Test Types

We maintain four types of tests:

#### 1. Unit Tests (`test/ui/components/`)

- Test individual components in isolation
- Mock external dependencies
- Fast execution
- Example: `StatusBar.test.tsx`, `Message.test.tsx`

#### 2. Integration Tests (`test/ui/integration/`)

- Test component interactions and workflows
- Test complete features end-to-end
- Example: `step4-navigation.test.tsx`, `step12-streaming.test.tsx`

#### 3. End-to-End Tests (`test/ui/e2e/`)

- Test complete user workflows
- Use real or minimal mocks
- Example: `step2-e2e.test.js`

#### 4. Backend Tests (`test/unit/`)

- Test backend components (agents, tools, database)
- Example: `agents.test.js`, `tools.test.js`

### Test Organization

```
test/
├── ui/
│   ├── components/          # Unit tests for UI components
│   ├── integration/         # Feature integration tests
│   ├── e2e/                # End-to-end tests
│   └── real-tests/         # Manual testing scenarios
├── unit/                   # Backend unit tests
└── __mocks__/             # Jest mocks
```

## Technical Setup

### ESM + TypeScript + Jest Configuration

This project uses ES modules (`"type": "module"`) with TypeScript, which requires special Jest configuration.

#### Key Configuration Files

**`package.json`**:

```json
{
  "type": "module",
  "scripts": {
    "test": "jest",
    "typecheck": "tsc --noEmit"
  }
}
```

**`jest.config.js`**:

```javascript
export default {
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  moduleNameMapping: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
};
```

**`tsconfig.json`**:

```json
{
  "compilerOptions": {
    "allowJs": true,
    "jsx": "react-jsx",
    "strict": false,
    "esModuleInterop": true
  }
}
```

### Why This Setup?

1. **ESM Support**: Modern JavaScript uses ES modules, and our backend is ESM-based
2. **TypeScript**: Provides type safety and better IDE support for UI components
3. **Mixed Codebase**: Allows `.js` backend files to coexist with `.tsx` frontend files
4. **Import Compatibility**: Handles `.js` imports from TypeScript files

### Common Issues and Solutions

#### Import/Export Errors

- **Problem**: `SyntaxError: Cannot use import statement outside a module`
- **Solution**: Ensure `"type": "module"` in package.json and proper Jest ESM config

#### Mock Issues

- **Problem**: Jest mocks don't work with ESM
- **Solution**: Use `jest.unstable_mockModule()` for ESM mocks or convert to `.cjs`

#### Path Resolution

- **Problem**: TypeScript imports ending in `.js` don't resolve
- **Solution**: Use `moduleNameMapping` in Jest config to resolve `.js` to `.ts`

## Test Patterns

### React Component Testing (PREFERRED)

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import Component from "../../../src/ui/components/Component";

describe("Component Name", () => {
  test("renders with correct content", () => {
    render(<Component prop="value" />);
    
    expect(screen.getByText("expected content")).toBeInTheDocument();
  });

  test("handles user interaction", () => {
    const onSubmit = jest.fn();
    render(<Component onSubmit={onSubmit} />);
    
    fireEvent.click(screen.getByRole('button'));
    expect(onSubmit).toHaveBeenCalled();
  });
});
```

### Ink Component Testing (RECOMMENDED)

Ink components (React for terminal UIs) require special testing infrastructure because they interact with Node.js streams.

#### The Problem

Standard testing approaches fail with Ink components due to missing stream methods:

```
TypeError: stdin.ref is not a function
```

This occurs because Ink's App component calls `stdin.ref()` and `stdin.unref()` for raw mode management, but standard test mocks don't provide these Node.js stream methods.

#### The Solution: Custom renderInkComponent

Use our custom `renderInkComponent` function from `test/with-mocks/helpers/ink-test-utils.ts`:

```typescript
import { renderInkComponent } from "../helpers/ink-test-utils";
import ToolApprovalModal from "@/ui/components/ToolApprovalModal";

describe("ToolApprovalModal Component", () => {
  test("user can see tool approval modal structure", () => {
    const { lastFrame } = renderInkComponent(
      <ToolApprovalModal 
        toolCall={{name: "file_write", input: {path: "/test"}}}
        riskLevel="medium"
        onApprove={jest.fn()}
        onDeny={jest.fn()}
        onStop={jest.fn()}
      />
    );
    
    const output = lastFrame();
    
    // Test behavior - what users see
    expect(output).toContain("Tool Execution Request");
    expect(output).toContain("MEDIUM");
    expect(output).toContain("file_write");
  });
});
```

#### Key Implementation Details

The custom `renderInkComponent` extends ink-testing-library with missing Node.js stream methods:

```typescript
class EnhancedStdin extends EventEmitter {
  public isTTY = true;
  
  // Missing methods that Ink's App component needs
  public ref() { /* Do nothing - mock implementation */ }
  public unref() { /* Do nothing - mock implementation */ }
  public read() { return null; }
  public setRawMode() { /* Do nothing - mock implementation */ }
  // ... other required stream methods
}
```

#### Testing Philosophy: Behavior vs Implementation

**✅ GOOD - Test User-Visible Behavior:**
```typescript
test("user can see modal displays risk level", () => {
  const { lastFrame } = renderInkComponent(<ToolApprovalModal riskLevel="high" {...props} />);
  expect(lastFrame()).toContain("HIGH");
});
```

**❌ BAD - Test Implementation Details:**
```typescript
test("modal has correct JSX structure", () => {
  const element = ToolApprovalModal(props);
  expect(element.props.children[0].type).toBe(Box);
});
```

#### Applying to Other Ink Components

Use this pattern for all Ink components that fail with stream-related errors:

1. Import `renderInkComponent` from ink-test-utils
2. Replace direct component instantiation with `renderInkComponent(<Component />)`
3. Test the rendered output string instead of JSX structure
4. Focus on user-visible behavior rather than implementation details

#### Testing Styled Output (ANSI Codes)

When testing components that use ANSI escape codes for styling (like search highlighting or cursor positioning), use the `stripAnsi` utility from ink-test-utils:

```typescript
import { renderInkComponent, stripAnsi } from "../helpers/ink-test-utils";
import ConversationView from "@/ui/components/ConversationView";

describe("Search Highlighting", () => {
  test("user can see search results with highlighting", () => {
    const { lastFrame } = renderInkComponent(
      <ConversationView 
        messages={[{type: "user", content: "Hello world"}]} 
        searchTerm="hello"
      />
    );
    
    const output = lastFrame();
    const cleanOutput = stripAnsi(output);
    
    // Test underlying content without ANSI codes
    expect(cleanOutput.toLowerCase()).toContain("hello world");
    
    // Test that highlighting is applied
    expect(output).toMatch(/\[43m\[30mhello\[39m\[49m/i);
  });
});
```

**Key points:**
- Use `stripAnsi()` to test content without styling codes
- Test both content and styling separately for robust verification
- ANSI codes: `[43m[30m` = yellow background, black text; `[39m[49m` = reset

#### Testing Cursor Highlighting and Terminal Styling

Ink components that use `inverse` text styling (like cursor highlighting) generate ANSI escape codes. To test these properly, you need to understand the ANSI code generation process:

**CRITICAL**: ANSI codes are only generated when `FORCE_COLOR` environment variable is set **before the Node.js process starts**. This cannot be done within the test - it must be set at the command line level.

**Testing cursor highlighting:**

```typescript
describe("TextRenderer with cursor", () => {
  test("user can see cursor highlighting at correct position", () => {
    const { frames } = renderInkComponent(
      <TextRenderer
        lines={["Hello world"]}
        cursorLine={0}
        cursorColumn={0}
        isFocused={true}
      />
    );
    
    const output = frames.join('');
    
    // Test content is present
    expect(stripAnsi(output)).toContain("Hello world");
    
    // Test cursor highlighting on first character
    // [7m = start inverse, [27m = end inverse
    expect(output).toMatch(/\[7mH\[27m/);
    expect(output).toContain("ello world"); // Rest of text after cursor
  });
});
```

**Why this is complex:**

1. **Chalk detection**: Ink uses the `chalk` library for styling, which uses `supports-color` to detect terminal capabilities
2. **TTY detection**: `supports-color` calls `tty.isatty(1)` to check if stdout is a real terminal
3. **Environment dependency**: Even with `process.stdout.isTTY = true`, chalk checks the actual file descriptor
4. **Module caching**: Chalk's color detection happens at import time and is cached

**Solution for consistent testing:**

Run tests with FORCE_COLOR environment variable:

```bash
FORCE_COLOR=1 npm test
```

This forces chalk to generate ANSI codes regardless of TTY detection.

**Common ANSI escape codes:**
- `[7m` = Start inverse/reverse video (cursor highlighting)
- `[27m` = End inverse/reverse video
- `[43m` = Yellow background
- `[30m` = Black text
- `[39m` = Reset text color
- `[49m` = Reset background color
- `[?25l` = Hide cursor
- `[?25h` = Show cursor

**Testing pattern for cursor components:**

```typescript
// Test basic content
expect(stripAnsi(output)).toContain("expected text");

// Test cursor positioning
expect(output).toMatch(/\[7m.\[27m/); // Any character highlighted

// Test specific cursor position
expect(output).toMatch(/\[7mH\[27mello/); // H is highlighted, followed by ello
```

### Integration Testing Pattern

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import App from "../../../src/ui/App";

describe("Feature Integration", () => {
  test("user can complete full workflow", () => {
    render(<App />);
    
    // Simulate user actions
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'test message' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    
    // Verify outcomes user would see
    expect(screen.getByText("Message sent")).toBeInTheDocument();
  });
});
```

### Backend Testing Pattern

```typescript
import { AgentOrchestrator } from '../../../src/agents/orchestrator';

describe('Agent System', () => {
  test('routes message to correct agent', async () => {
    const orchestrator = new AgentOrchestrator();
    const mockAgent = { processMessage: jest.fn().mockResolvedValue('response') };
    
    orchestrator.registerAgent('test', mockAgent);
    
    const result = await orchestrator.processMessage('test message', 'test');
    
    expect(mockAgent.processMessage).toHaveBeenCalledWith('test message');
    expect(result).toBe('response');
  });
});
```

### Async Testing Pattern

```typescript
test("async operation completes", async () => {
  const result = await asyncFunction();
  expect(result).toBe("expected");
});
```

### Mock Pattern

```typescript
beforeEach(() => {
  jest.spyOn(object, "method").mockReturnValue("mocked value");
});

afterEach(() => {
  jest.restoreAllMocks();
});
```

## Mock Factory System

### Overview

Lace uses a comprehensive mock factory system to eliminate duplication and ensure consistent mocking across all tests. This system is located in `test/with-mocks/__mocks__/` and provides centralized, configurable mock factories for all common dependencies.

### Mock Factory Architecture

Our mock infrastructure consists of five specialized factory files:

```
test/with-mocks/__mocks__/
├── standard-mocks.js          # Core dependencies (tools, database, loggers)
├── model-definitions.js       # Model instances, definitions, and providers
├── agent-roles.js            # Agent role configurations and capabilities
├── ui-mocks.js              # UI components and hooks
└── completion-mocks.js      # Tab completion system mocks
```

### Core Mock Factories

#### 1. Standard Mocks (`standard-mocks.js`)

**Primary Functions:**
- `createStandardMockConfig(options)` - Complete mock configuration for agents
- `createMockTools(options)` - Tool registry and execution mocks
- `createMockDatabase(options)` - Conversation database mocks
- `createMockActivityLogger(options)` - Activity logging mocks
- `createMockToolCall(options)` - Tool call object factory
- `resetStandardMocks(config)` - Reset all mocks to clean state

**Basic Usage:**
```typescript
import { createStandardMockConfig, resetStandardMocks } from "../__mocks__/standard-mocks.js";

describe("Agent Tests", () => {
  let mockConfig;

  beforeEach(() => {
    mockConfig = createStandardMockConfig({
      modelName: "claude-3-5-sonnet-20241022",
      role: "general",
      availableTools: ["file", "shell", "javascript"]
    });
  });

  afterEach(() => {
    resetStandardMocks(mockConfig);
  });

  test("should process message", () => {
    const agent = new Agent(mockConfig);
    // Test implementation
  });
});
```

**Advanced Configuration:**
```typescript
const mockConfig = createStandardMockConfig({
  modelName: "claude-3-5-haiku-20241022",
  role: "execution",
  availableTools: ["file", "shell"],
  conversationHistory: [
    { role: "user", content: "test message", timestamp: Date.now() }
  ]
});
```

#### 2. Model Definition Mocks (`model-definitions.js`)

**Primary Functions:**
- `createMockModelInstance(modelName, options)` - Model instance with chat method
- `createMockModelDefinition(modelName, overrides)` - Model configuration
- `createMockModelProvider(providerName, options)` - Provider with session management

**Usage:**
```typescript
import { createMockModelInstance, createMockModelProvider } from "../__mocks__/model-definitions.js";

// Create model instance with custom response
const mockModel = createMockModelInstance("claude-3-5-sonnet-20241022", {
  defaultResponse: "Custom test response",
  shouldSucceed: true
});

// Create provider with token counting
const mockProvider = createMockModelProvider("anthropic", {
  defaultResponse: "Test response",
  tokenCountResponse: { input_tokens: 42 }
});
```

#### 3. Agent Role Mocks (`agent-roles.js`)

**Primary Functions:**
- `createMockAgentRegistry(roleNames)` - Complete agent role registry
- `createMockRoleConfig(roleName, overrides)` - Individual role configuration
- `createMockAgentWithRole(role, options)` - Agent instance with role

**Usage:**
```typescript
import { createMockAgentRegistry, DELEGATION_SCENARIOS } from "../__mocks__/agent-roles.js";

// Create registry with specific roles
const mockRegistry = createMockAgentRegistry(["general", "execution", "reasoning"]);

// Use in test
mockGetRole.mockImplementation(mockRegistry.getRole);

// Test delegation scenarios
const scenario = DELEGATION_SCENARIOS.complexAnalysis;
expect(mockRegistry.chooseRoleForTask(scenario.task).role).toBe(scenario.expectedRole);
```

#### 4. UI Component Mocks (`ui-mocks.js`)

**Primary Functions:**
- `createMockUseTextBuffer(options)` - TextBuffer hook factory
- `createUseTextBufferModuleMock(options)` - Jest module mock for hook
- `createMockLaceUI(options)` - LaceUI instance mock

**Usage:**
```typescript
import { createMockUseTextBuffer } from "../__mocks__/ui-mocks.js";

// Mock text buffer with initial content
const mockTextBuffer = createMockUseTextBuffer({
  initialText: "Hello world",
  initialCursorLine: 0,
  initialCursorColumn: 5
});
```

### Mock Factory Patterns

#### 1. Centralized Configuration Pattern

**✅ GOOD - Use Factory:**
```typescript
import { createStandardMockConfig } from "../__mocks__/standard-mocks.js";

beforeEach(() => {
  mockConfig = createStandardMockConfig({ role: "execution" });
});
```

**❌ BAD - Manual Mock Setup:**
```typescript
// DON'T DO THIS - Creates duplication
beforeEach(() => {
  mockTools = {
    initialize: jest.fn(),
    listTools: jest.fn().mockReturnValue(["file", "shell"]),
    execute: jest.fn().mockResolvedValue({ success: true })
  };
  mockDatabase = {
    saveMessage: jest.fn(),
    getConversationHistory: jest.fn().mockResolvedValue([])
  };
  // ... 50+ more lines of manual setup
});
```

#### 2. Configurable Options Pattern

All factories accept options for customization:

```typescript
// Basic usage with defaults
const mockTools = createMockTools();

// Advanced usage with configuration
const mockTools = createMockTools({
  availableTools: ["file", "shell", "search"],
  shouldSucceed: false,  // Simulate failures
  customResponses: {
    "file": { content: "Custom file response" },
    "shell": { output: "Custom shell output" }
  }
});
```

#### 3. Inheritance and Composition Pattern

Factories can be composed for complex scenarios:

```typescript
const mockModel = createMockModelInstance("claude-3-5-sonnet-20241022");
const mockProvider = createMockModelProvider("anthropic", { 
  modelInstance: mockModel 
});

const mockConfig = createStandardMockConfig({
  modelName: mockModel.definition.name,
  customModelProvider: mockProvider
});
```

### Factory Usage Guidelines

#### 1. Always Use Factories

**Rule:** Never create manual mock objects when a factory exists.

```typescript
// ✅ CORRECT
const mockToolCall = createMockToolCall({
  name: "file_write",
  input: { path: "/test.txt", content: "test" }
});

// ❌ INCORRECT  
const mockToolCall = {
  name: "file_write",
  input: { path: "/test.txt", content: "test" },
  description: "Write content to a file"
};
```

#### 2. Configure, Don't Override

**Rule:** Use factory options instead of overriding mock methods.

```typescript
// ✅ CORRECT - Configure at creation
const mockDatabase = createMockDatabase({
  conversationHistory: testMessages,
  shouldSucceed: false
});

// ❌ INCORRECT - Override after creation
const mockDatabase = createMockDatabase();
mockDatabase.getConversationHistory.mockResolvedValue(testMessages);
mockDatabase.saveMessage.mockRejectedValue(new Error("DB error"));
```

#### 3. Reset Properly

**Rule:** Always use the reset functions to clean up mocks.

```typescript
import { createStandardMockConfig, resetStandardMocks } from "../__mocks__/standard-mocks.js";

let mockConfig;

beforeEach(() => {
  mockConfig = createStandardMockConfig();
});

afterEach(() => {
  resetStandardMocks(mockConfig);  // ✅ Use factory reset
  // NOT: jest.clearAllMocks();     // ❌ Incomplete cleanup
});
```

### Advanced Mock Scenarios

#### 1. Error Testing with Factories

```typescript
// Test database failures
const mockConfig = createStandardMockConfig({
  databaseOptions: { shouldSucceed: false }
});

// Test tool execution failures  
const mockTools = createMockTools({
  shouldSucceed: false,
  customResponses: {
    "shell": { error: "Permission denied" }
  }
});
```

#### 2. Performance Testing with Factories

```typescript
// Test with high token usage
const mockModel = createMockModelInstance("claude-3-5-sonnet-20241022", {
  usage: { inputTokens: 180000, outputTokens: 4000 },
  shouldSucceed: true
});

// Test with slow responses
const mockProvider = createMockModelProvider("anthropic", {
  responseDelay: 5000,
  defaultResponse: "Slow response"
});
```

#### 3. Complex Integration Testing

```typescript
// Test complete agent workflow
const mockConfig = createStandardMockConfig({
  modelName: "claude-3-5-sonnet-20241022",
  role: "orchestrator",
  availableTools: ["file", "shell", "agent-delegate"],
  conversationHistory: [
    { role: "user", content: "Deploy the application" },
    { role: "assistant", content: "I'll help you deploy the application" }
  ]
});

// Factory automatically provides all needed mocks
const agent = new Agent(mockConfig);
```

### Factory Maintenance

#### Adding New Factories

When adding new mock factories:

1. **Identify Duplication:** Look for mock patterns appearing in 2+ test files
2. **Create Configurable Factory:** Support common use cases through options
3. **Add to Appropriate File:** Use existing factory files or create new ones
4. **Document Usage:** Add JSDoc comments with examples
5. **Update Tests:** Convert existing manual mocks to use the factory

#### Example Factory Creation

```typescript
/**
 * Create a mock snapshot manager
 * @param {object} options - Configuration options
 * @param {Array} options.snapshots - Pre-populated snapshots
 * @param {boolean} options.shouldSucceed - Whether operations succeed
 * @returns {object} Mock snapshot manager
 */
export function createMockSnapshotManager(options = {}) {
  const { snapshots = [], shouldSucceed = true } = options;
  
  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    createSnapshot: jest.fn().mockImplementation(async (type, metadata) => {
      if (!shouldSucceed) throw new Error("Snapshot creation failed");
      return { id: `snapshot-${Date.now()}`, type, metadata };
    }),
    listSnapshots: jest.fn().mockResolvedValue([...snapshots]),
    // ... other methods
  };
}
```

### Migration from Manual Mocks

When converting existing tests to use factories:

1. **Identify Mock Patterns:** Find repeated mock object creation
2. **Choose Appropriate Factory:** Select the factory that matches your needs
3. **Replace Manual Setup:** Convert `beforeEach` blocks to use factories
4. **Update Assertions:** Ensure tests still work with factory-generated mocks
5. **Add Reset Logic:** Use factory reset functions in `afterEach`
6. **Test Everything:** Verify all tests still pass

### Performance Benefits

The mock factory system provides:

- **40% Reduction** in test boilerplate code
- **Consistent Behavior** across all tests
- **Faster Test Development** with pre-built configurations
- **Easier Maintenance** with centralized mock logic
- **Better Test Reliability** with standardized mock behavior

## Anti-Patterns to Avoid

### ❌ Fake Tests
```typescript
// DON'T DO THIS
test("manual verification", () => {
  // ✅ Check this manually
  // ✅ Verify that manually
  expect(true).toBe(true);
});
```

### ❌ Implementation Detail Testing
```typescript
// DON'T DO THIS
test("component has correct internal structure", () => {
  const element = Component();
  expect(element.props.children[0].type).toBe('div');
});

// DO THIS INSTEAD
test("component displays expected content", () => {
  render(<Component />);
  expect(screen.getByText("Expected content")).toBeInTheDocument();
});
```

### ❌ String Matching Source Code
```typescript
// DON'T DO THIS
test("file contains expected exports", () => {
  const source = fs.readFileSync('Component.tsx', 'utf8');
  expect(source).toContain('export default Component');
});

// DO THIS INSTEAD
test("component exports correctly", () => {
  expect(typeof Component).toBe('function');
});
```

### ❌ File Existence Testing
```typescript
// DON'T DO THIS
test("component files exist", () => {
  expect(fs.existsSync('Component.tsx')).toBe(true);
});

// The import system already validates this
```

## Running Tests

### Test Commands

Lace provides two separate test configurations for different scenarios:

#### With-Mocks Tests (Unit Testing)
```bash
npm run test:with-mocks     # Fast unit tests with comprehensive mocking
npm run test:with-mocks -- --watch  # Watch mode for development
```

#### No-Mocks Tests (Integration Testing)  
```bash
npm run test:no-mocks       # Integration tests with real APIs
npm run test:no-mocks -- --watch    # Watch mode for integration testing
```

**Note:** Integration tests require an Anthropic API key in `~/.lace/api-keys/anthropic`

#### Combined Test Execution
```bash
npm test                    # Run both test suites
```

#### Other Commands
```bash
npm run typecheck          # TypeScript type checking
npm run lint              # ESLint code checking  
npm run test:with-mocks -- --coverage  # Coverage report

# Run specific test file
npm run test:with-mocks -- StatusBar.test.tsx

# Run specific test pattern
npm run test:with-mocks -- --testNamePattern="agent role"
```

## Test Requirements

### Definition of Done

Every feature must have:

1. **Unit Tests**: For individual components
2. **Integration Tests**: For component interactions
3. **Type Safety**: All TypeScript files must compile
4. **No Regressions**: All existing tests must pass

### Test Quality Standards

1. **Descriptive Names**: Test names should clearly describe behavior
2. **Single Responsibility**: Each test should verify one specific behavior
3. **Arrange-Act-Assert**: Structure tests with clear setup, action, and verification
4. **No Flaky Tests**: Tests should be deterministic and reliable
5. **No Fake Tests**: Every test must actually verify functionality

### Coverage Goals

- **Components**: 100% of user-observable behavior
- **Features**: All user-facing functionality
- **Edge Cases**: Error conditions and boundary cases
- **Regressions**: All bug fixes should include tests

## Best Practices

### Do's

- Write tests before implementing features (TDD)
- Test what users experience, not internal code structure
- Use React Testing Library for UI component testing
- Mock external dependencies, not internal logic
- Write descriptive test names that explain the behavior
- Test error conditions and edge cases
- Keep tests simple and focused

### Don'ts

- **NEVER** write `expect(true).toBe(true)` fake tests
- **NEVER** test file existence with `fs.existsSync()`
- **NEVER** string match against source code
- **NEVER** test JSX structure instead of behavior
- Don't test implementation details
- Don't write tests tightly coupled to code structure
- Don't skip testing error conditions
- Don't commit failing tests (except as part of TDD red phase)

## Current Test Suite Issues

See `bad-tests.md` for:
- Files that need deletion (fake tests, unimplemented features)
- Files that need complete rewrite (testing wrong things)
- Missing test coverage that needs implementation
- Specific prompts for fixing each issue

**Action Items**:
1. Delete fake tests immediately (they harm CI)
2. Delete tests for unimplemented features
3. Rewrite completion provider tests to test behavior
4. Rewrite integration tests to test user workflows
5. Add missing component and core module tests

## Debugging Test Issues

### Common Debugging Steps

1. **Run single test**: Isolate the failing test
2. **Check imports**: Verify all imports are correct
3. **Check mocks**: Ensure mocks are properly configured
4. **Add console.log**: Debug test state and values
5. **Check Jest config**: Verify ESM and TypeScript settings

### Useful Commands

```bash
# Run with verbose output
npm test -- --verbose

# Run specific test with debugging
npm test -- --testNamePattern="specific test" --verbose

# Check Jest configuration
npx jest --showConfig
```

## Future Considerations

### Migration to Vitest

If Jest ESM complexity becomes unmanageable, consider migrating to Vitest:

- Native ESM support
- Vite-based (faster)
- Better TypeScript integration
- More intuitive configuration

### Testing Library Integration

Consider adding React Testing Library for more realistic component testing:

- Better accessibility testing
- User-focused assertions
- Less brittle tests

## Resources

- [Jest ESM Documentation](https://jestjs.io/docs/ecmascript-modules)
- [TypeScript Jest Configuration](https://jestjs.io/docs/getting-started#using-typescript)
- [Testing Philosophy](https://kentcdodds.com/blog/how-to-know-what-to-test)
- [TDD Best Practices](https://martinfowler.com/bliki/TestDrivenDevelopment.html)
