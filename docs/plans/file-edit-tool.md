# Unified File-Edit Tool Implementation Plan

## Overview

Replace the current `file-edit.ts` and `file-insert.ts` tools with a single unified `file-edit` tool that handles all file modification operations. No backwards compatibility - clean slate design.

This design is informed by Anthropic's learnings from SWE-bench performance optimization, emphasizing:
- Minimal scaffolding with maximum model control
- Preemptive error prevention through clear descriptions
- String replacement strategy with strict matching requirements
- Actionable error messages that guide retry behavior

## Tool Specification

### Tool Schema

```typescript
{
  name: 'file_edit',
  description: `Edit files by replacing exact text matches or inserting content at specific positions.

  MODES:
  1. REPLACE: old_text contains content to find and replace
  2. INSERT: old_text is "", insert_line specifies position  
  3. APPEND: old_text is "", no insert_line (adds to end)

  REQUIREMENTS (from Anthropic SWE-bench learnings):
  - ALWAYS use absolute file paths (never relative)
  - Text matching is EXACT - every space, tab, newline must match perfectly
  - Replacements only succeed with exactly one match (unless replace_all=true)
  - Use raw strings - do NOT escape quotes, backslashes, or newlines
  - ALWAYS use file_read first to see exact content before editing

  COMMON PITFALLS TO AVOID:
  - Guessing at whitespace or indentation
  - Escaping characters that should be raw
  - Using this tool for file creation (use file_write instead)
  - Attempting fuzzy or approximate matching`,

  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute file path to edit (must start with /)'
      },
      old_text: {
        type: 'string',
        description: 'Exact text to replace - must match file content perfectly including all whitespace. Empty string "" for insert/append modes. DO NOT escape characters.'
      },
      new_text: {
        type: 'string', 
        description: 'Replacement text or content to insert. Use raw strings without escaping.'
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all matches (true) or require exactly one match (false)',
        default: false
      },
      insert_line: {
        type: 'number',
        description: 'Line number to insert after (1-based). Only for INSERT mode.'
      }
    },
    required: ['path', 'old_text', 'new_text']
  }
}
```

### Operation Modes

**Mode Detection Logic:**
- `old_text` is empty + `insert_line` specified → INSERT MODE  
- `old_text` is empty + no `insert_line` → APPEND MODE
- `old_text` has content → REPLACE MODE

### Error Messages

**Design Principle (from Anthropic SWE-bench)**: Error messages should provide actionable feedback that guides the model to retry successfully.

```typescript
// No matches found
`No matches found for old_text in ${path}.

This error occurs when the text doesn't match exactly. To fix:
1. Use file_read to see the exact content of ${path}
2. Copy the EXACT text including all spaces, tabs, and newlines
3. Do not add or remove any whitespace`

// Multiple matches with replace_all=false  
`Found ${count} matches for old_text. The tool requires exactly 1 match when replace_all=false.

To fix this:
- Set replace_all=true to replace all ${count} occurrences
- OR include more surrounding context in old_text to make it unique`

// Invalid mode combination
`Invalid parameters. Choose one mode:
- REPLACE: old_text="content to find", new_text="replacement"
- INSERT: old_text="", insert_line=5, new_text="content to insert"  
- APPEND: old_text="", new_text="content to append" (no insert_line)`

// Line out of range
`Cannot insert at line ${line}. File has only ${actual} lines.
Valid range: 1 to ${actual}`

// Path validation error
`Path must be absolute (start with /). Got: ${path}`
```

## Test Specification

**Design Principle (from Anthropic SWE-bench)**: Comprehensive testing should cover common model errors and guide correct usage patterns.

### Test Cases Required

```typescript
describe('FileEditTool', () => {
  // Path validation (Anthropic SWE-bench learning)
  it('should require absolute paths')
  it('should reject relative paths with clear error message')
  
  // Mode detection and basic functionality
  it('should detect REPLACE mode when old_text has content')
  it('should detect INSERT mode when old_text="" and insert_line specified')  
  it('should detect APPEND mode when old_text="" and no insert_line')

  // REPLACE mode tests (string replacement strategy)
  it('should replace single exact match')
  it('should replace multiple matches when replace_all=true')
  it('should fail with multiple matches when replace_all=false')
  it('should fail when no matches found with actionable error')
  it('should preserve exact whitespace in replacements')
  it('should handle multi-line replacements')
  it('should not escape special characters in old_text or new_text')
  
  // Test common model errors (Anthropic SWE-bench insights)
  it('should handle tabs vs spaces mismatch with helpful error')
  it('should handle trailing whitespace issues')
  it('should handle incorrect newline characters')

  // INSERT mode tests  
  it('should insert content after specified line')
  it('should fail when insert_line exceeds file length')
  it('should handle inserting at line 1')
  it('should handle multi-line insertions')

  // APPEND mode tests
  it('should append to end of file')
  it('should handle appending to empty file')
  it('should add newline if file doesn\'t end with one')
  it('should handle multi-line appends')

  // Error handling with actionable feedback
  it('should validate required parameters')
  it('should give error messages that guide retry')
  it('should handle file not found errors')
  it('should detect invalid mode combinations')

  // Edge cases
  it('should handle files with no trailing newline')
  it('should handle empty files')
  it('should handle files with only whitespace')
  it('should preserve exact indentation')
}
```

