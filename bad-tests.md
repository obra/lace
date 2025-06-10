# Test Suite Cleanup & Implementation Prompts

This document provides specific prompts for LLM coding agents to clean up bad tests and implement proper test coverage. Each section contains ready-to-use prompts that specify exactly what to do.

**IMPORTANT**: Read `docs/testing-howto.md` first for complete testing guidelines, anti-patterns to avoid, and proper test patterns to follow.

## ✅ COMPLETED: PROMPT 1: Delete Fake Tests and Implement Real App Tests

**Task**: Delete the fake tests in `test/with-mocks/unit/App.test.tsx` and replace with proper React component tests.

**COMPLETED ACTIONS**:
1. ✅ Deleted the existing fake test file with `expect(true).toBe(true)` tests
2. ✅ **Fixed React warnings**: Discovered and fixed duplicate key warnings in StatusBar component by adding explicit keys to React elements
3. ✅ Created proper unit tests for App component structure and instantiation
4. ✅ All 4 tests pass with clean output (no console pollution)

**Implemented Tests**:
```typescript
describe('App Component', () => {
  test('App component is a valid React component');
  test('App component accepts props correctly'); 
  test('App component accepts no props');
  test('App component has correct display name');
});
```

**Key Learning**: The App component is too complex for full behavioral unit testing due to:
- stdin/stdout dependencies that don't exist in test environment
- Complex useEffect hooks and side effects
- External service dependencies

**Resolution**: 
- ✅ Unit tests focus on component structure and basic instantiation
- 🔄 Complex behavioral tests (keyboard shortcuts, navigation, tool approval) moved to integration test scope
- ✅ Fixed underlying React duplicate key bug in StatusBar component

**Reference**: See `docs/testing-howto.md` for React Testing Library patterns and anti-patterns to avoid.

## ✅ RESOLVED: PROMPT 2: Delete Failing Unimplemented Tests

**Task**: Remove tests for unimplemented features that always fail and make the test suite unreliable.

**RESOLUTION**: The original problem no longer exists. Investigation shows:

1. ✅ **Snapshot functionality has been implemented**: `src/snapshot/` directory contains:
   - `snapshot-cli.js` - Complete CLI implementation
   - `snapshot-manager.js` - Full snapshot management system  
   - Supporting modules (context-capture, git-operations, etc.)

2. ✅ **Tests are comprehensive and passing**: 
   - `snapshot-cli.test.js`: 24 passing tests covering CLI commands, formatting, interactive features
   - `snapshot-manager.test.js`: Full test coverage for snapshot management functionality

3. ✅ **No CI failures**: Both test files run successfully without errors

**Conclusion**: No action needed - the snapshot functionality was implemented and the tests are working properly. The original issue described in this prompt has been resolved through normal development.

## ✅ COMPLETED: PROMPT 3: Delete Performance Tests

**Task**: Delete the performance test file entirely.

**COMPLETED ACTIONS**:
1. ✅ **Deleted** `test/no-mocks/integration/step15-performance.test.tsx`
2. ✅ **Confirmed** the file contained flaky timing-based tests with `performance.now()` 
3. ✅ **Verified** it tested implementation details (JSX structure) instead of user behavior

**Examples of Bad Performance Testing Found**:
- `expect(renderTime).toBeLessThan(100)` - Flaky timing assertions
- `performance.now()` based measurements - Unreliable across machines
- Testing JSX element structure instead of user-observable performance
- Arbitrary timing thresholds that fail in CI environments

**Result**: Test suite is now more reliable without flaky performance tests that provided false negatives.

## ✅ COMPLETED: PROMPT 4: Rewrite File Completion Tests

**Task**: Rewrite completion provider tests to focus on completion behavior instead of filesystem operations.

**COMPLETED ACTIONS**:
1. ✅ **Rewritten FileCompletionProvider.test.js**: Removed all filesystem mocking (`fs.existsSync`, `fs.promises.readdir`, `fs.statSync`)
2. ✅ **Rewritten FilesAndDirectoriesCompletionProvider.test.ts**: Removed complex filesystem mocking and Dirent/Stats creation
3. ✅ **Implemented mock completion data strategy**: Both tests now mock completion data instead of filesystem operations
4. ✅ **Focus on completion behavior**: Tests now verify completion logic, filtering, context handling, and integration

