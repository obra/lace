# Tool System Architecture

This document explains how to implement tools in Lace's schema-based tool system.

## Overview

Tools are how the AI agent interacts with the system - reading files, running commands, searching code, etc. Lace uses a schema-based architecture with Zod validation for type safety, automatic parameter validation, and JSON schema generation.

## Quick Start

```typescript
// src/tools/implementations/my-tool.ts
import { z } from 'zod';
import { Tool } from '../tool.js';
import { NonEmptyString } from '../schemas/common.js';
import type { ToolResult, ToolContext } from '../types.js';

const myToolSchema = z.object({
  message: NonEmptyString.describe('The message to process'),
  count: z.number().int().min(1).max(100).default(1).describe('How many times to repeat'),
});

export class MyTool extends Tool {
  name = 'my_tool';
  description = 'Example tool that processes messages';
  schema = myToolSchema;

  protected async executeValidated(
    args: z.infer<typeof myToolSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    const result = args.message.repeat(args.count);
    return this.createResult(result);
  }
}
```

## Tool Base Class

All tools extend the abstract `Tool` class from `src/tools/tool.ts`:

### Required Properties

- **`name`**: Unique tool identifier (snake_case)
- **`description`**: Human-readable description for the AI
- **`schema`**: Zod schema defining parameters

### Required Methods

- **`executeValidated(args, context?)`**: Main implementation with validated arguments

### Provided Methods

- **`execute(args, context?)`**: Public interface with validation
- **`createResult(content, metadata?)`**: Helper for success responses
- **`createError(content, metadata?)`**: Helper for error responses
- **`inputSchema`**: Auto-generated JSON schema from Zod schema

## Schema Design

### Basic Schema Structure

```typescript
const toolSchema = z.object({
  required_param: NonEmptyString,
  optional_param: z.string().optional(),
  number_param: z.number().int().min(1).max(100),
  enum_param: z.enum(['option1', 'option2']).default('option1'),
});
```

### Common Schema Patterns

Import reusable patterns from `src/tools/schemas/common.ts`:

```typescript
import { 
  NonEmptyString,  // z.string().min(1, 'Cannot be empty')
  FilePath,        // Auto-resolves to absolute path
  LineNumber,      // Positive integer validation
  MaxResults,      // Integer 1-1000 with default 100
  FilePattern,     // Non-empty string for glob patterns
} from '../schemas/common.js';
```

### Advanced Validation

#### Cross-field Validation
```typescript
const rangeSchema = z
  .object({
    startLine: LineNumber,
    endLine: LineNumber,
  })
  .refine(
    data => data.endLine >= data.startLine,
    {
      message: 'endLine must be >= startLine',
      path: ['endLine'],
    }
  );
```

#### Conditional Fields
```typescript
const searchSchema = z.object({
  pattern: NonEmptyString,
  useRegex: z.boolean().default(false),
  caseSensitive: z.boolean().default(false),
}).refine(
  data => {
    if (data.useRegex) {
      try {
        new RegExp(data.pattern);
        return true;
      } catch {
        return false;
      }
    }
    return true;
  },
  {
    message: 'Invalid regex pattern',
    path: ['pattern'],
  }
);
```

#### Transform and Normalize
```typescript
const fileSchema = z.object({
  path: z.string().transform(path => resolve(path)), // Auto-resolve
  content: z.string().transform(s => s.trim()),      // Auto-trim
});
```

### Schema Documentation

Use `.describe()` for parameter documentation that appears in AI tool descriptions:

```typescript
const schema = z.object({
  query: NonEmptyString.describe('Search pattern or regular expression'),
  path: FilePath.describe('Directory to search (defaults to current directory)'),
  maxResults: MaxResults.describe('Maximum number of results to return'),
});
```

## Implementation Patterns

### File Operations

```typescript
// File reading with error handling
protected async executeValidated(args: z.infer<typeof schema>): Promise<ToolResult> {
  try {
    const content = await readFile(args.path, 'utf-8');
    return this.createResult(content, {
      fileSize: content.length,
      encoding: 'utf-8',
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return this.createError(
        `File not found: ${args.path}. Check the path and try again.`
      );
    }
    throw error; // Re-throw unexpected errors
  }
}
```

