# Tool System Refactoring: Implementation Status

## ✅ COMPLETED: Foundation + 9 Tools Migrated + Architecture Cleanup

**STATUS**: Foundation established with output helpers. FileRead, Bash, UrlFetch, FileWrite, FileInsert, FileFind, FileList, RipgrepSearch, FileEdit, TaskManager, and Delegate tools successfully migrated to schema validation. Old Tool interface completely replaced with new schema-based Tool class. Executor and Agent updated to use only new Tool class. All 12 tools migrated successfully.

## Overview

Refactoring the tool system in Lace, an AI coding assistant. Tools are how the AI interacts with the filesystem and system (reading files, running commands, etc). We've successfully moved from 40+ lines of manual validation per tool to Zod schemas, eliminating boilerplate while preparing for future MCP (Model Context Protocol) integration.

## Key Principles

1. **TDD**: Write tests first, watch them fail, implement minimal code to pass
2. **YAGNI**: Don't build anything we don't need right now
3. **DRY**: Extract common patterns, but only after seeing them 2-3 times
4. **Frequent Commits**: Commit after each passing test or completed subtask
5. **Clean Names**: Names describe what code does, not how/when/why it was built

## Background Context

### What is Lace?
- AI coding assistant built with TypeScript/Node.js
- Uses "tools" to let AI interact with the system (read/write files, run bash, search code)
- Event-sourced architecture - all interactions stored as immutable events
- Built with React/Ink for terminal UI

### What is MCP?
- Model Context Protocol - standard for AI tools
- Allows external servers to provide tools to AI systems
- Uses JSON Schema for tool definitions
- We want our tools to be compatible with this standard

### ✅ NEW Architecture (Implemented)

```
src/tools/
├── base-tool.ts          # Old base class (will be removed during migration)
├── tool.ts               # ✅ NEW: Schema-based Tool base class
├── types.ts              # Tool interfaces and types
├── executor.ts           # ✅ UPDATED: Executes both old and new tools
├── schemas/              # ✅ NEW: Common schema patterns
│   ├── common.ts         # Reusable Zod schemas
│   └── common.test.ts    # Schema validation tests
├── utils/                # ✅ NEW: Tool utilities
│   ├── file-suggestions.ts    # Misspelling detection for file paths
│   └── file-suggestions.test.ts
├── __tests__/            # Enhanced test utilities
│   ├── temp-utils.ts     # ✅ NEW: Project-wide temp directory helpers
│   └── test-utils.ts     # Updated test helpers
└── implementations/      # Individual tool implementations
    ├── file-read.ts      # ✅ MIGRATED: Schema-based implementation with output helpers
    ├── bash.ts           # ✅ MIGRATED: Schema-based implementation with structured output
    ├── url-fetch.ts      # ✅ MIGRATED: Schema-based implementation with enhanced validation
    ├── file-write.ts     # ✅ MIGRATED: Schema-based implementation with enhanced error handling
    ├── file-insert.ts    # ✅ MIGRATED: Schema-based implementation with line validation
    ├── file-find.ts      # ✅ MIGRATED: Schema-based implementation with glob patterns and type filtering
    ├── file-list.ts      # ✅ MIGRATED: Schema-based implementation with tree formatting and summarization
    ├── ripgrep-search.ts # ✅ MIGRATED: Schema-based implementation with complex parameter validation
    ├── file-edit.ts      # ✅ MIGRATED: Schema-based implementation with multi-field validation and exact text matching
    └── ... (2 remaining tools to migrate)
```

### ✅ Problems SOLVED
1. ✅ **70%+ Code Reduction**: Schema validation eliminates manual parameter checking
2. ✅ **Full Type Safety**: No more `as { param: type }` - everything properly typed
3. ✅ **Clean Separation**: Validation handled by schemas, business logic is pure
4. ✅ **Consistent Error Messages**: AI-optimized messages that prevent repeated failures
5. ✅ **Advanced Features**: Misspelling detection, cross-field validation, file suggestions
6. ✅ **Consistent Output Helpers**: `createResult()`/`createError()` eliminate manual JSON construction
7. ✅ **Structured Data Support**: Tools seamlessly handle both text and JSON output patterns
8. ✅ **Clean Architecture**: Old Tool interface completely removed, single schema-based Tool class
9. ✅ **Simplified Executor**: No compatibility layer needed, direct schema-based execution

## Development Setup

### Prerequisites
```bash
# Clone and install
git clone <repo>
cd lace
npm install

# Verify tests pass
npm test

# Verify build works
npm run build
```