### Test Data Examples

```typescript
// Multi-line replacement test
const originalContent = `function calculate() {
  const a = 1;
  const b = 2;
  return a + b;
}`;

const old_text = `  const a = 1;
  const b = 2;
  return a + b;`;

const new_text = `  const x = 10;
  const y = 20;
  return x * y;`;

// Insert mode test
const fileContent = `Line 1
Line 2
Line 3`;

// Insert after line 2
{
  old_text: "",
  insert_line: 2,
  new_text: "Inserted Line"
}
// Expected result: Line 1\nLine 2\nInserted Line\nLine 3

// Replace all test
const codeWithDuplicates = `const foo = 1;
const bar = foo + 2;
const baz = foo * 3;`;

{
  old_text: "foo",
  new_text: "value",
  replace_all: true
}
// Expected: replaces all 3 occurrences of "foo"
```

## Implementation Prompts

### Prompt 1: Setup and Test Planning

```
We're replacing file-edit.ts and file-insert.ts with a single unified file-edit tool.

STEP 1: Write comprehensive tests first in src/tools/__tests__/file-edit.test.ts

Test these exact scenarios:
- Replace mode: single match, multiple matches with replace_all=false (error), multiple matches with replace_all=true (success)  
- Insert mode: old_text="", insert_line=2, content inserted after line 2
- Append mode: old_text="", no insert_line, content appended to end
- Error cases: no matches, line out of range, invalid parameters
- Multi-line text with exact whitespace preservation
- Empty files, files without trailing newlines

Use existing test patterns from current file-edit.test.ts as reference.
Run tests - they should all fail initially.
```

### Prompt 2: Core Tool Implementation

```
STEP 2: Implement the unified FileEditTool in src/tools/implementations/file-edit.ts

Replace the entire file with:
- Tool name: 'file_edit'  
- Schema with old_text, new_text, replace_all (boolean, default false), insert_line (optional number)
- Description emphasizing raw strings (no escaping), file_read first, exact matching
- Mode detection logic: empty old_text = insert/append, non-empty = replace
- Single executeTool method handling all three modes
- Exact error messages from spec (short, direct)

Keep it simple. No complex abstractions. One file, one class, clear logic flow.
```

### Prompt 3: Remove File-Insert Tool

```
STEP 3: Clean up file-insert tool completely

- Delete src/tools/implementations/file-insert.ts
- Delete src/tools/__tests__/file-insert.test.ts  
- Remove FileInsertTool import from src/tools/executor.ts
- Remove FileInsertTool from tool registration
- Check no other files reference file-insert

Verify the build passes and no broken imports remain.
```

### Prompt 4: Test and Validate

```
STEP 4: Run tests and verify behavior

- Run npm run test:unit -- file-edit.test.ts
- All tests should pass
- Test the tool manually with a simple file to verify each mode works
- Run npm run lint and npm run build to ensure no issues

The unified tool should handle all previous file-edit and file-insert use cases.
No backwards compatibility needed - this is the new interface.
```

## Implementation Details

### Core Algorithm

```typescript
async executeTool(input: Record<string, unknown>): Promise<ToolResult> {
  const { path, old_text, new_text, replace_all = false, insert_line } = input;
  
  // Path validation (Anthropic SWE-bench: require absolute paths)
  if (!path.startsWith('/')) {
    return createErrorResult(`Path must be absolute (start with /). Got: ${path}`);
  }
  
  // Mode detection
  if (old_text === "") {
    if (insert_line !== undefined) {
      return this.insertMode(path, new_text, insert_line);
    } else {
      return this.appendMode(path, new_text);
    }
  } else {
    return this.replaceMode(path, old_text, new_text, replace_all);
  }
}
```

### Success Messages
- Replace: `"Successfully replaced ${count} occurrence(s) in ${path}"`
- Insert: `"Successfully inserted content in ${path} after line ${line}"`  
- Append: `"Successfully appended content to ${path}"`

### Key Design Principles

**Core Principles**:
- **YAGNI**: No unnecessary features or abstractions
- **DRY**: Single tool handles all file modification patterns
- **Simple**: Clear mode detection, straightforward logic
- **Clean**: Explicit error messages, no ambiguity
- **Test-first**: Comprehensive test coverage before implementation

**Anthropic SWE-bench Learnings Applied**:
- **Minimal scaffolding**: One flexible tool instead of multiple rigid ones
- **Maximum control**: Model decides how to use modes, not prescriptive workflow
- **Preemptive guidance**: Tool description anticipates common errors
- **Actionable errors**: Every error message explains how to fix the problem
- **String replacement strategy**: Exact matching with clear constraints

## Migration Notes

### Files to Remove
- `src/tools/implementations/file-insert.ts`
- `src/tools/__tests__/file-insert.test.ts`

### Files to Modify  
- `src/tools/implementations/file-edit.ts` (complete rewrite)
- `src/tools/__tests__/file-edit.test.ts` (expand with new test cases)
- `src/tools/executor.ts` (remove file-insert registration)

### Validation
- All existing file-edit functionality preserved
- All existing file-insert functionality available via new modes
- Tool count reduced from 2 to 1
- Error messages improved for better model guidance