### System Commands

```typescript
// Command execution with structured output
protected async executeValidated(args: z.infer<typeof schema>): Promise<ToolResult> {
  try {
    const { stdout, stderr } = await execAsync(args.command, {
      cwd: args.workingDirectory,
      timeout: 30000,
    });
    
    return this.createResult({
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: 0,
    });
  } catch (error: any) {
    return this.createError({
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      exitCode: error.code || 1,
    });
  }
}
```

### Search Operations

```typescript
// Search with result limiting and formatting
protected async executeValidated(args: z.infer<typeof schema>): Promise<ToolResult> {
  const results = await performSearch(args.pattern, args.path);
  
  if (results.length === 0) {
    return this.createResult('No matches found');
  }
  
  if (results.length > args.maxResults) {
    const truncated = results.slice(0, args.maxResults);
    const formatted = formatResults(truncated);
    return this.createResult(
      `${formatted}\n\nResults limited to ${args.maxResults}. ${results.length - args.maxResults} additional matches found.`
    );
  }
  
  return this.createResult(formatResults(results));
}
```

## Output Helpers

### `createResult(content, metadata?)`

For successful operations:

```typescript
// Simple text response
return this.createResult('Operation completed successfully');

// Structured data (auto-converted to JSON)
return this.createResult({
  files: ['file1.txt', 'file2.txt'],
  totalSize: 1024,
});

// With metadata
return this.createResult('File content...', {
  fileSize: 1024,
  lastModified: new Date().toISOString(),
});
```

### `createError(content, metadata?)`

For error responses:

```typescript
// Simple error message
return this.createError('File not found: /path/to/file');

// Structured error data
return this.createError({
  error: 'Validation failed',
  details: ['Field x is required', 'Field y must be positive'],
});

// Error with recovery context
return this.createError(
  'Command failed',
  { suggestion: 'Try running with --help for usage information' }
);
```

## Tool Annotations

Add hints for the tool execution system:

```typescript
export class ReadOnlyTool extends Tool {
  // Mark as read-only for approval system
  get annotations(): ToolAnnotations {
    return {
      readOnlyHint: true,
      idempotentHint: true,
    };
  }
}

export class WriteOnceTool extends Tool {
  // Mark as non-idempotent
  get annotations(): ToolAnnotations {
    return {
      idempotentHint: false,
    };
  }
}
```

## Testing Tools

### Test Structure

```typescript
// src/tools/__tests__/my-tool.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MyTool } from '../implementations/my-tool.js';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('MyTool with schema validation', () => {
  let tool: MyTool;
  let testDir: string;

  beforeEach(async () => {
    tool = new MyTool();
    testDir = join(tmpdir(), 'lace-test-' + Date.now());
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('my_tool');
      expect(tool.description).toContain('processes messages');
    });

    it('should have proper input schema', () => {
      const schema = tool.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties.message).toBeDefined();
      expect(schema.required).toContain('message');
    });
  });

  describe('Input validation', () => {
    it('should reject invalid parameters', async () => {
      const result = await tool.execute({ message: '' }); // Empty string
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should accept valid parameters', async () => {
      const result = await tool.execute({ message: 'hello', count: 3 });
      
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('hellohellohello');
    });
  });

  describe('Functionality', () => {
    it('should process messages correctly', async () => {
      const result = await tool.execute({ message: 'test' });
      
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('test');
    });
  });
});
```

### Testing Best Practices

1. **Test tool metadata**: Verify name, description, schema structure
2. **Test validation**: Both success and failure cases
3. **Test business logic**: Core functionality with various inputs
4. **Use temp directories**: For file operations, create isolated test environments
5. **Test error cases**: Ensure error messages are helpful for AI recovery
6. **Test edge cases**: Boundary conditions, empty inputs, large inputs

## Error Handling

### Validation Errors

Handled automatically by the base class. Provide clear field-level error messages in schemas:

```typescript
const schema = z.object({
  count: z.number()
    .int('Must be an integer')
    .min(1, 'Must be at least 1')
    .max(100, 'Cannot exceed 100'),
});
```

### Runtime Errors

Handle expected errors gracefully, re-throw unexpected ones:

```typescript
protected async executeValidated(args: z.infer<typeof schema>): Promise<ToolResult> {
  try {
    // Main logic
    return this.createResult(result);
  } catch (error: any) {
    // Handle specific expected errors
    if (error.code === 'ENOENT') {
      return this.createError(`File not found: ${args.path}`);
    }
    if (error.code === 'EACCES') {
      return this.createError(`Permission denied: ${args.path}`);
    }
    
    // Re-throw unexpected errors for debugging
    throw error;
  }
}
```

### Error Message Guidelines

1. **Be specific**: "File not found: /path/to/file" not "Error reading file"
2. **Provide context**: Include the operation that failed
3. **Suggest solutions**: "Try using an absolute path" or "Check file permissions"
4. **Include relevant details**: File paths, command outputs, validation failures

## Registration and Export

### Export from implementations/index.ts

```typescript
// src/tools/implementations/index.ts
export { MyTool } from './my-tool.js';
export { AnotherTool } from './another-tool.js';
// ... other tools
```

### Register with ToolExecutor

Tools are automatically registered in the main application. For testing or custom setups:

```typescript
import { ToolExecutor } from './tools/executor.js';
import { MyTool } from './tools/implementations/my-tool.js';

const executor = new ToolExecutor();
executor.registerTool(new MyTool());
```

## Migration from Legacy Tools

If updating an existing tool from the old interface-based system:

1. **Analyze the old implementation**: Identify all validation rules and parameters
2. **Create comprehensive tests**: Copy existing tests and add validation test cases
3. **Define Zod schema**: Replace manual validation with schema definition
4. **Implement executeValidated**: Copy business logic, remove validation code
5. **Test thoroughly**: Ensure identical behavior to the old implementation
6. **Update exports**: Replace old tool with new implementation

## Common Patterns

### File Path Suggestions

For tools that work with file paths, provide helpful suggestions when files aren't found:

```typescript
import { findSimilarPaths } from '../utils/file-suggestions.js';

// In error handling
if (error.code === 'ENOENT') {
  const suggestions = await findSimilarPaths(args.path);
  const suggestionText = suggestions.length > 0
    ? `\nSimilar files: ${suggestions.join(', ')}`
    : '';
  return this.createError(`File not found: ${args.path}${suggestionText}`);
}
```

### Result Limiting

For tools that can return large result sets:

```typescript
if (results.length > args.maxResults) {
  const truncated = results.slice(0, args.maxResults);
  return this.createResult(
    formatResults(truncated) + 
    `\nResults limited to ${args.maxResults}. ${results.length - args.maxResults} additional matches found.`
  );
}
```

### Progress Indication

For long-running operations, provide progress updates through context:

```typescript
protected async executeValidated(
  args: z.infer<typeof schema>,
  context?: ToolContext
): Promise<ToolResult> {
  const files = await findFiles(args.pattern);
  
  for (let i = 0; i < files.length; i++) {
    // Emit progress if context supports it
    context?.onProgress?.(`Processing ${i + 1}/${files.length}: ${files[i]}`);
    await processFile(files[i]);
  }
  
  return this.createResult(`Processed ${files.length} files`);
}
```

## Best Practices

1. **Single Responsibility**: Each tool should do one thing well
2. **Consistent Naming**: Use snake_case for tool names, match functionality
3. **Rich Error Messages**: Help the AI understand what went wrong and how to fix it
4. **Type Safety**: Leverage Zod's type inference, avoid `any` types
5. **Test Coverage**: Every validation rule and error path should have tests
6. **Documentation**: Use schema descriptions to document parameters
7. **Performance**: Use result limiting and progress indication for expensive operations
8. **Security**: Validate and sanitize all inputs, especially file paths and commands

## Examples

See existing tools in `src/tools/implementations/` for real-world examples:

- **`file-read.ts`**: File operations with line ranges and size limits
- **`bash.ts`**: Command execution with structured output
- **`file-find.ts`**: Complex search with glob patterns and filtering
- **`ripgrep-search.ts`**: Advanced text search with many options
- **`delegate.ts`**: Complex tool with model validation and subagent creation

Each demonstrates different patterns and techniques for robust tool implementation.