### Key Commands
```bash
npm test            # Run tests in watch mode
npm run test:unit   # Unit tests only
npm run test:run    # Run tests once
npm run lint        # Check linting
npm run build       # TypeScript build
```

### Important Files to Read First
1. `src/tools/base-tool.ts` - Current base class
2. `src/tools/types.ts` - Tool interfaces
3. `src/tools/implementations/file-read.ts` - Example tool
4. `src/agents/agent.ts` - How tools are called
5. `CLAUDE.md` - Project coding standards

## Implementation Plan

### Phase 1: Foundation (Day 1)

#### Task 1.1: Install Dependencies
```bash
git checkout -b refactor/tool-system
npm install zod zod-to-json-schema
npm install --save-dev @types/node
git add package.json package-lock.json
git commit -m "add zod dependencies for tool validation"
```

#### Task 1.2: Create Tool Schema Tests
**File**: `src/tools/tool.test.ts` (NEW)

Write tests FIRST for the new Tool base class:

```typescript
// ABOUTME: Tests for schema-based tool validation system
// ABOUTME: Ensures tools validate inputs and handle errors correctly

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Tool } from './tool.js';
import { ToolContext } from './types.js';

// Test implementation of new Tool class
class TestTool extends Tool {
  name = 'test_tool';
  description = 'Test tool for validation';
  schema = z.object({
    required: z.string().min(1),
    optional: z.number().optional(),
  });
  
  async executeValidated(
    args: z.infer<typeof this.schema>, 
    context?: ToolContext
  ) {
    return {
      content: [{ type: 'text', text: `Got: ${args.required}` }],
      isError: false,
    };
  }
}

describe('Tool with schema validation', () => {
  it('validates and executes with valid parameters', async () => {
    const tool = new TestTool();
    const result = await tool.execute(
      { required: 'hello' },
      undefined
    );
    
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('Got: hello');
  });

  it('returns validation errors for invalid parameters', async () => {
    const tool = new TestTool();
    const result = await tool.execute(
      { optional: 123 }, // missing required field
      undefined
    );
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Validation failed');
    expect(result.content[0].text).toContain('required');
  });

  it('generates JSON schema from Zod schema', () => {
    const tool = new TestTool();
    const jsonSchema = tool.inputSchema;
    
    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.properties.required).toBeDefined();
    expect(jsonSchema.required).toContain('required');
  });
});
```

Run tests - they should fail:
```bash
npm test tool.test.ts
```

Commit the failing tests:
```bash
git add src/tools/tool.test.ts
git commit -m "add tests for schema-based tool validation"
```

#### Task 1.3: Implement New Tool Base Class
**File**: `src/tools/tool.ts` (NEW)

Now implement to make tests pass:

```typescript
// ABOUTME: Base class for all tools with schema-based validation
// ABOUTME: Provides automatic parameter validation and JSON schema generation

import { z, ZodType, ZodError } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { 
  ToolResult, 
  ToolContext, 
  ToolInputSchema 
} from './types.js';

export abstract class Tool {
  abstract name: string;
  abstract description: string;
  abstract schema: ZodType;
  
  // Generate JSON Schema for AI providers
  get inputSchema(): ToolInputSchema {
    return zodToJsonSchema(this.schema, {
      name: this.name,
      $refStrategy: 'none',
    }) as ToolInputSchema;
  }
  
  // Public execute method that handles validation
  async execute(
    args: unknown, 
    context?: ToolContext
  ): Promise<ToolResult> {
    try {
      const validated = this.schema.parse(args);
      return await this.executeValidated(validated, context);
    } catch (error) {
      if (error instanceof ZodError) {
        return this.formatValidationError(error);
      }
      throw error;
    }
  }
  
  // Implement this in subclasses with validated args
  protected abstract executeValidated(
    args: any,
    context?: ToolContext
  ): Promise<ToolResult>;
  
  // Output helpers for consistent result construction
  
  // Public API for creating results
  protected createResult(
    content: string | object,
    metadata?: Record<string, any>
  ): ToolResult {
    return this._makeResult({ content, metadata, isError: false });
  }
  
  protected createError(
    content: string | object,
    metadata?: Record<string, any>
  ): ToolResult {
    return this._makeResult({ content, metadata, isError: true });
  }
  
  // Private implementation
  private _makeResult(options: {
    content: string | object;
    metadata?: Record<string, any>;
    isError: boolean;
  }): ToolResult {
    const text = typeof options.content === 'string' 
      ? options.content 
      : JSON.stringify(options.content, null, 2);
    
    return {
      content: [{ type: 'text', text }],
      isError: options.isError,
      ...(options.metadata && { metadata: options.metadata }),
    };
  }
  
  private formatValidationError(error: ZodError): ToolResult {
    const issues = error.issues
      .map(issue => {
        const path = issue.path.length > 0 
          ? issue.path.join('.') 
          : 'root';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    
    return {
      content: [{
        type: 'text',
        text: `Validation failed: ${issues}. Check parameter types and values.`,
      }],
      isError: true,
    };
  }
}
```

