# MCP Alignment Analysis & Recommendations

## Overview
This document analyzes how our tool type system should align with the Model Context Protocol (MCP) specification to ensure seamless future integration.

## Key MCP Concepts

### Tool Definition
MCP tools are defined with:
```typescript
{
  name: string;              // Unique programmatic identifier
  title?: string;            // Human-friendly display name (new!)
  description?: string;      // Detailed description
  inputSchema: {            // JSON Schema (camelCase!)
    type: "object";
    properties?: {...};
    required?: string[];
  };
  annotations?: {           // Behavioral hints
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}
```

### Tool Calls
MCP uses this structure for tool invocation:
```typescript
{
  method: "tools/call";
  params: {
    name: string;           // Tool name
    arguments: object;      // NOT "input" - this is key!
  }
}
```

### Tool Results
```typescript
{
  isError?: boolean;        // Optional error flag
  content: ContentBlock[];  // Array of content blocks
}
```

### Content Blocks
```typescript
type ContentBlock = 
  | { type: "text"; text: string; _meta?: any }
  | { type: "image"; data: string; mimeType?: string; _meta?: any }
  | { type: "resource"; resource: { uri: string; text?: string; blob?: string; mimeType?: string; } }
```

## Critical Alignment Issues

### 1. **Field Naming Mismatches**

| Our Current | MCP Standard | Action Needed |
|------------|--------------|---------------|
| `input_schema` | `inputSchema` | Rename to camelCase |
| `input` (in tool calls) | `arguments` | Rename for MCP compatibility |
| N/A | `title` (optional) | Add for better UI support |

### 2. **Tool Call Structure**

**Current approach:**
```typescript
// Our ToolCall
{
  id: string;
  name: string;
  input: Record<string, unknown>;  // Should be "arguments"
}
```

**MCP-aligned approach:**
```typescript
// MCP-aligned ToolCall
{
  id: string;
  name: string;
  arguments: Record<string, unknown>;  // MCP standard
}
```

### 3. **Zod vs Plain TypeScript**

MCP SDK uses Zod extensively for:
- Runtime validation
- Type generation from schemas
- Consistent error handling

**Pros of adopting Zod:**
- Runtime validation for tool inputs
- Better error messages
- Type inference from schemas
- MCP SDK compatibility

**Cons:**
- Additional dependency
- Learning curve
- Refactoring effort

## Recommended Changes for MCP Alignment

### Phase 1: Essential Naming Alignment (Do First)

1. **Update Tool interface:**
```typescript
export interface Tool {
  name: string;
  title?: string;              // Add optional title
  description: string;
  inputSchema: ToolInputSchema; // Rename from input_schema
  annotations?: ToolAnnotations;
  executeTool(call: ToolCall, context?: ToolContext): Promise<ToolResult>;
}
```

2. **Update ToolCall:**
```typescript
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;  // Rename from "input"
}
```

3. **Keep our ToolResult as-is** (already aligns with MCP):
```typescript
export interface ToolResult {
  id?: string;
  content: ContentBlock[];
  isError: boolean;  // MCP uses optional, we use required
  metadata?: Record<string, unknown>;
}
```

### Phase 2: Consider Zod Adoption (Optional, Later)

If we adopt Zod, the approach would be:
```typescript
import { z } from 'zod';

// Define schemas
export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});

// Generate types from schemas
export type ToolCall = z.infer<typeof ToolCallSchema>;

// Runtime validation
export function validateToolCall(data: unknown): ToolCall {
  return ToolCallSchema.parse(data);
}
```

## Migration Strategy

### Immediate Changes (for MCP alignment):

1. **Rename fields throughout codebase:**
   - `input_schema` → `inputSchema`
   - `input` → `arguments` (in tool calls)
   - Add optional `title` field to Tool interface

2. **Update all tool implementations:**
   - Change `call.input` to `call.arguments`
   - Update schema field name

3. **Update agent and thread types:**
   - Ensure consistent use of `arguments` instead of `input`

### Future Considerations:

1. **Zod adoption** - Can be done incrementally, starting with tool input validation
2. **Resource content structure** - Our simpler structure is fine for now
3. **_meta fields** - Add if needed for extensibility

## Benefits of Alignment

1. **Future MCP integration** will be straightforward
2. **Consistent naming** reduces cognitive load
3. **Tool portability** between Lace and MCP servers
4. **Clear upgrade path** as MCP evolves

## Recommendation Summary

**Must do now:**
- Rename `input_schema` to `inputSchema`
- Rename `input` to `arguments` in tool calls
- Add optional `title` field to Tool interface

**Consider later:**
- Adopt Zod for runtime validation
- Add _meta fields if extensibility needed

**Keep as-is:**
- Our ContentBlock structure (simpler than MCP's)
- Our required `isError` field (more explicit than optional)
- Our metadata approach for extensions