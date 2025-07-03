# Tool System Refactoring Plan

## Context

Lace is an AI coding assistant that uses "tools" to interact with the user's system - reading files, executing commands, searching code, etc. The current tool system has significant issues:

- **Verbose validation**: Each tool has 40+ lines of manual parameter validation
- **No type safety**: Parameters are manually cast with `as { param: type }`
- **Repetitive error handling**: Same validation patterns copied across tools
- **Mixed concerns**: Business logic mixed with validation boilerplate

## Goals

1. **Eliminate validation boilerplate** - Tools should focus on business logic only
2. **Add type safety** - Validated parameters should be fully typed
3. **Improve error messages** - Better validation errors help the AI understand issues
4. **Maintain compatibility** - All existing functionality must continue working
5. **Enable future MCP integration** - Prepare for external tool support

## Current Tool Structure

```typescript
// Current pattern - verbose and error-prone
export class FileReadTool extends BaseTool {
  async executeTool(call: ToolCall, context?: ToolContext): Promise<ToolResult> {
    // 20+ lines of manual validation
    const path = this.validateNonEmptyStringParam(call.arguments.path, 'path', call.id);
    const startLine = this.validateOptionalParam(
      call.arguments.startLine,
      'startLine', 
      (value) => this.validateNumberParam(value, 'startLine', call.id, { min: 1, integer: true }),
      call.id
    );
    // ... more validation
    
    // Finally, business logic
    const content = await readFile(path, 'utf-8');
    // ...
  }
}
```

## Target Tool Structure

```typescript
// Target pattern - clean and focused
export class FileReadTool extends BaseTool {
  name = 'file_read';
  description = 'Read file contents with optional line range';
  
  schema = z.object({
    path: z.string().min(1, "File path cannot be empty"),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
  });

  async execute(args, context) {
    const { path, startLine, endLine } = args; // Fully typed!
    
    // Pure business logic
    const content = await readFile(path, 'utf-8');
    // ...
  }
}
```

## Implementation Plan

### Phase 1: Foundation (Days 1-2)

#### Task 1.1: Add Dependencies
```bash
npm install zod zod-to-json-schema
```

#### Task 1.2: Extend BaseTool with Schema Support
**File**: `src/tools/base-tool.ts` (modify existing)

Add schema-based validation capabilities to the existing `BaseTool` class:

```typescript
// Add to existing imports
import { z, ZodType, ZodError } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Add to existing BaseTool class
export abstract class BaseTool implements Tool {
  abstract name: string;
  abstract description: string;
  abstract annotations?: Record<string, unknown>;

  // New: Optional schema for automatic validation
  schema?: ZodType;

  // Auto-generate inputSchema from Zod schema if provided
  get inputSchema(): ToolInputSchema {
    if (this.schema) {
      return zodToJsonSchema(this.schema, {
        name: this.name,
        $refStrategy: 'none'
      });
    }
    // Fallback for tools not yet migrated
    throw new Error(`Tool ${this.name} must define either schema or inputSchema`);
  }

  async executeTool(call: ToolCall, context?: ToolContext): Promise<ToolResult> {
    if (this.schema) {
      // Schema-based validation path
      if (!this.execute) {
        throw new Error(`Tool ${this.name} with schema must implement execute() method`);
      }
      
      try {
        const validatedArgs = this.schema.parse(call.arguments);
        return await this.execute(validatedArgs, context);
      } catch (error) {
        if (error instanceof ZodError) {
          return this.createSchemaValidationError(error, call.id);
        }
        throw error;
      }
    } else {
      // Legacy path - will be removed as tools migrate
      throw new Error(`Tool ${this.name} must implement schema-based validation`);
    }
  }

  // New: Implement business logic with typed arguments (when using schema)
  execute?(args: any, context?: ToolContext): Promise<ToolResult>;

  // New: Schema validation error formatting
  private createSchemaValidationError(error: ZodError, callId?: string): ToolResult {
    const issues = error.issues.map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    }).join('; ');
    
    const message = `Parameter validation failed: ${issues}. Check parameter types and values, then try again.`;
    return createErrorResult(message, callId);
  }

  // ... keep all existing helper methods for transition period
}
```

#### Task 1.3: Start with Basic Schemas
**Note**: Create common patterns **only as needed** during migration. Don't build a schema library upfront.