Run tests - they should pass:
```bash
npm test tool.test.ts
```

Commit:
```bash
git add src/tools/tool.ts
git commit -m "implement schema-based Tool base class"
```

#### Task 1.4: Create Schema Utilities
**File**: `src/tools/schemas/common.test.ts` (NEW)

Test common schema patterns first:

```typescript
// ABOUTME: Tests for common tool schema patterns
// ABOUTME: Validates reusable schema components work correctly

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { NonEmptyString, FilePath, LineNumber } from './common.js';

describe('Common schema patterns', () => {
  describe('NonEmptyString', () => {
    it('accepts non-empty strings', () => {
      expect(NonEmptyString.parse('hello')).toBe('hello');
    });
    
    it('rejects empty strings', () => {
      expect(() => NonEmptyString.parse('')).toThrow();
    });
  });
  
  describe('FilePath', () => {
    it('normalizes relative paths to absolute', () => {
      const result = FilePath.parse('./test.txt');
      expect(result).toMatch(/^\/.*test\.txt$/);
    });
  });
  
  describe('LineNumber', () => {
    it('accepts positive integers', () => {
      expect(LineNumber.parse(1)).toBe(1);
      expect(LineNumber.parse(100)).toBe(100);
    });
    
    it('rejects zero and negative numbers', () => {
      expect(() => LineNumber.parse(0)).toThrow();
      expect(() => LineNumber.parse(-1)).toThrow();
    });
  });
});
```

Commit failing tests:
```bash
git add src/tools/schemas/common.test.ts
git commit -m "add tests for common schema patterns"
```

**File**: `src/tools/schemas/common.ts` (NEW)

Implement patterns:

```typescript
// ABOUTME: Common schema patterns for tool parameter validation
// ABOUTME: Reusable Zod schemas with consistent error messages

import { z } from 'zod';
import { resolve } from 'path';

export const NonEmptyString = z
  .string()
  .min(1, 'Cannot be empty');

export const FilePath = z
  .string()
  .min(1, 'File path cannot be empty')
  .transform(path => resolve(path));

export const LineNumber = z
  .number()
  .int('Must be an integer')
  .positive('Must be positive');

export const MaxResults = z
  .number()
  .int()
  .min(1)
  .max(1000)
  .default(100);

export const FilePattern = z
  .string()
  .min(1, 'Pattern cannot be empty');
```

Verify tests pass and commit:
```bash
npm test common.test.ts
git add src/tools/schemas/common.ts
git commit -m "implement common schema patterns"
```

### Phase 2: Complex Tool Migration (Day 2)

#### Task 2.1: Choose Complex Tool for Proof of Concept

We'll migrate `file-read` as it has:
- Path validation
- Optional parameters with constraints
- File size limits
- Error cases needing rich context

First, study the existing implementation:
```bash
cat src/tools/implementations/file-read.ts
cat src/tools/implementations/file-read.test.ts
```

#### Task 2.2: Write Tests for New FileRead Tool
**File**: `src/tools/implementations/file-read-new.test.ts` (NEW)

```typescript
// ABOUTME: Tests for schema-based file reading tool
// ABOUTME: Validates file operations with proper error handling

import { describe, it, expect, beforeEach } from 'vitest';
import { FileReadTool } from './file-read-new.js';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FileReadTool with schema validation', () => {
  const testDir = join(tmpdir(), 'lace-test-' + Date.now());
  const testFile = join(testDir, 'test.txt');
  
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(testFile, 'Line 1\nLine 2\nLine 3\n');
  });
  
  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });
  
  it('reads entire file', async () => {
    const tool = new FileReadTool();
    const result = await tool.execute({ path: testFile });
    
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('Line 1\nLine 2\nLine 3\n');
  });
  
  it('reads file with line range', async () => {
    const tool = new FileReadTool();
    const result = await tool.execute({
      path: testFile,
      startLine: 2,
      endLine: 2,
    });
    
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('Line 2');
  });
  
  it('validates line range constraints', async () => {
    const tool = new FileReadTool();
    const result = await tool.execute({
      path: testFile,
      startLine: 3,
      endLine: 1, // Invalid: end before start
    });
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('endLine must be >= startLine');
  });
  
  it('handles file not found with suggestions', async () => {
    const tool = new FileReadTool();
    const result = await tool.execute({
      path: join(testDir, 'missing.txt'),
    });
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('File not found');
    expect(result.content[0].text).toContain('Similar files');
  });
});
```

