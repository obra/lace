# Review Comments for PR #133

## Critical Issues

### 1. Agent Hangs on Denied Tools
**File:** `src/agents/agent.ts`
**Lines:** 1005-1033
**Issue:** When `requestToolPermission()` returns a ToolResult with status 'denied', the code falls into the "pending" path and returns. The tool call stays in `_activeToolCalls`, `_pendingToolCount` is never decremented, and no TOOL_RESULT event is emitted, causing the agent to hang in tool_execution state.

### 2. Race Condition in Environment Variables
**File:** `src/tools/executor.ts`
**Lines:** 262-310
**Issue:** `executeToolDirect()` mutates process.env globally then restores it. Multiple concurrent tools can overlap and clobber each other's mutations, leading to lost or corrupted environment variables.

## Type Safety Issues

### 3. Use of 'any' Type in SimpleTool
**File:** `src/tools/types.test.ts`
**Lines:** 49-53
**Issue:** The `executeValidated` method uses `any` for the `_args` parameter instead of a specific type.

### 4. Use of 'any' Type in Test Schema
**File:** `src/tools/types.test.ts`
**Lines:** 30-34
**Issue:** The `_args` parameter uses `any` instead of `z.infer<typeof this.schema>`.

### 5. ToolResults Array Uses 'any[]'
**File:** `src/agents/agent-tool-abort.test.ts`
**Lines:** 160-168
**Issue:** The `toolResults` array is typed as `any[]` instead of `ToolResult[]`.

### 6. Missing Context Parameter in Mock Tools
**File:** `src/agents/agent-token-tracking.test.ts`
**Lines:** 209, 319
**Issue:** The `executeValidated` method overrides are missing the context parameter of type ToolContext.

## UI/Status Handling Issues

### 7. Missing Status Mappings in Delegate UI
**File:** `packages/web/components/timeline/tool/delegate.tsx`
**Lines:** 24-48
**Issue:** ToolResult.status can be 'aborted' | 'denied', but both are missing from statusConfig, causing UI to fall back to "in progress" style.

### 8. Incomplete Status Checks in ToolCallDisplay
**File:** `packages/web/components/ui/ToolCallDisplay.tsx`
**Lines:** 87, 92
**Issue:** Code only checks for 'failed' status, missing 'denied' (error) and 'aborted' (warning).

### 9. Status Union Mismatch in Web Package
**File:** `packages/web/components/ui/ToolCallDisplay.tsx`
**Lines:** 20-21
**Issue:** Web package's ToolResult.status union ('success' | 'failed' | 'pending') doesn't match core's ('completed' | 'failed' | 'aborted' | 'denied').

### 10. Incorrect isError Logic in file-write
**File:** `packages/web/components/timeline/tool/file-write.tsx`
**Lines:** 29-32
**Issue:** The isError function treats any non-'completed' status as error with outdated comments.

### 11. Incorrect isError Logic in file-edit
**File:** `packages/web/components/timeline/tool/file-edit.tsx`
**Lines:** 39-42
**Issue:** Similar to file-write, incorrectly groups cancellation with errors.

### 12. Task Renderer Doesn't Check Status
**File:** `packages/web/components/timeline/tool/task.tsx`
**Lines:** 552-557
**Issue:** `taskAddNoteRenderer.renderResult` doesn't check result.status and may show "Note added successfully" for aborted/denied/failed tools.

### 13. Unused isError Variable
**File:** `packages/web/components/timeline/tool/bash.tsx`
**Line:** 72
**Issue:** Variable `isError` is declared but never used.

## Test Coverage Issues

### 14. Missing Test Coverage for Status Types
**File:** `packages/web/components/timeline/tool/file-write.test.ts`
**Lines:** 23-24
**Issue:** Missing test coverage for 'aborted' and 'denied' statuses.

### 15. Misleading Test Name
**File:** `packages/web/components/timeline/tool/file-write.test.ts`
**Lines:** 100-101
**Issue:** Test name doesn't clearly state that 'completed' status takes precedence over content analysis.

### 16. Wrong Status for Error Cases
**File:** `packages/web/components/timeline/tool/delegate.test.ts`
**Lines:** 48-49, 64-65
**Issue:** Mock objects set status to 'completed' despite containing errors - should be 'failed'.

### 17. Missing Abort Test Coverage
**File:** `src/tools/implementations/task-manager/bulk-tasks.test.ts`
**Lines:** 86-92
**Issue:** Missing test case for cancellation scenario with aborted AbortSignal.

### 18. Missing Abort Tests in file-find
**File:** `src/tools/file-find.test.ts`
**Lines:** 478-485
**Issue:** Missing test case for already-aborted signal.

### 19. Missing Abort Tests in delegate
**File:** `src/tools/implementations/delegate-task-based.test.ts`
**Lines:** 57-61
**Issue:** AbortSignal added to context but abort behavior not tested.