**Implemented Test Structure**:
```typescript
describe('FileCompletionProvider', () => {
  // Mock completion data instead of filesystem
  const mockFiles = [
    { name: "file1.txt", type: "file" },
    { name: "file2.js", type: "file" },
    { name: "subdir", type: "directory" },
    { name: ".hidden", type: "file" },
    { name: ".gitignore", type: "file" },
  ];
  
  test('returns completions for matching files');
  test('adds trailing slash to directory completions');
  test('filters hidden files unless prefix starts with dot');
  test('handles context-aware completion triggering');
  test('respects maxItems limit');
  test('handles empty completion data gracefully');
  test('provides prefix correctly for partial matches');
  test('maintains completion behavior after configuration changes');
});
```

**Key Improvements**:
- **Removed filesystem mocking**: No more `fs.existsSync.mockReturnValue()` or complex Dirent mocking
- **Behavior-focused testing**: Tests verify what completions are returned, not how they're discovered
- **Mock completion data**: Tests use predefined completion data that simulates real project structure
- **Context integration**: Tests verify proper integration with completion manager
- **Error handling**: Tests verify graceful handling of search errors and empty results
- **Configuration testing**: Tests verify behavior after cwd/settings changes

**Files Rewritten**:
- ✅ `test/with-mocks/unit/completion/FileCompletionProvider.test.js` - Now tests completion behavior with mock data
- ✅ `test/with-mocks/unit/completion/FilesAndDirectoriesCompletionProvider.test.ts` - Now tests fuzzy search behavior without filesystem mocking

**Result**: Completion tests now focus on completion behavior rather than filesystem implementation details, making them more reliable and meaningful.

## PROMPT 5: Rewrite Integration Tests to Test Behavior

**Task**: Rewrite step-based integration tests to test user behavior instead of JSX structure.

**Files to Rewrite**:
- `test/*/integration/step3-messages.test.tsx`
- `test/*/integration/step4-navigation.test.tsx`
- All similar step-based tests

**Current Problem**: Tests verify internal JSX structure instead of user-observable behavior.

**Instructions**:
1. Remove all JSX structure assertions
2. Test actual user interactions and their outcomes
3. Use React Testing Library user events
4. Focus on what users experience, not component internals

**Required Test Pattern**:
```typescript
describe('Message Display Integration', () => {
  test('user can send message and see response');
  test('user can navigate through message history with arrow keys');
  test('user can search messages and navigate results');
  test('user input is properly validated and submitted');
  test('error messages display when something goes wrong');
});
```

**Testing Approach**: Simulate real user interactions (typing, clicking, keyboard shortcuts) and verify outcomes.

## PROMPT 6: Fix Model Provider Tests

**Task**: Rewrite model provider tests to test error conditions without string matching.

**File**: `test/with-mocks/unit/model-providers.test.js`

**Current Problem**: Tests match exact error message strings, which are implementation details.

**Instructions**:
1. Remove all string matching against error messages
2. Test that error conditions occur, not exact error text
3. Focus on provider behavior patterns

**Required Test Structure**:
```typescript
describe('Model Providers', () => {
  test('throws error when invalid configuration provided');
  test('handles network failures gracefully');
  test('manages session state correctly');
  test('tracks token usage accurately');
  test('switches between providers without data loss');
  test('handles rate limiting appropriately');
});
```

**Testing Approach**: Verify error types/categories, not exact messages. Test behavior patterns, not implementation details.

## Quick Reference

**For complete testing guidelines, patterns, and setup instructions**: `docs/testing-howto.md`

**Key Anti-Patterns Being Removed**:
- `expect(true).toBe(true)` fake tests
- String matching source code (`expect(code).toContain('import...')`)
- File existence checks (`fs.existsSync()`)
- JSX structure testing instead of behavior testing
- Implementation detail testing instead of user experience testing

## ANTI-PATTERNS TO AVOID

### File Existence Checks
```javascript
// BAD - compiler/import system already validates this
expect(fs.existsSync(fullPath)).toBe(true);

// GOOD - if import fails, test will fail anyway
import Component from './Component';
```

### String Matching Source Code
```javascript
// BAD - fragile, breaks on formatting
expect(sourceCode).toContain("export default Component");

// GOOD - test actual exports work
expect(typeof Component).toBe('function');
```