Commit failing tests:
```bash
git add src/tools/implementations/file-read-new.test.ts
git commit -m "add tests for schema-based file read tool"
```

#### Task 2.3: Implement New FileRead Tool
**File**: `src/tools/implementations/file-read-new.ts` (NEW)

```typescript
// ABOUTME: File reading tool with line range support
// ABOUTME: Reads text files with validation and helpful error messages

import { z } from 'zod';
import { readFile, stat } from 'fs/promises';
import { Tool } from '../tool.js';
import { FilePath, LineNumber } from '../schemas/common.js';
import type { ToolResult, ToolContext } from '../types.js';
import { findSimilarPaths } from '../utils/file-suggestions.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const fileReadSchema = z
  .object({
    path: FilePath,
    startLine: LineNumber.optional(),
    endLine: LineNumber.optional(),
  })
  .refine(
    data => {
      if (data.startLine && data.endLine) {
        return data.endLine >= data.startLine;
      }
      return true;
    },
    {
      message: 'endLine must be >= startLine',
      path: ['endLine'],
    }
  );

export class FileReadTool extends Tool {
  name = 'file_read';
  description = 'Read contents of a file with optional line range';
  schema = fileReadSchema;
  
  protected async executeValidated(
    args: z.infer<typeof fileReadSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    try {
      // Check file size
      const stats = await stat(args.path);
      if (stats.size > MAX_FILE_SIZE) {
        return this.createError(
          `File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE} bytes). Use startLine/endLine to read portions.`
        );
      }
      
      // Read file
      const content = await readFile(args.path, 'utf-8');
      const lines = content.split('\n');
      
      // Apply line range if specified
      let result = content;
      if (args.startLine || args.endLine) {
        const start = (args.startLine || 1) - 1;
        const end = args.endLine || lines.length;
        result = lines.slice(start, end).join('\n');
      }
      
      return this.createResult(result, {
        totalLines: lines.length,
        linesReturned: result.split('\n').length,
        fileSize: stats.size,
      });
    } catch (error: any) {
      // File not found - provide suggestions
      if (error.code === 'ENOENT') {
        const suggestions = await findSimilarPaths(args.path);
        const suggestionText = suggestions.length > 0
          ? `\nSimilar files: ${suggestions.join(', ')}`
          : '';
          
        return this.createError(
          `File not found: ${args.path}${suggestionText}`
        );
      }
      
      throw error;
    }
  }
}
```

#### Task 2.4: Implement File Suggestions Utility
**File**: `src/tools/utils/file-suggestions.ts` (NEW)

```typescript
// ABOUTME: Utility to find similar file paths for helpful error messages
// ABOUTME: Uses fuzzy matching to suggest alternatives when files not found

import { glob } from 'glob';
import { dirname, basename } from 'path';

export async function findSimilarPaths(
  targetPath: string,
  maxSuggestions = 5
): Promise<string[]> {
  const dir = dirname(targetPath);
  const name = basename(targetPath);
  
  try {
    // Find files in same directory
    const files = await glob('*', { 
      cwd: dir,
      nodir: true,
      dot: true,
    });
    
    // Simple similarity: shared prefix/suffix
    const scored = files
      .map(file => ({
        file,
        score: calculateSimilarity(name, file),
      }))
      .filter(item => item.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSuggestions)
      .map(item => `${dir}/${item.file}`);
    
    return scored;
  } catch {
    return [];
  }
}

function calculateSimilarity(a: string, b: string): number {
  // Simple similarity based on common characters
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = getEditDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function getEditDistance(a: string, b: string): number {
  // Simple Levenshtein distance
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}
```

Run tests and commit when passing:
```bash
npm test file-read-new.test.ts
git add src/tools/implementations/file-read-new.ts
git add src/tools/utils/file-suggestions.ts
git commit -m "implement schema-based file read tool"
```

#### Task 2.5: Update Tool Registration
**File**: `src/tools/implementations/index.ts` (MODIFY)