#### Task 1.4: Write Tests for Schema Integration
**File**: `src/tools/base-tool.test.ts` (add to existing tests)

```typescript
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import { createSuccessResult, ToolCall, ToolResult, ToolContext } from './types.js';

class TestSchemaTool extends BaseTool {
  name = 'test_schema_tool';
  description = 'Test tool for schema validation';
  schema = z.object({
    required: z.string().min(1, "Required field cannot be empty"),
    optional: z.number().optional(),
  });
  
  async execute(args: z.infer<typeof this.schema>, context?: ToolContext): Promise<ToolResult> {
    return createSuccessResult([{ type: 'text', text: `Got: ${args.required}` }]);
  }
}

describe('BaseTool Schema Integration', () => {
  it('validates parameters successfully with schema', async () => {
    const tool = new TestSchemaTool();
    const result = await tool.executeTool({
      id: 'test',
      arguments: { required: 'hello' }
    } as ToolCall);
    
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('Got: hello');
  });

  it('returns detailed validation errors for invalid parameters', async () => {
    const tool = new TestSchemaTool();
    const result = await tool.executeTool({
      id: 'test', 
      arguments: { optional: 123 } // missing required
    } as ToolCall);
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('required: Required');
    expect(result.content[0].text).toContain('Parameter validation failed');
  });

  it('generates JSON schema from Zod schema', () => {
    const tool = new TestSchemaTool();
    const jsonSchema = tool.inputSchema;
    
    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.properties.required).toBeDefined();
    expect(jsonSchema.properties.optional).toBeDefined();
    expect(jsonSchema.required).toContain('required');
  });
});
```

### Phase 2: Proof of Concept Migration (Days 3-4)

#### Task 2.1: Migrate file-read Tool
**File**: `src/tools/implementations/file-read.ts` (replace existing)

**TDD Process**:
1. Write failing test for new schema-based implementation
2. Implement new SchemaTool-based version to make test pass
3. Run full test suite to verify no regressions
4. **Commit immediately** - no keeping old code around
5. **Delete old implementation** completely

```typescript
// ABOUTME: File reading tool with optional line range support
// ABOUTME: Safe file access for code inspection and analysis

import { z } from 'zod';
import { readFile } from 'fs/promises';
import { BaseTool } from '../base-tool.js';
import { createSuccessResult, ToolContext, ToolResult } from '../types.js';

const fileReadSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
});

export class FileReadTool extends BaseTool {
  name = 'file_read';
  description = 'Read file contents with optional line range';
  schema = fileReadSchema;
  annotations = {
    readOnlyHint: true,
    idempotentHint: true,
  };

  async execute(args: z.infer<typeof fileReadSchema>, context?: ToolContext): Promise<ToolResult> {
    const { path, startLine, endLine } = args;

    const content = await readFile(path, 'utf-8');
    const lines = content.split('\n');

    let resultLines = lines;
    if (startLine || endLine) {
      const start = Math.max(0, (startLine ?? 1) - 1);
      const end = endLine ? Math.min(lines.length, endLine) : lines.length;
      resultLines = lines.slice(start, end);
    }

    return createSuccessResult([{
      type: 'text',
      text: resultLines.join('\n'),
    }]);
  }
}
```

#### Task 2.2: Update Tool Registration
**File**: `src/tools/registry.ts` (verify new tool works)

Ensure the new FileReadTool can be registered and used exactly like the old one.

#### Task 2.3: Validate Foundation and Migration
```bash
npm run test -- base-tool       # Schema integration tests
npm run test -- file-read       # Migrated tool tests
npm run test:integration         # End-to-end verification
```

**Critical Validation Points**:
- Schema validation produces **detailed, helpful error messages**
- JSON Schema generation works for AI providers (test with actual provider call)
- Type safety works (TypeScript compilation succeeds)
- All existing file-read functionality works
- No regressions in other tools

### Phase 3: Systematic Migration (Days 5-10)

**Strategy**: Migrate one tool per day, following TDD process for each.

#### Task 3.1: Migrate Simple Tools First
**Day 5**: `bash.ts`
```typescript
const bashSchema = z.object({
  command: NonEmptyString,
});
```

**Day 6**: `file-write.ts`
```typescript
const fileWriteSchema = z.object({
  path: FilePath,
  content: z.string(), // Allow empty content
});
```