### Fake Manual Verification Tests
```javascript
// BAD - not a test at all
test("manual verification checklist", () => {
  // ✅ Check this manually
  // ✅ Verify that thing
  expect(true).toBe(true);
});

// GOOD - delete this entirely or write real test
test("component renders correctly", () => {
  render(<Component />);
  expect(screen.getByText("Expected text")).toBeInTheDocument();
});
```

### Testing Internal Implementation
```javascript
// BAD - testing internal props/state
expect(component.props.internalProp).toBe(expectedValue);

// GOOD - testing user-observable behavior
expect(screen.getByRole('button')).toHaveTextContent('Click me');
```

## PRINCIPLES FOR GOOD TESTS

1. **Test behavior, not implementation**
2. **Test what users experience, not internal code structure**
3. **Every test should fail if functionality breaks**
4. **No fake tests with `expect(true).toBe(true)`**
5. **Avoid string matching against source code**
6. **Don't test what the compiler already validates**

## PROMPT 7: Implement Missing UI Component Tests

**Task**: Create comprehensive test suites for UI components that currently lack proper test coverage.

**Components to Test**:
1. `src/ui/components/ConversationView.tsx`
2. `src/ui/components/InputBar.tsx` 
3. `src/ui/components/StatusBar.tsx`
4. `src/ui/components/ToolApprovalModal.tsx`
5. `src/ui/components/Message.tsx`

**For Each Component, Create Tests**:
```typescript
// Example for ConversationView:
describe('ConversationView', () => {
  test('renders messages in correct order');
  test('scrolls to specific message when scrollPosition changes');
  test('highlights search results when searchTerm provided');
  test('handles empty conversation gracefully');
  test('displays loading states appropriately');
  test('handles message formatting correctly');
});
```

**Testing Requirements**:
- Use React Testing Library
- Mock external dependencies
- Test user-observable behavior
- Include accessibility testing
- Test error states and edge cases

## PROMPT 8: Implement Core Module Tests

**Task**: Create test suites for core modules that lack any test coverage.

**Priority Modules**:
1. Agent system (`src/agents/`)
2. Safety/approval engine (`src/safety/`)
3. Tool registry (`src/tools/tool-registry.js`)
4. Activity logging (`src/logging/activity-logger.js`)

**For Agent System**:
```typescript
describe('Agent Orchestration', () => {
  test('routes messages to appropriate agent roles');
  test('handles role switching correctly');
  test('manages inter-agent communication');
  test('handles agent failures gracefully');
  test('maintains conversation context across agents');
});
```

**For Safety Engine**:
```typescript
describe('Approval Engine', () => {
  test('assesses risk levels correctly');
  test('requires approval for high-risk operations');
  test('auto-approves low-risk operations');
  test('handles user approval/denial properly');
  test('integrates with tool execution pipeline');
});
```

**Testing Strategy**: Mock external dependencies, focus on logic flow and decision making.

## PROMPT 9: Build Integration Test Suite

**Task**: Create comprehensive integration tests that test full user workflows.

**Required Integration Tests**:

```typescript
describe('Full Conversation Flow', () => {
  test('user sends message → agent processes → response displays');
  test('user requests tool execution → approval flow → tool runs → results display');
  test('user searches messages → results show → navigation works');
  test('error occurs → graceful degradation → user sees helpful message');
  test('large conversation → performance remains acceptable');
});

describe('Tool Execution Workflow', () => {
  test('tool request → risk assessment → approval modal → execution → results');
  test('tool execution failure → error handling → user notification');
  test('multiple concurrent tools → proper sequencing → all complete');
});

describe('Search and Navigation', () => {
  test('search activation → input focus → results display → navigation');
  test('search with no results → appropriate message');
  test('search performance with large conversation');
});
```

**Integration Testing Approach**:
- Test end-to-end workflows
- Use minimal mocking (only external services)
- Test real user interaction patterns
- Include error scenarios and edge cases

## PRIORITY ORDER

1. **First**: Delete all fake tests (immediate harm to test suite reliability)
2. **Second**: Delete "not implemented" failing tests (makes CI unreliable)  
3. **Third**: Implement missing core functionality tests (agent system, safety, tools)
4. **Fourth**: Rewrite implementation-detail tests to test behavior
5. **Fifth**: Add missing UI component tests
6. **Sixth**: Build comprehensive integration test suite