Temporarily export both versions:

```typescript
// ... existing exports ...
export { FileReadTool as FileReadToolNew } from './file-read-new.js';
```

Test that new tool can be registered:
```typescript
// In test file or manually:
import { ToolExecutor } from '../tool-executor.js';
import { FileReadToolNew } from './implementations/index.js';

const executor = new ToolExecutor();
executor.registerTool(new FileReadToolNew());
```

Commit:
```bash
git add src/tools/implementations/index.ts
git commit -m "export new file read tool for testing"
```

### Phase 3: Integration and Compatibility (Day 3)

#### Task 3.1: Update Tool Executor Compatibility
**File**: `src/tools/tool-executor.test.ts` (ADD TESTS)

Add test to verify new tools work with existing executor:

```typescript
it('executes new schema-based tools', async () => {
  const executor = new ToolExecutor();
  const tool = new FileReadToolNew();
  executor.registerTool(tool);
  
  const result = await executor.executeTool({
    id: 'test-1',
    name: 'file_read',
    arguments: { path: '/etc/hosts' },
  });
  
  expect(result.isError).toBe(false);
});
```

#### Task 3.2: Make Tool Executor Work with Both Tool Types
**File**: `src/tools/tool-executor.ts` (MODIFY)

The executor needs to work with both old tools (implementing `Tool` interface from types.ts) and new tools (extending `Tool` class):

```typescript
// Add type guard
function isNewTool(tool: any): tool is Tool {
  return tool.execute && tool.schema;
}

// In executeTool method:
if (isNewTool(tool)) {
  // New path
  return await tool.execute(call.arguments, context);
} else {
  // Existing path
  return await tool.executeTool(call, context);
}
```

#### Task 3.3: Verify End-to-End Integration
Run integration tests to ensure the new tool works in real conversations:

```bash
npm run test:integration -- --grep "file.*read"
```

### Phase 3.5: Output Consistency Pattern

#### Important: Structured Output Helpers

All tools MUST use the base class output helpers for consistency. This eliminates manual JSON.stringify() calls and ensures uniform result construction across all tools.

**Examples of proper usage:**

```typescript
// Bash tool - structured output
protected async executeValidated(args: z.infer<typeof bashSchema>) {
  const { stdout, stderr } = await execAsync(args.command);
  
  // Use createResult for structured data - it handles JSON.stringify
  return this.createResult({
    stdout: stdout || '',
    stderr: stderr || '',
    exitCode: 0,
  });
}

// File operations with metadata
protected async executeValidated(args: z.infer<typeof fileReadSchema>) {
  const content = await readFile(args.path);
  
  // Text content with metadata
  return this.createResult(content, {
    totalLines: lines.length,
    fileSize: stats.size,
  });
}

// Error with structured data
catch (error) {
  // Even errors can have structured data
  return this.createError({
    stdout: error.stdout || '',
    stderr: error.stderr || error.message,
    exitCode: error.code || 127,
  });
}
```

**DO NOT:**
- Manually call JSON.stringify() in tools
- Construct ToolResult objects directly
- Mix patterns within the same tool

**Benefits:**
- Consistent JSON formatting (2-space indent)
- Uniform error handling
- Easier to change output format globally
- Type-safe result construction

### Phase 4: Migration Pattern Established (Day 4)

Now that we have one tool migrated and working, establish the pattern for remaining tools.

#### Task 4.1: Document Migration Process
**File**: `docs/tool-migration-guide.md` (NEW)

```markdown
# Tool Migration Guide

## Steps to Migrate a Tool

1. **Analyze existing tool**
   - Identify all validation rules
   - Note error messages and edge cases
   - List all parameters and their constraints

2. **Write comprehensive tests**
   - Copy existing tests to new file
   - Add tests for validation errors
   - Test edge cases explicitly

3. **Define Zod schema**
   - Use common patterns from schemas/common.ts
   - Add refinements for cross-field validation
   - Include helpful error messages

4. **Implement executeValidated**
   - Copy business logic from old tool
   - Remove validation code
   - Enhance error messages

5. **Test and verify**
   - Run new tests
   - Run integration tests
   - Compare behavior side-by-side

6. **Switch and delete**
   - Update exports
   - Delete old implementation
   - No legacy code remains
```

#### Task 4.2: Create Migration Checklist Template
**File**: `docs/tool-migration-checklist.md` (NEW)

