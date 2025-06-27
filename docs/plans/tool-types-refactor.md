# Tool Types Refactor Plan

## Overview
Eliminate duplicate types by creating unified ToolCall and ToolResult types in the tool system, removing thread-specific duplicates and unnecessary conversion logic.

## Problem Statement
Currently we have duplicate types representing the same concepts:

**Tool system** (`src/tools/types.ts`):
- No explicit ToolCall type - tools just receive `input: Record<string, unknown>`
- `ToolResult { content: ContentBlock[], isError: boolean }`

**Thread system** (`src/threads/types.ts`):  
- `ToolCallData { toolName: string, input: Record<string, unknown>, callId: string }`
- `ToolResultData { callId: string, output: string, success: boolean, error?: string }`

This causes:
- Unnecessary conversion logic in Agent that flattens rich content to strings
- Loss of metadata (like delegate thread IDs) during conversion
- Type duplication and maintenance burden
- No way to pass metadata between tools and UI components

## Solution
Use single unified types everywhere with metadata support.

## Phase 1: Create unified ToolCall and extend ToolResult in tool system
**Prompt**: "In `src/tools/types.ts`, add a new ToolCall interface with `id: string`, `name: string`, `input: Record<string, unknown>`. Add `id: string` and `metadata?: Record<string, unknown>` to ToolResult. Update createSuccessResult/createErrorResult to accept optional id and metadata parameters."

**Result**:
```typescript
export interface ToolCall {
  id: string;
  name: string; 
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  content: ContentBlock[];
  isError: boolean;
  metadata?: Record<string, unknown>;
}
```

## Phase 2: Remove duplicate types from thread system
**Prompt**: "In `src/threads/types.ts`, delete ToolCallData and ToolResultData interfaces completely. Import ToolCall and ToolResult from `../tools/types.js`. Update ThreadEvent.data union type to use `string | ToolCall | ToolResult`."

## Phase 3: Update Tool interface to receive ToolCall 
**Prompt**: "In `src/tools/types.ts`, change Tool.executeTool signature from `(input: Record<string, unknown>, context?: ToolContext)` to `(call: ToolCall, context?: ToolContext)`. This gives tools access to the full call including ID."

## Phase 4: Remove conversion logic in Agent
**Prompt**: "In `src/agents/agent.ts`, find all ToolCallData/ToolResultData conversion code. Remove the flattening conversion and store ToolCall/ToolResult objects directly in thread events. Update tool execution to pass ToolCall object to tools."

## Phase 5: Update delegate tool to include threadId metadata
**Prompt**: "In `src/tools/implementations/delegate.ts`, update executeTool signature to receive ToolCall. Return ToolResult with metadata: `{ id: call.id, content: [...], isError: false, metadata: { threadId: subagentThreadId } }`."

## Phase 6: Update DelegationBox to use metadata SKIP FOR NOW
**Prompt**: "In `src/interfaces/terminal/components/events/DelegationBox.tsx`, replace regex extraction with direct access: `toolCall.result?.metadata?.threadId`. Remove all regex parsing logic."

## Phase 7: Update all tool implementations 
**Prompt**: "Update all tools in `src/tools/implementations/` to receive ToolCall parameter instead of separate input. Access input via `call.input`. Each tool should return ToolResult with `call.id`."

## Phase 8: Update UI components and thread processor
**Prompt**: "Update `src/interfaces/thread-processor.ts` and all tool renderer components to work with unified ToolCall/ToolResult types. Access content via `result.content` array instead of flat output string."

## Phase 9: Fix all tests and imports
**Prompt**: "Update all test files to use unified ToolCall/ToolResult types. Remove imports of ToolCallData/ToolResultData. Run `npm run build && npm test` and fix any remaining compilation/test errors."

## Expected Outcome
- Single ToolCall and ToolResult types used everywhere
- No conversion logic anywhere
- Tools receive full call context including ID
- Metadata support for delegation and future extensions  
- Massive reduction in type duplication and tech debt
- Type safety across the entire tool execution pipeline

## Benefits
- **DRY**: Eliminates duplicate type definitions
- **YAGNI**: Removes unnecessary conversion logic
- **Clean**: Single source of truth for tool types
- **Reduced tech debt**: No more maintaining parallel type hierarchies
- **Extensible**: Metadata field enables future features without breaking changes
