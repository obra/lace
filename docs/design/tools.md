# Comprehensive Tool System Guide

This document is the definitive guide for implementing, maintaining, and extending tools in Lace's schema-based tool system. It covers everything from basic implementation to advanced UI rendering and maintenance strategies.

## Table of Contents

1. [Tool System Overview](#tool-system-overview)
2. [Quick Start Guide](#quick-start-guide)
3. [Tool Implementation](#tool-implementation)
4. [Schema Design & Validation](#schema-design--validation)
5. [Testing Tools](#testing-tools)
6. [Tool Renderers (UI)](#tool-renderers-ui)
7. [File Editing Tools Guide](#file-editing-tools-guide)
8. [Deployment & Integration](#deployment--integration)
9. [Best Practices & Patterns](#best-practices--patterns)
10. [Troubleshooting](#troubleshooting)

## Tool System Overview

Lace uses a schema-based tool architecture with Zod validation that provides:

- **70%+ code reduction** through automatic parameter validation
- **Full type safety** with schema inference  
- **Automatic JSON schema generation** for AI providers
- **Consistent error handling** with helpful recovery messages
- **Model-agnostic interface** supporting all AI providers
- **Custom UI renderers** for tool-specific interfaces

### Architecture

```
src/tools/
├── tool.ts                   # Abstract Tool base class
├── types.ts                  # Tool interfaces and types  
├── executor.ts               # Tool execution and registration
├── schemas/                  # Common schema patterns
│   ├── common.ts            # Reusable Zod schemas
│   └── common.test.ts       # Schema validation tests
├── utils/                   # Tool utilities
│   ├── file-suggestions.ts  # File path suggestions
│   └── file-suggestions.test.ts
├── __tests__/               # Test utilities
│   ├── temp-utils.ts        # Temp directory helpers
│   └── test-utils.ts        # Common test patterns
└── implementations/         # Individual tool implementations
    ├── file-read.ts         # File operations
    ├── bash.ts              # Command execution
    ├── delegate.ts          # Subagent delegation
    └── ...                  # Other tools
```

### Key Principles

1. **Schema-First**: All validation defined through Zod schemas
2. **Type Safety**: No `any` types, leverage TypeScript inference
3. **Helpful Errors**: Every error guides AI toward correct usage
4. **Consistent Output**: Use base class helpers for uniform results
5. **Test-Driven**: Comprehensive tests for all scenarios
6. **Single Responsibility**: Each tool does one thing well

## Quick Start Guide

### Basic Tool Implementation

```typescript
// src/tools/implementations/my-tool.ts
import { z } from 'zod';
import { Tool } from '../tool.js';
import { NonEmptyString } from '../schemas/common.js';
import type { ToolResult, ToolContext } from '../types.js';

const myToolSchema = z.object({
  message: NonEmptyString.describe('The message to process'),
  count: z.number().int().min(1).max(100).default(1).describe('Repetitions'),
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

### Registration and Export

```typescript
// src/tools/implementations/index.ts
export { MyTool } from './my-tool.js';

// Tools are automatically registered in main application
```

## Tool Implementation

### Tool Base Class

All tools extend the abstract `Tool` class from `src/tools/tool.ts`:

#### Required Properties

```typescript
export abstract class Tool {
  abstract name: string;        // Unique identifier (snake_case)
  abstract description: string; // Human-readable description for AI
  abstract schema: ZodType;     // Zod validation schema
}
```

#### Required Methods

```typescript
// Main implementation with validated arguments
protected abstract executeValidated(
  args: any,
  context?: ToolContext
): Promise<ToolResult>;
```

#### Provided Methods

```typescript
// Public interface with validation
async execute(args: unknown, context?: ToolContext): Promise<ToolResult>

// Output helpers for consistent results
protected createResult(content: string | object, metadata?: Record<string, any>): ToolResult
protected createError(content: string | object, metadata?: Record<string, any>): ToolResult

// Auto-generated JSON schema from Zod schema
get inputSchema(): ToolInputSchema
```

### Implementation Patterns

#### File Operations

```typescript
protected async executeValidated(args: z.infer<typeof schema>): Promise<ToolResult> {
  try {
    const content = await readFile(args.path, 'utf-8');
    const stats = await stat(args.path);
    
    return this.createResult(content, {
      fileSize: stats.size,
      encoding: 'utf-8',
      lastModified: stats.mtime.toISOString(),
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // Provide helpful suggestions
      const suggestions = await findSimilarPaths(args.path);
      const suggestionText = suggestions.length > 0
        ? `\nSimilar files: ${suggestions.join(', ')}`
        : '';
      return this.createError(`File not found: ${args.path}${suggestionText}`);
    }
    throw error; // Re-throw unexpected errors
  }
}
```

#### System Commands

```typescript
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
      command: args.command,
    });
  } catch (error: any) {
    return this.createError({
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      exitCode: error.code || 1,
      command: args.command,
    });
  }
}
```

#### Search Operations

```typescript
protected async executeValidated(args: z.infer<typeof schema>): Promise<ToolResult> {
  const results = await performSearch(args.pattern, args.path);
  
  if (results.length === 0) {
    return this.createResult('No matches found');
  }
  
  // Result limiting with clear feedback
  if (results.length > args.maxResults) {
    const truncated = results.slice(0, args.maxResults);
    const formatted = formatResults(truncated);
    return this.createResult(
      `${formatted}\n\nResults limited to ${args.maxResults}. ${results.length - args.maxResults} additional matches found.`
    );
  }
  
  return this.createResult(formatResults(results), {
    totalResults: results.length,
    searchPattern: args.pattern,
  });
}
```

### Tool Annotations

Add hints for the tool execution system:

```typescript
export class ReadOnlyTool extends Tool {
  get annotations(): ToolAnnotations {
    return {
      readOnlyHint: true,      // Safe for auto-approval
      idempotentHint: true,    // Same input = same output
    };
  }
}

export class DestructiveTool extends Tool {
  get annotations(): ToolAnnotations {
    return {
      destructiveHint: true,   // Requires user approval
      idempotentHint: false,   // May have side effects
    };
  }
}
```

## Schema Design & Validation

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

const toolSchema = z.object({
  path: FilePath,              // /absolute/path/to/file
  content: NonEmptyString,     // Rejects empty strings
  line: LineNumber,            // Positive integers only
  maxResults: MaxResults,      // 1-1000, defaults to 100
});
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

#### Conditional Validation

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
  lines: z.array(z.string()).transform(arr => 
    arr.filter(line => line.trim() !== '')           // Remove empty lines
  ),
});
```

### Schema Documentation

Use `.describe()` for parameter documentation that appears in AI tool descriptions:

```typescript
const schema = z.object({
  query: NonEmptyString.describe('Search pattern or regular expression'),
  path: FilePath.describe('Directory to search (defaults to current directory)'),
  maxResults: MaxResults.describe('Maximum number of results to return'),
  includeHidden: z.boolean().default(false).describe('Include hidden files in search'),
});
```

### Complex Schema Example

```typescript
// From delegate.ts - complex model validation
const ModelFormat = z.string().refine(
  (value) => {
    const parts = value.split(':');
    if (parts.length !== 2) return false;
    const [provider, model] = parts;
    return ['anthropic', 'lmstudio', 'ollama'].includes(provider) && model.length > 0;
  },
  {
    message: 'Model must be in format "provider:model" (e.g., "anthropic:claude-3-5-haiku-latest")',
  }
);

const delegateSchema = z.object({
  title: NonEmptyString.describe('Short active voice sentence describing the task'),
  prompt: NonEmptyString.describe('Complete instructions for the subagent'),
  expected_response: NonEmptyString.describe('Description of expected format/content'),
  model: ModelFormat.default('anthropic:claude-3-5-haiku-latest').describe('Provider and model'),
});
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
      expect(result.content[0].text).toContain('Cannot be empty');
    });

    it('should accept valid parameters', async () => {
      const result = await tool.execute({ message: 'hello', count: 3 });
      
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('hellohellohello');
    });

    it('should use default values', async () => {
      const result = await tool.execute({ message: 'test' });
      
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('test'); // count defaults to 1
    });
  });

  describe('Functionality', () => {
    it('should process messages correctly', async () => {
      const result = await tool.execute({ 
        message: 'hello', 
        count: 2 
      });
      
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('hellohello');
    });

    it('should handle edge cases', async () => {
      const result = await tool.execute({ 
        message: '🎉', 
        count: 3 
      });
      
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('🎉🎉🎉');
    });
  });

  describe('Error handling', () => {
    it('should handle boundary conditions', async () => {
      const result = await tool.execute({ 
        message: 'test', 
        count: 101 // Exceeds max
      });
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });
  });
});
```

### Testing Best Practices

1. **Test tool metadata**: Verify name, description, schema structure
2. **Test validation**: Both success and failure cases for all parameters
3. **Test business logic**: Core functionality with various inputs and edge cases
4. **Use temp directories**: For file operations, create isolated test environments
5. **Test error cases**: Ensure error messages are helpful for AI recovery
6. **Test defaults**: Verify optional parameters use correct defaults
7. **Test boundary conditions**: Min/max values, empty inputs, large inputs

### Test Categories

#### Unit Tests
- Individual tool behavior
- Schema validation
- Output formatting
- Error handling

#### Integration Tests
- Tool execution within conversation flow
- Tool approval workflows
- Cross-tool interactions
- Provider compatibility

#### Manual Testing
After implementation:
1. Start interactive mode: `npm start`
2. Ask AI to use the tool with various parameters
3. Verify error messages are helpful and actionable
4. Test edge cases and error recovery

## Tool Renderers (UI)

Lace supports specialized tool renderers that provide custom UI for specific tools, replacing generic JSON display with tool-optimized interfaces.

### Dynamic Discovery System

**File**: `src/interfaces/terminal/components/events/tool-renderers/getToolRenderer.ts`

The system uses naming conventions to automatically discover tool renderers:

```typescript
// Tool name → Component name → File name
'bash' → 'BashToolRenderer' → './BashToolRenderer.js'
'file-read' → 'FileReadToolRenderer' → './FileReadToolRenderer.js'
'delegate' → 'DelegateToolRenderer' → './DelegateToolRenderer.js'
```

**Key Features:**
- **Async Loading**: Uses ES module dynamic imports for on-demand loading
- **Graceful Fallback**: Returns `null` if renderer not found, triggers generic renderer
- **Error Resilience**: Catches import failures and falls back gracefully
- **Compiled Output**: Looks for `.js` files in compiled `dist/` directory

### Renderer Interface

All tool renderers must implement:

```typescript
interface ToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

type ToolExecutionItem = {
  type: 'tool_execution';
  call: ToolCall;
  result?: ToolResult;
  timestamp: Date;
  callId: string;
};
```

### Export Requirements

Tool renderers must use **named exports** (not default exports):

```typescript
// ✅ Correct
export function BashToolRenderer({ item, isSelected, onToggle }: Props) {
  // ...
}

// ❌ Incorrect  
export default function BashToolRenderer({ item, isSelected, onToggle }: Props) {
  // ...
}
```

### UI Architecture

#### TimelineEntryCollapsibleBox

All tool renderers should use `TimelineEntryCollapsibleBox` for consistent behavior:

```typescript
import { TimelineEntryCollapsibleBox } from '../../ui/TimelineEntryCollapsibleBox.js';

return (
  <TimelineEntryCollapsibleBox
    label={fancyLabel}           // React.ReactNode | string
    summary={compactSummary}     // React.ReactNode (collapsed view)
    isExpanded={isExpanded}
    onExpandedChange={handleExpandedChange}
    isSelected={isSelected}
    onToggle={onToggle}
  >
    {expandedContent}            {/* Full detail view */}
  </TimelineEntryCollapsibleBox>
);
```

#### Label vs Summary

- **Label**: Shows with expand/collapse arrow (`▶` or `▽`) - always visible
- **Summary**: Content shown when collapsed - should be output preview
- **Children**: Content shown when expanded - should be full details

### BashToolRenderer Implementation Example

```typescript
// src/interfaces/terminal/components/events/tool-renderers/BashToolRenderer.tsx
import React from 'react';
import { Text, Box } from 'ink';
import { TimelineEntryCollapsibleBox } from '../../ui/TimelineEntryCollapsibleBox.js';
import { useTimelineItemExpansion } from '../hooks/useTimelineExpansionToggle.js';
import { UI_COLORS, UI_SYMBOLS } from '../../../theme.js';

interface BashOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function parseBashResult(result: ToolResult): BashOutput | null {
  try {
    const content = result?.content?.[0]?.text;
    if (!content) return null;
    return JSON.parse(content) as BashOutput;
  } catch {
    return null;
  }
}

export function BashToolRenderer({ item, isSelected, onToggle }: ToolRendererProps) {
  const command = item.call.arguments?.command as string;
  const result = item.result;
  const output = result ? parseBashResult(result) : null;
  
  const toolSuccess = result ? !result.isError : true;
  const operationSuccess = output ? output.exitCode === 0 : true;
  const success = toolSuccess && operationSuccess;
  
  const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(
    isSelected,
    (expanded) => onToggle?.()
  );

  // Fancy label with React components
  const fancyLabel = (
    <React.Fragment>
      <Text color={UI_COLORS.TOOL}>Bash Tool: </Text>
      <Text color="white">$ {command}</Text>
      <Text color="gray">  </Text>
      <Text color={success ? UI_COLORS.SUCCESS : UI_COLORS.ERROR}>
        {success ? UI_SYMBOLS.SUCCESS : UI_SYMBOLS.ERROR}
      </Text>
      {output && output.exitCode !== 0 && (
        <React.Fragment>
          <Text color="gray"> </Text>
          <Text color={UI_COLORS.ERROR}>exit {output.exitCode}</Text>
        </React.Fragment>
      )}
    </React.Fragment>
  );

  // Compact summary for collapsed view
  const compactSummary = result && output && (
    <Box marginTop={1}>
      {success ? (
        <OutputPreview text={output.stdout} maxLines={3} />
      ) : (
        <OutputPreview text={output.stderr || output.stdout} maxLines={3} />
      )}
    </Box>
  );

  // Full expanded content
  const expandedContent = result && output && (
    <Box flexDirection="column" marginTop={1}>
      {output.stdout && (
        <Box flexDirection="column">
          <Text color={UI_COLORS.SUBDUED}>stdout:</Text>
          <Text>{output.stdout}</Text>
        </Box>
      )}
      {output.stderr && (
        <Box flexDirection="column" marginTop={output.stdout ? 1 : 0}>
          <Text color={UI_COLORS.SUBDUED}>stderr:</Text>
          <Text color={UI_COLORS.ERROR}>{output.stderr}</Text>
        </Box>
      )}
    </Box>
  );

  return (
    <TimelineEntryCollapsibleBox
      label={fancyLabel}
      summary={compactSummary}
      isExpanded={isExpanded}
      onExpandedChange={isExpanded ? onCollapse : onExpand}
      isSelected={isSelected}
      onToggle={onToggle}
    >
      {expandedContent}
    </TimelineEntryCollapsibleBox>
  );
}

// Utility component for output preview
function OutputPreview({ text, maxLines }: { text: string; maxLines: number }) {
  const lines = text.split('\n');
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;
  
  return (
    <Box flexDirection="column">
      <Text>{displayLines.join('\n')}</Text>
      {truncated && (
        <Text color="gray">(+ {lines.length - maxLines} lines)</Text>
      )}
    </Box>
  );
}
```

### Adding a New Tool Renderer

1. **Create the renderer**: `src/interfaces/terminal/components/events/tool-renderers/YourToolRenderer.tsx`
2. **Follow naming convention**: Tool name `your-tool` → `YourToolRenderer`
3. **Implement required interface**: Match `ToolRendererProps`
4. **Use TimelineEntryCollapsibleBox**: For consistent UI
5. **Handle tool-specific output**: Parse and display appropriately
6. **Add tests**: Co-locate test file
7. **Build and test**: System auto-discovers the new renderer

### Renderer Best Practices

#### Performance
- **Lazy Loading**: Renderers are loaded on-demand
- **Error Boundaries**: Failed renderers don't crash the UI
- **Graceful Degradation**: Always falls back to generic renderer

#### User Experience
- **Consistent Patterns**: Use established UI components and patterns
- **Visual Feedback**: Clear success/error states with colors and icons
- **Progressive Disclosure**: Show summary when collapsed, details when expanded
- **Contextual Information**: Preserve important context in all views

#### Layout Guidelines
- **No extra marginLeft in compactSummary**: Content should align naturally
- **Use marginTop for spacing**: Separate sections vertically
- **Consistent depth**: All tool renderers should have same indentation level
- **React Fragment for labels**: Use `React.Fragment` for inline elements, not `Box`

## File Editing Tools Guide

### Available File Tools

#### 1. `file_edit` - Search and Replace
- **Purpose**: Replace exact text matches in files
- **Key requirement**: Text must match exactly (including whitespace)
- **Use case**: Modifying existing code, changing implementations

```typescript
// Usage example
await tool.execute({
  path: "src/main.js",
  old_text: "function oldName() {\n  return 42;\n}",
  new_text: "function newName() {\n  return 100;\n}"
});
```

#### 2. `file_insert` - Add Content  
- **Purpose**: Insert new content at specific lines or append to files
- **Key feature**: Preserves existing content
- **Use case**: Adding new functions, imports, or sections

```typescript
// Insert at specific line
await tool.execute({
  path: "src/main.js", 
  content: "import { helper } from './utils.js';",
  line: 3
});

// Append to end (omit line parameter)
await tool.execute({
  path: "src/main.js",
  content: "\nexport { newFunction };"
});
```

#### 3. `file_read` - View Content
- **Purpose**: Read file contents with optional line ranges
- **Use case**: Inspecting code before editing

#### 4. `file_write` - Create/Overwrite
- **Purpose**: Create new files or completely overwrite existing ones  
- **Use case**: Creating new files from scratch

### File Editing Workflow

#### For LLM Prompting

Include these guidelines in your system prompt:

```markdown
## File Editing Guidelines

When editing files, follow this workflow:

1. **Always read before editing**: Use `file_read` to see the exact content
2. **Use the right tool**:
   - `file_edit`: For modifying existing code
   - `file_insert`: For adding new content
   - `file_write`: Only for new files or complete rewrites

3. **For file_edit**:
   - Copy the exact text to replace (including all whitespace)
   - The old_text must be unique in the file
   - For multiple changes, call the tool multiple times

4. **For file_insert**:
   - Specify line number to insert after (1-based)
   - Omit line number to append to end
   - Include proper indentation in your content

5. **Error handling**:
   - The tools provide specific error messages with solutions
   - Follow the guidance in error messages when issues occur
```

#### Common Patterns

##### Refactoring a function
```javascript
// 1. Read the file
// 2. Replace function signature  
// 3. Replace function body
// 4. Update call sites
```

##### Adding a new feature
```javascript
// 1. Insert imports at top
// 2. Insert new function in appropriate section
// 3. Insert exports if needed
```

##### Fixing bugs
```javascript
// 1. Read to find exact buggy code
// 2. Replace with fixed version
// 3. Verify with another read
```

### Error Handling Patterns

The tools provide specific error messages to guide LLMs:

1. **No matches found**: Guides to check exact text matching
2. **Multiple matches**: Suggests adding more context  
3. **Line out of bounds**: Provides file length information
4. **Invalid input**: Clear parameter requirements

### Schema Implementations

#### File Edit Schema
```typescript
const fileEditSchema = z.object({
  path: FilePath,
  old_text: NonEmptyString.describe('Exact text to replace'),
  new_text: z.string().describe('Replacement text'),
}).refine(
  data => data.old_text !== data.new_text,
  {
    message: 'old_text and new_text must be different',
    path: ['new_text'],
  }
);
```

#### File Insert Schema
```typescript
const fileInsertSchema = z.object({
  path: FilePath,
  content: NonEmptyString.describe('Content to insert'),
  line: LineNumber.optional().describe('Line number to insert after (1-based). Omit to append to end'),
});
```

## Deployment & Integration

### Tool Registration

Tools are automatically registered in the main application initialization:

```typescript
// src/tools/executor.ts
import { ToolExecutor } from './executor.js';
import { 
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  FileInsertTool,
  BashTool,
  // ... other tools
} from './implementations/index.js';

export function createToolExecutor(): ToolExecutor {
  const executor = new ToolExecutor();
  
  // Register all tools
  executor.registerTool(new FileReadTool());
  executor.registerTool(new FileWriteTool());
  executor.registerTool(new FileEditTool());
  executor.registerTool(new FileInsertTool());
  executor.registerTool(new BashTool());
  // ... register other tools
  
  return executor;
}
```

### Provider Integration

Tools work with any provider that supports tool calling:

- **Anthropic**: Native tool support
- **LMStudio**: Via OpenAI-compatible API  
- **Ollama**: With tool calling models
- **OpenAI**: Direct compatibility

The Agent class handles conversion between generic ToolResult format and provider-specific APIs.

### Environment Setup

```bash
# Development setup
git clone <repo>
cd lace
npm install

# Verify everything works
npm test            # Run tests
npm run build       # TypeScript build
npm run lint        # Check linting
npm start           # Interactive mode
```

## Best Practices & Patterns

### Tool Design Principles

1. **Single Responsibility**: Each tool should do one thing well
2. **Explicit Parameters**: No implicit behavior or hidden dependencies
3. **Deterministic Output**: Same input produces same output
4. **Helpful Errors**: Every error should guide toward solution
5. **Type Safety**: Leverage Zod's type inference, avoid `any` types
6. **Performance**: Use result limiting and progress indication for expensive operations

### Schema Design

```typescript
// ✅ Good schema design
const goodSchema = z.object({
  // Clear, descriptive names
  searchPattern: NonEmptyString.describe('Text or regex to search for'),
  targetDirectory: FilePath.describe('Directory to search in'),
  
  // Sensible defaults
  maxResults: z.number().int().min(1).max(1000).default(100),
  caseSensitive: z.boolean().default(false),
  
  // Clear validation with helpful messages
  includeExtensions: z.array(z.string().regex(/^\.\w+$/, 'Must start with dot'))
    .optional()
    .describe('File extensions to include (e.g., [".js", ".ts"])'),
});

// ❌ Poor schema design
const badSchema = z.object({
  // Unclear names
  q: z.string(),
  dir: z.string(),
  
  // No defaults or descriptions
  max: z.number(),
  case: z.boolean(),
  
  // Vague validation
  exts: z.array(z.string()).optional(),
});
```

### Error Message Guidelines

```typescript
// ✅ Helpful error messages
if (error.code === 'ENOENT') {
  const suggestions = await findSimilarPaths(args.path);
  const suggestionText = suggestions.length > 0
    ? `\nSimilar files found: ${suggestions.join(', ')}`
    : '\nCheck the file path and try again.';
  return this.createError(`File not found: ${args.path}${suggestionText}`);
}

// ❌ Unhelpful error messages  
if (error.code === 'ENOENT') {
  return this.createError('File not found');
}
```

### Output Consistency

```typescript
// ✅ Use base class helpers
return this.createResult({
  filesProcessed: files.length,
  totalSize: totalBytes,
  errors: errorList,
}, {
  duration: Date.now() - startTime,
  cacheHit: fromCache,
});

// ❌ Manual result construction
return {
  content: [{ 
    type: 'text', 
    text: JSON.stringify({ files: files.length }) 
  }],
  isError: false,
};
```

### Testing Strategies

```typescript
// ✅ Comprehensive test coverage
describe('FileSearchTool', () => {
  describe('Tool metadata', () => {
    // Test name, description, schema structure
  });
  
  describe('Input validation', () => {
    // Test all validation rules, defaults, edge cases
  });
  
  describe('Functionality', () => {
    // Test core business logic with various inputs
  });
  
  describe('Error handling', () => {
    // Test all error conditions, recovery guidance
  });
  
  describe('Integration', () => {
    // Test with real file systems, edge cases
  });
});
```

### Common Anti-Patterns

#### ❌ Don't Do This

```typescript
// Manual validation instead of schemas
if (!args.path || typeof args.path !== 'string') {
  return { isError: true, content: [{ type: 'text', text: 'Invalid path' }] };
}

// Direct file system access without error handling
const content = await readFile(args.path, 'utf-8');

// Generic error messages
catch (error) {
  return this.createError('Operation failed');
}

// Type assertions instead of proper validation
const count = args.count as number;
```

#### ✅ Do This Instead

```typescript
// Schema-based validation with helpful messages
const schema = z.object({
  path: FilePath.describe('Path to file to read'),
  encoding: z.enum(['utf-8', 'ascii']).default('utf-8'),
});

// Proper error handling with context
try {
  const content = await readFile(args.path, args.encoding);
  return this.createResult(content);
} catch (error: any) {
  if (error.code === 'ENOENT') {
    return this.createError(`File not found: ${args.path}. Check the path and try again.`);
  }
  throw error; // Re-throw unexpected errors
}

// Type-safe parameter access
protected async executeValidated(
  args: z.infer<typeof schema>,
  context?: ToolContext
): Promise<ToolResult> {
  // args.path is guaranteed to be a valid file path
  // args.encoding is guaranteed to be 'utf-8' or 'ascii'
}
```

## Troubleshooting

### Common Issues

#### Tool Not Loading
```bash
# Check tool is exported
grep -r "YourTool" src/tools/implementations/index.ts

# Verify schema validation
npm test your-tool.test.ts

# Check TypeScript compilation
npm run build
```

#### Validation Errors
```typescript
// Debug schema issues
const result = schema.safeParse(testInput);
if (!result.success) {
  console.log('Validation errors:', result.error.issues);
}
```

#### TypeScript Errors
```bash
# Common fixes
npm run lint:fix       # Auto-fix linting issues
npm run format         # Format code consistently
npm run build          # Check TypeScript compilation
```

### Performance Issues

#### Large File Operations
```typescript
// ✅ Stream large files
const stream = createReadStream(args.path);
const chunks = [];
for await (const chunk of stream) {
  chunks.push(chunk);
  if (chunks.length > MAX_CHUNKS) {
    return this.createError(`File too large: ${args.path}. Use line ranges to read portions.`);
  }
}

// ✅ Limit result sets
if (results.length > args.maxResults) {
  const truncated = results.slice(0, args.maxResults);
  return this.createResult(
    formatResults(truncated) + 
    `\n\nResults limited to ${args.maxResults}. ${results.length - args.maxResults} additional matches found.`
  );
}
```

### Testing Issues

#### Flaky Tests
```typescript
// ✅ Use deterministic temp directories
beforeEach(async () => {
  testDir = join(tmpdir(), `lace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
});

// ✅ Cleanup resources
afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});
```

#### Mock Tool Issues
```typescript
// ✅ Proper mock tool implementation
class MockTool extends Tool {
  name = 'mock_tool';
  description = 'Mock tool for testing';
  schema = z.object({ input: z.string() });
  
  protected async executeValidated(args: z.infer<typeof this.schema>): Promise<ToolResult> {
    return this.createResult(`Processed: ${args.input}`);
  }
}

// ❌ Object literal mock (doesn't work with new system)
const mockTool = {
  name: 'mock_tool',
  execute: vi.fn(),
  // ...
};
```

### Debug Logging

```typescript
import { logger } from '../../utils/logger.js';

protected async executeValidated(args: z.infer<typeof schema>): Promise<ToolResult> {
  logger.debug('Tool execution started', {
    toolName: this.name,
    args: args,
    timestamp: new Date().toISOString(),
  });
  
  try {
    const result = await performOperation(args);
    
    logger.info('Tool execution completed', {
      toolName: this.name,
      success: true,
      resultSize: JSON.stringify(result).length,
    });
    
    return this.createResult(result);
  } catch (error) {
    logger.error('Tool execution failed', {
      toolName: this.name,
      error: error.message,
      stack: error.stack,
    });
    
    throw error;
  }
}
```

### Getting Help

If you encounter issues:

1. **Check existing implementations**: Look at similar tools for patterns
2. **Review test files**: See expected behavior and edge cases
3. **Run existing tools**: Compare behavior with working examples
4. **Check logs**: Review debug output for clues
5. **Test incrementally**: Build up functionality step by step

Remember: The goal is clean, maintainable code that behaves predictably and provides helpful feedback to both developers and AI agents.