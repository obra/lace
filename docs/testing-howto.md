# Testing Guide for Lace-Ink

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

### Legacy Ink Component Testing (EXISTING)

```typescript
import Component from "../../../src/ui/components/Component";

describe("Component Name", () => {
  test("renders with correct props", () => {
    const element = Component({ prop: "value" }) as any;

    expect(element.type).toBeTruthy();
    expect(element.props.children).toContain("expected content");
  });
});
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

### All Tests

```bash
npm test
```

### Specific Test File

```bash
npm test -- StatusBar.test.tsx
```

### Watch Mode

```bash
npm test -- --watch
```

### Type Checking

```bash
npm run typecheck
```

### Coverage Report

```bash
npm test -- --coverage
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
