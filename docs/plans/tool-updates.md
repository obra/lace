# Tool Improvements Implementation Plan

## Context & Codebase Overview

**Architecture**: Tools are in `src/tools/implementations/` with each tool implementing the `Tool` interface from `src/tools/types.ts`. Tools are registered in the main system and tested with co-located test files.

**Key Files**:
- Tool implementations: `src/tools/implementations/*.ts`
- Tool types: `src/tools/types.ts` 
- Tool registration: `src/tools/registry.ts`
- Tests: `src/tools/implementations/*.test.ts`

**Testing**: Run `npm test` (watch mode) or `npm run test:run` (once). Use TDD - write failing test first, implement fix, verify.

**Build**: `npm run build` compiles TypeScript. `npm run lint` checks code style.

## Phase 1: Add Result Limits to Search Tools

### Task 1.1: Update ripgrep-search.ts result limiting
**Files**: `src/tools/implementations/ripgrep-search.ts`, `src/tools/implementations/ripgrep-search.test.ts`

**Problem**: Tool processes all matches then limits to 100. Need early termination at 50.

**Implementation**:
1. Change `maxResults` default from 100 to 50 in `inputSchema` (line 46)
2. Modify `buildRipgrepArgs()` to use `--max-count` per file, not total
3. Add post-processing limit in `parseRipgrepOutput()` to cap at 50 total results
4. Update `formatResults()` to show truncation message when limit hit

**Testing**:
- Create test with pattern matching >50 results, verify stops at 50
- Test that truncation message appears
- Verify existing functionality unchanged

**Files to check**: Look at existing test patterns in `ripgrep-search.test.ts`

**Commit**: "fix: limit ripgrep results to 50 by default with early termination"

### Task 1.2: Add result limits to file-find.ts  
**Files**: `src/tools/implementations/file-find.ts`, `src/tools/implementations/file-find.test.ts`

**Problem**: No result limits - could return thousands of files.

**Implementation**:
1. Add `maxResults` parameter to `inputSchema` (default: 50)
2. Modify `findFiles()` method to track result count and stop early
3. Add truncation message when limit reached
4. Update type definitions in function signature

**Testing**:
- Create test directory with >50 files, verify stops at 50
- Test maxResults parameter override
- Verify recursive search respects limit

**Files to check**: Look at `file-list.test.ts` for directory setup patterns

**Commit**: "fix: add 50-result limit to file-find tool"

### Task 1.3: Improve file-list.ts result limiting
**Files**: `src/tools/implementations/file-list.ts`, `src/tools/implementations/file-list.test.ts`

**Problem**: Only summarizes large directories, but no global result limit.

**Implementation**: 
1. Add `maxResults` parameter to `inputSchema` (default: 50)
2. Modify `buildTree()` to track total items and stop early
3. Add truncation indication in tree output
4. Ensure summary directories count toward limit

**Testing**:
- Test with directory having >50 total items across subdirectories
- Verify truncation message appears
- Test maxResults parameter works

**Commit**: "fix: add global 50-result limit to file-list tool"

## Phase 2: Rename and Improve Task Tool

### Task 2.1: Rename task_add to tasks_add with bulk support
**Files**: `src/tools/implementations/task-manager.ts`, `src/tools/implementations/task-manager.test.ts`

**Problem**: Tool only adds single tasks, should encourage multiple detailed tasks.

**Implementation**:
1. Rename `TaskAddTool` class to `TasksAddTool` 
2. Change `name` from `'task_add'` to `'tasks_add'`
3. Update `inputSchema` to accept `tasks` array instead of single `description`
4. Update `description` to encourage small, detailed tasks
5. Modify `executeTool()` to handle array of task descriptions
6. Update response to show all added tasks

**Schema changes**:
```typescript
// Old: { description: string }
// New: { tasks: string[] }
```

**Testing**:
- Test single task creation (backward compatibility)
- Test multiple task creation
- Verify task IDs increment properly
- Test validation for empty arrays

**Files to check**: Review existing `task-manager.test.ts` for test patterns