#### Task 3.2: Migrate Medium Complexity Tools
**Day 7**: `file-edit.ts`
```typescript
const fileEditSchema = z.object({
  path: FilePath,
  old_text: z.string(),
  new_text: z.string(),
});
```

**Day 8**: `file-insert.ts`
```typescript
const fileInsertSchema = z.object({
  path: FilePath,
  content: z.string(),
  line: LineNumber.optional(),
});
```

#### Task 3.3: Migrate Complex Tools
**Day 9**: `file-find.ts`
```typescript
const fileFindSchema = z.object({
  pattern: SearchPattern,
  path: OptionalPath,
  type: z.enum(['file', 'directory', 'both']).default('both'),
  caseSensitive: CaseSensitive,
  maxDepth: SearchDepth,
  includeHidden: IncludeHidden,
  maxResults: MaxResults,
});
```

**Day 10**: `ripgrep-search.ts`
```typescript
const ripgrepSchema = z.object({
  pattern: SearchPattern,
  path: OptionalPath,
  caseSensitive: CaseSensitive,
  wholeWord: BooleanDefault(false),
  includePattern: z.string().optional(),
  excludePattern: z.string().optional(),
  maxResults: MaxResults,
  contextLines: z.number().int().min(0).max(10).default(0),
});
```

#### Task 3.4: Migrate Remaining Tools
**Day 11**: `file-list.ts`, `task-manager.ts`, `url-fetch.ts`, `delegate.ts`

### Phase 4: Cleanup and Testing (Days 11-12)

#### Task 4.1: Delete Legacy Code
- **Remove all legacy validation methods** from `BaseTool` after last tool migration
- **Delete unused** validation helper methods
- **Clean up all** legacy imports
- **No legacy code survives** - complete elimination of old patterns

#### Task 4.2: Comprehensive Testing
```bash
npm run test:run           # All unit tests
npm run test:integration   # Integration tests
npm run test:coverage      # Verify coverage
npm run lint              # Code quality
npm run build             # Verify build works
```


### Phase 5: Documentation (Day 13)

#### Task 5.1: Update CLAUDE.md
Add basic schema-based tool development pattern.

## Testing Strategy

### Unit Testing
- Each tool must have comprehensive unit tests
- Test both success and error cases  
- Verify schema validation works
- Test edge cases and boundary conditions

### Integration Testing
- Verify tools work end-to-end in conversation flows
- Test tool approval workflows
- Verify JSON Schema compatibility with AI providers

## Expected Outcomes

### Quantitative Improvements
- **90% reduction** in validation code per tool (40+ lines → 4 lines)
- **100% type safety** for tool parameters
- **Zero manual casting** - all parameters automatically typed
- **Consistent error messages** across all tools

### Qualitative Improvements
- **Cleaner code** - tools focus on business logic only
- **Easier development** - new tools require minimal boilerplate
- **Better debugging** - validation errors are specific and actionable
- **Future-ready** - prepared for external tool integration

### Before/After Comparison

**Before (file-find.ts: 145 lines)**:
- 68 lines of validation (47%)
- 77 lines of business logic (53%)
- Manual type casting
- Verbose error handling

**After (file-find.ts: ~80 lines)**:
- 8 lines of schema definition (10%)
- 72 lines of business logic (90%)
- Automatic type inference
- Consistent error handling

## Risk Mitigation

### Backward Compatibility
- All existing tool calls continue working
- JSON Schema format maintained for AI providers
- One-way migration with immediate legacy code removal

### Testing Coverage
- Comprehensive test suite before any changes
- Tool-by-tool migration with validation
- Integration testing at each step

### Rollback Plan
- **Frequent commits** - commit after each successful tool migration
- **Git history** is the rollback mechanism
- **No parallel code** - legacy implementations deleted immediately after migration
- **Clean codebase** - old patterns eliminated completely

## Success Criteria

1. **All tests passing** after migration
2. **No regression** in tool functionality
3. **Improved error messages** validated by manual testing
4. **Type safety** confirmed by TypeScript compilation
5. **Performance maintained** or improved
6. **Developer experience** improved (measured by lines of code reduction)

This refactoring transforms our tool system from verbose, error-prone manual validation to clean, type-safe, schema-driven development while maintaining full backward compatibility.