```markdown
# Tool Migration Checklist: [TOOL_NAME]

- [ ] Read existing implementation thoroughly
- [ ] Identify all parameters and validation rules
- [ ] Create new test file with comprehensive tests
- [ ] Define Zod schema with all validations
- [ ] Implement new tool extending Tool class
- [ ] Run unit tests - all passing
- [ ] Run integration tests - no regressions
- [ ] Update exports in index.ts
- [ ] Delete old implementation
- [ ] Commit with message: "migrate [tool] to schema validation"
```

### Phase 5: Systematic Migration (Days 5-10)

For each remaining tool, follow the pattern:

#### Day 5: Migrate Simple Tools
- ✅ **bash.ts**: ✅ COMPLETED - Single string parameter (NonEmptyString schema, structured JSON output)
- ✅ **url-fetch.ts**: ✅ COMPLETED - Complex URL validation with protocol checks and structured output

#### Day 6: Migrate File Write Tools  
- ✅ **file-write.ts**: ✅ COMPLETED - Schema-based validation with enhanced error handling and structured output
- ✅ **file-insert.ts**: ✅ COMPLETED - Line number validation with line range checking and structured output

#### Day 7: Migrate Search Tools
- ✅ **file-find.ts**: ✅ COMPLETED - Complex glob pattern matching with type filtering and depth control
- ✅ **file-list.ts**: ✅ COMPLETED - Directory tree formatting with summarization and pattern filtering

#### Day 8: Migrate Complex Search
- ✅ **ripgrep-search.ts**: ✅ COMPLETED - Most complex parameter set with pattern, path, search options, and context lines

#### Day 9: Migrate Edit Tools
- ✅ **file-edit.ts**: ✅ COMPLETED - Multi-field validation with exact text matching and enhanced error handling

#### Day 10: Migrate Remaining Tools
- ✅ **task-manager.ts**: ✅ COMPLETED - Task operations with complex JSON array parsing and thread isolation
- ✅ **delegate.ts**: ✅ COMPLETED - Complex delegation logic with model format validation and subagent management

### Phase 6: Cleanup (Day 11)

#### Task 6.1: Remove Old Base Tool Code
Once all tools migrated:

1. Delete validation methods from BaseTool
2. Remove old Tool interface 
3. Update all imports
4. Ensure everything still builds

#### Task 6.2: Final Testing
```bash
npm run test:run
npm run test:integration  
npm run test:coverage
npm run lint
npm run build
```

### Phase 7: Documentation (Day 12)

#### Task 7.1: Update CLAUDE.md
Add section on tool development:

```markdown
## Tool Development

Tools extend the `Tool` base class and define a Zod schema:

```typescript
class MyTool extends Tool {
  name = 'my_tool';
  description = 'What this tool does';
  schema = z.object({
    param: z.string().min(1),
  });
  
  async executeValidated(args: z.infer<typeof this.schema>) {
    // Implementation
  }
}
```
```

#### Task 7.2: Update README
Document how to add new tools with the new system.

## Testing Strategy

### Unit Tests
- Each tool has comprehensive unit tests
- Test success cases, validation errors, edge cases
- Use temporary directories for file operations
- Mock external dependencies (network, etc)

### Integration Tests
- Test tools within conversation flow
- Verify AI can call tools correctly
- Test approval workflows still work
- Ensure error messages help AI recover

### Manual Testing
After each migration:
1. Start interactive mode: `npm start`
2. Ask AI to use the tool
3. Verify error messages are helpful
4. Test edge cases manually

## Common Pitfalls

1. **Don't simplify validation**: Keep all existing rules
2. **Preserve error quality**: Every error should guide the AI
3. **Test file operations**: Use temp directories, not mocks
4. **Handle async validation**: Some checks need file system access
5. **Maintain compatibility**: Tool executor must work with both types during migration

## Success Criteria

1. All tests passing (unit + integration)
2. 70%+ reduction in validation code
3. No type assertions in tool implementations
4. Error messages include actionable context
5. Tools work identically to before (no behavior changes)
6. Clean git history with atomic commits

## Git Workflow

```bash
# Start feature branch
git checkout -b refactor/tool-system

# For each subtask
git add [files]
git commit -m "clear, specific message"

# Push regularly
git push origin refactor/tool-system

# After migration complete
git checkout main
git merge refactor/tool-system
```

## Questions/Issues

If you get stuck:
1. Check existing tool implementations for patterns
2. Look at test files for expected behavior  
3. Run existing tool to see current error messages
4. Ask about specific issues rather than general problems

Remember: The goal is cleaner, more maintainable code that behaves identically to the current system while preparing for future MCP tool integration.