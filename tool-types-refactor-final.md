# Tool Types Refactor: Final Plan (MCP-Aligned)

## Overview
Fix data loss issue by storing rich ContentBlock arrays, consolidate duplicate types, and align with MCP naming conventions for future compatibility.

## Goals
1. **Fix data loss** - Store full ContentBlock arrays, not flattened strings
2. **Align with MCP** - Use MCP naming conventions (arguments, inputSchema)
3. **Consolidate types** - Single source of truth for tool-related types
4. **No backward compatibility** - Clean break since we're pre-release

## Critical MCP Alignment Changes

### Naming Conventions to Adopt:
- `inputSchema` instead of `input_schema` (camelCase)
- `arguments` instead of `input` in tool calls
- Add optional `title` field to tools
- Keep `isError` as required (more explicit than MCP's optional)

## Implementation Phases

### Phase 1: Update Tool Types with MCP Alignment

**File: `src/tools/types.ts`**
```typescript
// Add ToolCall interface (MCP-aligned)
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;  // MCP uses "arguments"
}

// Update Tool interface
export interface Tool {
  name: string;
  title?: string;                    // Add optional title for UI
  description: string;
  inputSchema: ToolInputSchema;      // Rename from input_schema
  annotations?: ToolAnnotations;
  executeTool(call: ToolCall, context?: ToolContext): Promise<ToolResult>;
}

// Update ToolResult with id and metadata
export interface ToolResult {
  id?: string;                       // Optional - set by tools if they have it
  content: ContentBlock[];
  isError: boolean;                  // Keep required (clearer than MCP's optional)
  metadata?: Record<string, unknown>;
}

// Update helper functions
export function createSuccessResult(
  content: ContentBlock[],
  id?: string,
  metadata?: Record<string, unknown>
): ToolResult {
  return { content, isError: false, id, metadata };
}

export function createErrorResult(
  input: string | ContentBlock[],
  id?: string,
  metadata?: Record<string, unknown>
): ToolResult {
  if (typeof input === 'string') {
    return { content: [{ type: 'text', text: input }], isError: true, id, metadata };
  }
  return { content: input, isError: true, id, metadata };
}
```

### Phase 2: Update Thread Types to Use Tool Types

**File: `src/threads/types.ts`**
```typescript
// Remove these duplicate types entirely:
// - ToolCallData
// - ToolResultData

// Import from tools instead
import { ToolCall, ToolResult } from '../tools/types.js';

// Update ThreadEvent to use imported types
export interface ThreadEvent {
  id: string;
  threadId: string;
  type: EventType;
  timestamp: Date;
  data: string | ToolCall | ToolResult;  // Uses tool system types
}
```

### Phase 3: Update All Tool Implementations

**Pattern for all tools in `src/tools/implementations/`:**
```typescript
// OLD signature
async executeTool(input: Record<string, unknown>, context?: ToolContext): Promise<ToolResult>

// NEW signature  
async executeTool(call: ToolCall, context?: ToolContext): Promise<ToolResult>

// Inside implementation, change:
// const { param1, param2 } = input as {...}
// To:
const { param1, param2 } = call.arguments as {...}

// Return with call.id if needed:
return createSuccessResult(content, call.id);
```

### Phase 4: Update Agent to Preserve Rich Content

**File: `src/agents/agent.ts`**

1. **Import ToolCall from tools:**
```typescript
import { Tool, ToolResult, ToolCall } from '../tools/types.js';
// Remove local ToolCall interface
```

2. **Update tool execution (lines ~570-598):**
```typescript
// OLD - loses data
const result = await this._toolExecutor.executeTool(toolCall.name, toolCall.input, {
  threadId: this._threadId,
});
const outputText = result.content[0]?.text || '';
this._threadManager.addEvent(this._threadId, 'TOOL_RESULT', {
  callId: toolCall.id,
  output: outputText,
  success: !result.isError,
  error: result.isError ? result.content[0]?.text || 'Unknown error' : undefined,
});

// NEW - preserves full content
const toolCallObj: ToolCall = {
  id: toolCall.id,
  name: toolCall.name,
  arguments: toolCall.input,  // Map provider 'input' to MCP 'arguments'
};

const result = await this._toolExecutor.executeTool(toolCallObj, {
  threadId: this._threadId,
});

// Store full result
const toolResult: ToolResult = {
  id: toolCall.id,
  content: result.content,
  isError: result.isError,
  metadata: result.metadata,
};

this._threadManager.addEvent(this._threadId, 'TOOL_RESULT', toolResult);
```

3. **Update conversation builder to handle new types:**
   - Map between provider's `input` and our MCP-aligned `arguments`
   - Handle rich ContentBlock arrays in tool results

### Phase 5: Update Provider Types

**File: `src/providers/base-provider.ts`**
```typescript
// Keep ProviderToolCall as-is (providers may use 'input')
export interface ProviderToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;  // Providers keep 'input'
}

// Update ProviderToolResult to use ContentBlock
import { ContentBlock } from '../tools/types.js';

export interface ProviderToolResult {
  id: string;
  content: ContentBlock[];         // Rich content instead of string
  isError: boolean;               // Align with our naming
}
```

### Phase 6: Update ToolExecutor

**File: `src/tools/executor.ts`**
```typescript
// Update executeTool signature
async executeTool(
  call: ToolCall,  // Full call object instead of separate params
  context?: ToolContext
): Promise<ToolResult> {
  const tool = this._toolMap.get(call.name);
  if (!tool) {
    return createErrorResult(`Unknown tool: ${call.name}`, call.id);
  }
  
  // Validate against inputSchema (not input_schema)
  // Pass full call object to tool
  return await tool.executeTool(call, context);
}
```

### Phase 7: Update UI Components

**File: `src/interfaces/thread-processor.ts` and tool renderers**
- Access `result.content` array instead of `result.output` string
- Handle multiple ContentBlocks
- Support all content types (text, image, resource)

### Phase 8: Update Delegate Tool

**File: `src/tools/implementations/delegate.ts`**
```typescript
// Return with metadata
return createSuccessResult(
  [{
    type: 'text',
    text: combinedResponse || 'Subagent completed without response',
  }],
  call.id,
  { threadId: subagentThreadId }
);
```

## Migration Order

1. **Update tool types first** (Phase 1) - Establishes new interfaces
2. **Update thread types** (Phase 2) - Removes duplicates
3. **Update ToolExecutor** (Phase 6) - Central execution point
4. **Update all tools** (Phase 3) - Implement new signature
5. **Update Agent** (Phase 4) - Stop flattening data
6. **Update providers** (Phase 5) - Rich content support
7. **Update UI** (Phase 7) - Display rich content
8. **Update delegate** (Phase 8) - Metadata support

## Testing Focus

1. **Content preservation**: Verify ContentBlock arrays pass through unchanged
2. **Multi-block tools**: Test tools returning multiple content blocks
3. **Image/resource content**: Test non-text content types
4. **Metadata flow**: Verify delegation metadata works
5. **MCP naming**: Ensure `arguments` and `inputSchema` work correctly

## Summary of Changes

### What's Changing:
- `input_schema` → `inputSchema` (MCP alignment)
- `input` → `arguments` in tool calls (MCP alignment)
- `ToolCallData`/`ToolResultData` → `ToolCall`/`ToolResult`
- String outputs → ContentBlock arrays (fixes data loss)
- Added `title` field to tools (optional)
- Added `id` and `metadata` to ToolResult

### What's Staying the Same:
- ContentBlock structure (our simpler approach)
- Required `isError` field (clearer than optional)
- Tool execution flow
- Database schema (already stores JSONB)

## Benefits

1. **No more data loss** - Full content preserved through the pipeline
2. **MCP compatibility** - Easy integration when we add MCP support
3. **Cleaner architecture** - Single source of truth for types
4. **Better extensibility** - Metadata support for future features
5. **Richer UI** - Can display all content types properly