**Commit**: "refactor: rename task_add to tasks_add with bulk task creation"

### Task 2.2: Update tool registration 
**Files**: `src/tools/registry.ts`

**Problem**: Tool registry still references old `task_add` name.

**Implementation**:
1. Find where `TaskAddTool` is imported and registered
2. Update import to `TasksAddTool`
3. Verify tool name change doesn't break existing functionality

**Testing**:
- Run integration tests to ensure tool is properly registered
- Test that `tasks_add` tool is available via API

**Commit**: "fix: update tool registry for renamed tasks_add tool"

## Phase 3: Improve Error Messages

### Task 3.1: Enhance file-edit.ts error messages
**Files**: `src/tools/implementations/file-edit.ts`, `src/tools/implementations/file-edit.test.ts`

**Current issues**: "Could not parse edit result" - need actionable errors.

**Implementation**:
1. Review current error messages (lines 72-84)
2. Add specific file context to error messages  
3. Improve "no matches" error with snippet of actual file content around expected location
4. Add line number information to multiple matches error
5. Standardize error format: "PROBLEM: X. SOLUTION: Y. CONTEXT: Z."

**Testing**:
- Test no matches error shows file content preview
- Test multiple matches error shows line numbers
- Verify helpful suggestions appear

**Commit**: "improve: enhance file-edit error messages with context and solutions"

### Task 3.2: Standardize error messages across tools
**Files**: All `src/tools/implementations/*.ts` files and their tests

**Problem**: Inconsistent error message quality and format.

**Implementation**:
1. Create error message standards in `src/tools/types.ts`
2. Add helper functions for consistent error formatting
3. Update each tool to use standardized error messages:
   - `bash.ts`: Improve command not found errors
   - `file-read.ts`: Better file not found context
   - `url-fetch.ts`: More specific network error messages
   - `delegate.ts`: Better delegation failure messages

**Testing**:
- Test each tool's error scenarios
- Verify consistent error format across tools
- Check that solutions are actionable

**Commit**: "improve: standardize error messages across all tools"

## Phase 4: Testing and Validation

### Task 4.1: Update all test files for new limits
**Files**: All `src/tools/implementations/*.test.ts`

**Implementation**:
1. Update existing tests to expect 50-result limits
2. Add new tests for limit edge cases
3. Verify no existing functionality broken  
4. Add performance tests for large result sets

**Testing**:
- Run full test suite: `npm run test:run`
- Check test coverage: `npm run test:coverage`
- Fix any failing tests

**Commit**: "test: update all tool tests for new result limits"

### Task 4.2: Integration testing
**Files**: Integration test files (check `src/` for test patterns)

**Implementation**:
1. Test tool registration with new names
2. Test end-to-end workflows with limited results
3. Verify tool approval system works with changes
4. Test error handling in real scenarios

**Testing**:
- Run integration tests: `npm run test:integration`
- Manual testing of CLI with new limits
- Test tool approval workflows

**Commit**: "test: add integration tests for tool improvements"

## Implementation Order & Commit Strategy

**Day 1**: Tasks 1.1-1.3 (search tool limits)
**Day 2**: Tasks 2.1-2.2 (task tool rename)  
**Day 3**: Tasks 3.1-3.2 (error messages)
**Day 4**: Tasks 4.1-4.2 (testing)

**Commit after each task** - small, focused commits with clear messages.

## Files to Reference During Implementation

- `src/tools/types.ts` - Tool interface and type definitions
- `src/tools/registry.ts` - How tools are registered
- `package.json` - Available npm scripts
- `src/config/prompts/` - May need updates if tool descriptions change
- Any existing `*.test.ts` files - Test patterns and setup

## Validation Checklist

Before marking complete:
- [ ] All search tools limit to 50 results by default
- [ ] `tasks_add` tool accepts multiple tasks
- [ ] Error messages follow consistent format with actionable solutions
- [ ] All tests pass: `npm run test:run`
- [ ] Build succeeds: `npm run build` 
- [ ] Linting passes: `npm run lint`
- [ ] Integration tests pass
- [ ] Manual CLI testing confirms improvements work