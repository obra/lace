# Review Repair Plan

## Priority 1: Critical Bugs (Must Fix)

### 1. Fix Agent Hang on Denied Tools ✅
**File:** `src/agents/agent.ts:1005-1033`
- Add proper handling for denied ToolResult
- Emit TOOL_RESULT event
- Decrement _pendingToolCount
- Remove from _activeToolCalls

### 2. Fix Race Condition in Environment Variables ✅
**File:** `src/tools/executor.ts:262-310`
- Pass environment to child processes via options instead of mutating global process.env
- Use `{ env: { ...process.env, ...projectEnv } }` pattern

## Priority 2: Type Safety (Must Fix)

### 3. Fix 'any' Types ✅
- `src/tools/types.test.ts:49-53`: Use `z.infer<typeof this.schema>`
- `src/tools/types.test.ts:30-34`: Use proper type inference
- `src/agents/agent-tool-abort.test.ts:160-168`: Use `ToolResult[]`
- `src/agents/agent-token-tracking.test.ts:209,319`: Add context parameter

### 4. Fix Missing AbortSignal ✅
- `src/tools/tool-executor-security.test.ts:116-120`: Add signal to context

## Priority 3: UI Status Handling (Must Fix)

### 5. Update UI Components for New Status Values ✅
- `packages/web/components/timeline/tool/delegate.tsx:24-48`: Add 'aborted' and 'denied' to statusConfig
- `packages/web/components/ui/ToolCallDisplay.tsx:87,92`: Handle all status values
- `packages/web/components/ui/ToolCallDisplay.tsx:20-21`: Align status union with core
- `packages/web/components/timeline/tool/file-write.tsx:29-32`: Update isError logic
- `packages/web/components/timeline/tool/file-edit.tsx:39-42`: Update isError logic
- `packages/web/components/timeline/tool/task.tsx:552-557`: Check status in renderResult
- `packages/web/components/timeline/tool/bash.tsx:72`: Remove unused isError

## Priority 4: Abort Signal Propagation (Must Fix)

### 6. Propagate Abort Signals ✅
- `src/tools/implementations/ripgrep-search.ts:86-92`: Pass signal to execFile
- `src/tools/implementations/url-fetch.ts:142-147`: Pass signal to fetch
- `src/tools/implementations/file-list.ts:68-75`: Propagate to recursive methods
- `src/tools/implementations/file-insert.ts:27-31`: Check before writeFile
- `src/tools/implementations/file-find.ts`: Check during traversal
- `src/tools/implementations/file-edit.ts:70-74`: Add mid-operation checks
- `src/tools/implementations/delegate.ts:85-99`: Handle cancellation in waitForTaskCompletion
- `src/tools/implementations/bash.ts:160-167`: Fix null exitCode handling
- `src/tools/implementations/bash.ts:101-124`: Remove listener on early error

### 7. Fix Memory Leaks ✅
- `src/test-utils/mock-slow-tool.ts:58-67`: Remove abort listener properly

## Priority 5: Error Handling (Must Fix)

### 8. Return ToolResults Instead of Throwing ✅
- `src/tools/implementations/file-read.ts:134-136`: Return failure result
- `src/tools/implementations/file-edit.ts:88-101`: Return failure result
- `src/tools/implementations/url-fetch.ts:486-540`: Redact sensitive headers

### 9. Fix Encoding Bug ✅
- `src/tools/implementations/file-write.ts:50`: Change 'utf-8' to 'utf8'

## Priority 6: Test Issues (Should Fix)

### 10. Add Missing Tests ✅
- `packages/web/components/timeline/tool/file-write.test.ts:23-24`: Add status coverage
- `packages/web/components/timeline/tool/file-write.test.ts:100-101`: Rename test
- `packages/web/components/timeline/tool/delegate.test.ts:48-49,64-65`: Fix status values
- `src/tools/implementations/task-manager/bulk-tasks.test.ts:86-92`: Add abort test
- `src/tools/file-find.test.ts:478-485`: Add abort test
- `src/tools/implementations/delegate-task-based.test.ts:57-61`: Test abort behavior
- `src/threads/conversation-builder.test.ts`: Add deduplication tests

### 11. Fix Test Issues ✅
- `src/agents/agent-tool-abort.test.ts:546-547`: Remove console.log
- `src/tools/temp-directory-integration.test.ts:70-78`: Fix argument order
- `src/tools/temp-directory-integration.test.ts:36-43`: Make context required

## Priority 7: Other Fixes (Should Fix)

### 12. Fix Regex Escaping ✅
- `src/tools/ripgrep-search.test.ts:454-465`: Escape special characters or use --fixed-strings

### 13. Fix OpenAI Format ✅
- `src/providers/format-converters.ts:96-101`: Enforce result.id presence

## FOR DISCUSSION

### 1. Regex vs Fixed String Search in Ripgrep
**Issue:** Test searches for literal '$10.50' but implementation treats as regex
**Current Behavior:** Pattern is treated as regex by default
**Proposed Fix:** Add --fixed-strings flag when literal search intended
**Discussion Point:** Should we default to literal search and require explicit regex mode? This would be a breaking change but might be more intuitive for users.

### 2. Status Precedence in Deduplication
**Issue:** Need to define precedence when multiple TOOL_RESULT events have same ID
**Current Behavior:** Not clearly defined
**Discussion Point:** What should the precedence order be? Suggest: denied > failed > aborted > completed

### 3. Abort vs Warning vs Error UI Treatment
**Issue:** How should 'aborted' status be displayed in UI?
**Current Behavior:** Treated as error
**Discussion Point:** Should aborted be neutral (gray), warning (yellow), or error (red)? I lean toward warning since it's user-initiated but still represents incomplete work.

## Implementation Order

1. Fix critical bugs (1-2)
2. Fix type safety issues (3-4)
3. Fix UI status handling (5)
4. Fix abort signal propagation (6-7)
5. Fix error handling (8-9)
6. Fix tests (10-11)
7. Fix other issues (12-13)
8. Discuss and resolve discussion items

## Notes

- All fixes should maintain the event-sourcing architecture
- No backward compatibility code should be added
- Follow existing patterns in the codebase
- Run tests after each group of fixes to ensure nothing breaks