### 20. Missing Deduplication Tests
**File:** `src/threads/conversation-builder.test.ts`
**Lines:** 164-168, 175-178, 199-203, 210-214, 232, 243, 273, 289
**Issue:** Missing test cases for TOOL_RESULT event deduplication with different statuses.

## Cancellation/Abort Issues

### 21. Regex Special Characters Not Escaped
**File:** `src/tools/ripgrep-search.test.ts`
**Lines:** 454-465
**Issue:** Test searches for literal '$10.50' but implementation treats it as regex, causing special characters to be interpreted as regex operators.

### 22. Abort Signal Not Propagated to Fetch
**File:** `src/tools/implementations/url-fetch.ts`
**Lines:** 142-147
**Issue:** Code checks if signal is aborted before fetch but doesn't propagate the signal to the ongoing fetch request.

### 23. Abort Signal Not Propagated in Ripgrep
**File:** `src/tools/implementations/ripgrep-search.ts`
**Lines:** 86-92
**Issue:** The rg process isn't aborted when signal flips during execution.

### 24. Signal Not Propagated in file-list
**File:** `src/tools/implementations/file-list.ts`
**Lines:** 68-75
**Issue:** Abort signal not propagated to recursive methods buildTree and countFilesAndDirs.

### 25. Missing Mid-Operation Abort Check in file-insert
**File:** `src/tools/implementations/file-insert.ts`
**Lines:** 27-31
**Issue:** No abort check immediately before writeFile call.

### 26. Signal Not Checked During Traversal in file-find
**File:** `src/tools/implementations/file-find.ts`
**Lines:** 42-49, 72-81, 104-115, 118-129, 156-166
**Issue:** Cancellation signal only checked at start, not during file traversal.

### 27. Limited Abort Checks in file-edit
**File:** `src/tools/implementations/file-edit.ts`
**Lines:** 70-74
**Issue:** Cancellation only checked at start of executeValidated, not during long operations.

### 28. Delegate Doesn't Propagate Cancellation
**File:** `src/tools/implementations/delegate.ts`
**Lines:** 85-99
**Issue:** waitForTaskCompletion doesn't observe context.signal, causing hangs and listener leaks.

### 29. Incorrect Exit Code Handling in Bash
**File:** `src/tools/implementations/bash.ts`
**Lines:** 160-167
**Issue:** Null exitCode treated as 0, incorrectly marking killed processes as successful.

### 30. Memory Leak in Bash Abort Handler
**File:** `src/tools/implementations/bash.ts`
**Lines:** 101-124
**Issue:** Abort event listener not removed when child process fails to spawn early.

### 31. Memory Leak in Mock Slow Tool
**File:** `src/test-utils/mock-slow-tool.ts`
**Lines:** 58-67
**Issue:** abortHandler doesn't remove itself as event listener after clearing interval.

## Error Handling Issues

### 32. Tool Throws Instead of Returning Result
**File:** `src/tools/implementations/file-read.ts`
**Lines:** 134-136
**Issue:** Tool throws errors instead of returning failure ToolResult.

### 33. Tool Throws on Read Errors
**File:** `src/tools/implementations/file-edit.ts`
**Lines:** 88-101
**Issue:** Throws on unknown read errors instead of returning ToolResult.

### 34. Sensitive Headers in Error Output
**File:** `src/tools/implementations/url-fetch.ts`
**Lines:** 486-540
**Issue:** Error details echo headers verbatim, risking leaking Authorization, Cookie, API keys.

### 35. Wrong Encoding Parameter
**File:** `src/tools/implementations/file-write.ts`
**Line:** 50
**Issue:** Encoding should be 'utf8', not 'utf-8'.

## Other Issues

### 36. Console.log in Tests
**File:** `src/agents/agent-tool-abort.test.ts`
**Lines:** 546-547
**Issue:** Console.log statements violate project guidelines.

### 37. Empty tool_call_id Fallback
**File:** `src/providers/format-converters.ts`
**Lines:** 96-101
**Issue:** Code defaults tool_call_id to empty string when result.id missing, but OpenAI requires matching tool_call_id.

### 38. Missing AbortSignal in Test Context
**File:** `src/tools/tool-executor-security.test.ts`
**Lines:** 116-120
**Issue:** ToolContext missing required signal field.

### 39. Wrong Argument Order in Project.create
**File:** `src/tools/temp-directory-integration.test.ts`
**Lines:** 70-78
**Issue:** Description and workingDirectory arguments are swapped in Project.create call.

### 40. Optional Context in Test Tool
**File:** `src/tools/temp-directory-integration.test.ts`
**Lines:** 36-43
**Issue:** Context should be required in executeValidated to match new contract.