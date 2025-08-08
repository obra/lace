# File Edit Tool Design Specification

## Overview

A unified file editing tool that handles both single and multiple edits to a file with precise occurrence validation, atomic operations, and comprehensive error reporting designed for LLM self-correction.

## Core Principles

1. **Predictability**: Exact occurrence matching prevents unexpected changes
2. **Atomicity**: All edits succeed or all fail - no partial modifications
3. **Debuggability**: Rich error messages enable LLMs to self-correct
4. **Efficiency**: Single file read/write for any number of edits
5. **Sequentiality**: Edits apply in order, each building on the previous

## API Specification

### Input Schema

```typescript
interface FileEditArgs {
  path: string;              // File path (absolute or relative)
  edits: EditOperation[];    // Array of edit operations (always an array)
  dry_run?: boolean;         // Preview changes without applying (default: false)
}

interface EditOperation {
  old_text: string;          // Exact text to find and replace
  new_text: string;          // Replacement text
  occurrences?: number;      // Expected number of occurrences (default: 1)
}
```

### Output Schema

```typescript
interface FileEditResult {
  isError: boolean;
  content: ContentBlock[];
  metadata?: FileEditMetadata;
}

interface FileEditMetadata {
  // Always present
  path: string;
  
  // For successful edits
  diff?: FileEditDiffContext;      // Full diff with context
  edits_applied?: EditSummary[];   // Summary of each edit
  total_replacements?: number;      // Total replacements made
  
  // For dry run mode
  dry_run?: boolean;
  would_modify?: boolean;
  preview?: DiffPreview[];
  
  // For validation errors
  validation_error?: ValidationError;
  suggested_fixes?: SuggestedFix[];
  file_preview?: FilePreview;
}
```

### Error Reporting Structures

```typescript
interface ValidationError {
  type: 'NO_MATCH' | 'WRONG_COUNT' | 'FILE_NOT_FOUND' | 'BINARY_FILE' | 'PERMISSION_DENIED';
  edit_index: number;        // Which edit failed (0-based)
  total_edits: number;       // How many edits were requested
  message: string;           // Human-readable error
  
  // For occurrence errors
  expected_occurrences?: number;
  actual_occurrences?: number;
  match_locations?: MatchLocation[];
  
  // For no match errors
  search_text?: string;
  similar_content?: SimilarContent[];  // Fuzzy matches to help LLM
}

interface MatchLocation {
  line_number: number;
  column_start: number;
  column_end: number;
  line_content: string;      // Full line containing the match
  context_before?: string;   // Previous line
  context_after?: string;    // Next line
}

interface SimilarContent {
  line_number: number;
  content: string;
  similarity_score: number;   // 0-1, how similar to search_text
  differences: StringDiff[];  // What's different
}

interface StringDiff {
  type: 'whitespace' | 'case' | 'punctuation' | 'content';
  expected: string;
  found: string;
}

interface SuggestedFix {
  type: 'USE_EXACT_TEXT' | 'ADJUST_COUNT' | 'ESCAPE_SPECIAL' | 'CHECK_WHITESPACE';
  suggestion: string;
  example?: string;
}

interface FilePreview {
  total_lines: number;
  preview_start_line: number;
  preview_end_line: number;
  content: string;            // Relevant section of file
  highlights?: LineHighlight[];
}
```

## Execution Algorithm

```typescript
async function executeFileEdit(args: FileEditArgs): Promise<FileEditResult> {
  // 1. Input validation
  if (!args.edits || args.edits.length === 0) {
    return createError('No edits provided');
  }
  
  // 2. Read file once
  let originalContent: string;
  try {
    originalContent = await readFile(args.path, 'utf-8');
  } catch (error) {
    return createFileNotFoundError(args.path, error);
  }
  
  // 3. Check for binary file
  if (isBinaryContent(originalContent)) {
    return createBinaryFileError(args.path);
  }
  
  // 4. Pre-validation pass
  const validationResult = validateAllEdits(originalContent, args.edits);
  if (validationResult.hasError) {
    return createValidationError(validationResult, originalContent);
  }
  
  // 5. Dry run mode
  if (args.dry_run) {
    return createDryRunResult(originalContent, validationResult);
  }
  
  // 6. Apply all edits sequentially
  let workingContent = originalContent;
  const editSummaries: EditSummary[] = [];
  
  for (const [index, edit] of args.edits.entries()) {
    const result = applyEdit(workingContent, edit, index);
    workingContent = result.content;
    editSummaries.push(result.summary);
  }
  
  // 7. Write file once
  try {
    await writeFile(args.path, workingContent, 'utf-8');
  } catch (error) {
    return createWriteError(args.path, error);
  }
  
  // 8. Generate comprehensive diff
  const diffContext = extractDiffContext(originalContent, workingContent);
  
  return createSuccessResult({
    path: args.path,
    diff: diffContext,
    edits_applied: editSummaries,
    total_replacements: editSummaries.reduce((sum, e) => sum + e.occurrences_replaced, 0)
  });
}
```

## Error Messages for LLM Self-Correction

### No Match Found

```typescript
{
  isError: true,
  content: [{
    type: 'text',
    text: `Edit 1 of 3 failed: Could not find exact text in /src/app.ts.
    
Searched for (between >>>markers<<<):
>>>${searchText}<<<

File contains similar content that might be what you're looking for:

Line 45: ${similarLine1}
  Difference: Extra space after 'const'
  
Line 67: ${similarLine2}  
  Difference: Uses double quotes instead of single quotes

Suggestions:
1. Use file_read to see the exact content, then copy it precisely
2. Check for tabs vs spaces - the file uses ${detected}
3. Ensure you include all line breaks in multi-line searches`
  }],
  metadata: {
    validation_error: {
      type: 'NO_MATCH',
      edit_index: 0,
      total_edits: 3,
      search_text: searchText,
      similar_content: [
        {
          line_number: 45,
          content: actualLine45,
          similarity_score: 0.92,
          differences: [{
            type: 'whitespace',
            expected: 'const',
            found: 'const '
          }]
        }
      ]
    },
    suggested_fixes: [
      {
        type: 'USE_EXACT_TEXT',
        suggestion: 'Copy the exact text from file_read output',
        example: 'Use: "const  foo" (with two spaces)'
      }
    ]
  }
}
```

### Wrong Occurrence Count

```typescript
{
  isError: true,
  content: [{
    type: 'text',
    text: `Edit 2 of 2 failed: Expected 3 occurrences but found 5 in /src/utils.ts.

Expected to replace 3 instances of 'console.log' but found 5 instances at:
  Line 12, column 5
  Line 34, column 9  
  Line 56, column 5
  Line 78, column 13
  Line 102, column 5

Options to fix:
1. Update occurrences to 5 if you want to replace all instances
2. Add more context to make the old_text unique to just the 3 you want
3. Split into multiple edits with unique old_text for each target`
  }],
  metadata: {
    validation_error: {
      type: 'WRONG_COUNT',
      edit_index: 1,
      total_edits: 2,
      expected_occurrences: 3,
      actual_occurrences: 5,
      match_locations: [
        {
          line_number: 12,
          column_start: 5,
          column_end: 16,
          line_content: "    console.log('Starting process');",
          context_before: "function init() {",
          context_after: "    const config = loadConfig();"
        },
        // ... more locations
      ]
    }
  }
}
```

## Test Suite Design

### Test Categories

#### 1. Basic Operations
- Single edit with default occurrence (1)
- Single edit with explicit occurrence count
- Multiple edits in sequence
- Empty edits array handling
- Very large files (>10MB)
- Very long lines (>10000 chars)

#### 2. Occurrence Validation
```typescript
describe('Occurrence validation', () => {
  it('should replace single occurrence by default')
  it('should replace exact number when specified')
  it('should fail when expected count does not match actual')
  it('should count occurrences correctly across line boundaries')
  it('should handle overlapping matches correctly')
  it('should count occurrences after each edit in sequence')
})
```

#### 3. Sequential Edit Behavior
```typescript
describe('Sequential edits', () => {
  it('should apply edits in order')
  it('should allow second edit to modify results of first edit')
  it('should count occurrences based on current state, not original')
  it('should handle edit that creates text for next edit')
  it('should handle edit that removes text next edit would target')
})
```

#### 4. Edge Cases
```typescript
describe('Edge cases', () => {
  // Text matching
  it('should match text with special regex characters literally')
  it('should preserve different line endings (LF, CRLF, CR)')
  it('should handle unicode and emoji correctly')
  it('should match empty strings correctly')
  it('should handle null bytes in text')
  
  // File operations
  it('should handle permission denied errors')
  it('should handle file not found errors')  
  it('should detect and reject binary files')
  it('should handle symlinks correctly')
  it('should preserve file permissions and attributes')
  
  // Boundary conditions
  it('should handle editing at start of file')
  it('should handle editing at end of file')
  it('should handle replacing entire file content')
  it('should handle file with no newline at end')
})
```

#### 5. Dry Run Mode
```typescript
describe('Dry run mode', () => {
  it('should not modify file in dry run')
  it('should return preview of all changes')
  it('should validate all edits in dry run')
  it('should return same errors as real run would')
  it('should include line numbers in preview')
})
```

#### 6. Error Reporting for LLMs
```typescript
describe('LLM-friendly error reporting', () => {
  it('should suggest fixes for whitespace mismatches')
  it('should identify case sensitivity issues')
  it('should show similar content when no exact match')
  it('should provide line numbers for all matches')
  it('should suggest using file_read for exact content')
  it('should explain why binary files cannot be edited')
  it('should provide clear next steps for each error type')
})
```

#### 7. Complex Scenarios
```typescript
describe('Complex real-world scenarios', () => {
  it('should handle renaming a variable throughout a file', async () => {
    const content = `
      const userId = getUserId();
      console.log(userId);
      if (userId) {
        return userId.toString();
      }
    `;
    
    const result = await tool.execute({
      path: testFile,
      edits: [{
        old_text: 'userId',
        new_text: 'userIdentifier',
        occurrences: 4
      }]
    });
    
    expect(result.isError).toBe(false);
    const newContent = await readFile(testFile);
    expect(newContent).not.toContain('userId');
    expect(newContent).toContain('userIdentifier');
  });
  
  it('should handle updating multiple import statements', async () => {
    const content = `
      import { foo } from './old-path';
      import { bar } from './old-path';
      import { baz } from './other-path';
    `;
    
    const result = await tool.execute({
      path: testFile,
      edits: [{
        old_text: "'./old-path'",
        new_text: "'./new-path'",
        occurrences: 2
      }]
    });
    
    expect(result.isError).toBe(false);
  });
  
  it('should handle comment updates across file', async () => {
    const content = `
      // TODO: implement this
      function feature1() {
        // TODO: implement this
      }
      
      // TODO: implement this  
      function feature2() {
        return null; // TODO: implement this
      }
    `;
    
    const result = await tool.execute({
      path: testFile,
      edits: [{
        old_text: '// TODO: implement this',
        new_text: '// DONE: implemented',
        occurrences: 4
      }]
    });
    
    expect(result.isError).toBe(false);
  });
})
```

#### 8. Performance Tests
```typescript
describe('Performance', () => {
  it('should handle 1000 edits efficiently')
  it('should handle 10MB file efficiently')
  it('should not read file multiple times')
  it('should not write file multiple times')
  it('should validate all edits before any modifications')
})
```

### Test Data Fixtures

```typescript
// fixtures/test-files.ts
export const fixtures = {
  simple: {
    content: 'Hello World',
    edits: [{ old_text: 'World', new_text: 'Universe' }],
    expected: 'Hello Universe'
  },
  
  multipleOccurrences: {
    content: 'foo bar foo baz foo',
    edits: [{ old_text: 'foo', new_text: 'qux', occurrences: 3 }],
    expected: 'qux bar qux baz qux'
  },
  
  sequential: {
    content: 'const a = 1;\nconst b = 2;',
    edits: [
      { old_text: 'const', new_text: 'let', occurrences: 2 },
      { old_text: 'let a', new_text: 'let x' },
      { old_text: '= 1', new_text: '= 100' }
    ],
    expected: 'let x = 100;\nlet b = 2;'
  },
  
  whitespace: {
    content: 'function  foo() {\n\treturn  true;\n}',
    edits: [{ old_text: 'function  foo', new_text: 'function bar' }],
    expected: 'function bar() {\n\treturn  true;\n}'
  },
  
  lineEndings: {
    windows: 'line1\r\nline2\r\nline3',
    unix: 'line1\nline2\nline3',
    mac: 'line1\rline2\rline3'
  }
};
```

## Implementation Notes

### Critical Behaviors

1. **Exact Text Matching**: No regex, no pattern matching - exact string only
2. **Sequential Application**: Each edit sees the results of previous edits
3. **Atomic Operations**: Use temp file + rename for safety
4. **Line Number Tracking**: Always relative to original file for clarity
5. **Whitespace Preservation**: Never modify whitespace not explicitly targeted

### Performance Considerations

1. **Single File Read**: Read entire file once into memory
2. **Single File Write**: Write entire file once after all edits
3. **Efficient String Operations**: Use indexOf for searching, not regex
4. **Memory Limits**: Refuse to edit files > 100MB
5. **Edit Limit**: Maximum 1000 edits per operation

### Security Considerations

1. **Path Traversal**: Validate paths don't escape workspace
2. **Binary Detection**: Check for null bytes before processing
3. **Permission Handling**: Clear errors for permission issues
4. **Symlink Resolution**: Follow symlinks but report final path
5. **Backup Option**: Consider offering backup before destructive edits

## Migration Plan

1. Phase 1: Implement new tool as `file_edit_v2`
2. Phase 2: Update tests to cover all scenarios
3. Phase 3: Add dry_run support and enhanced errors
4. Phase 4: Migrate existing file_edit callers
5. Phase 5: Deprecate old file_edit tool
6. Phase 6: Rename file_edit_v2 to file_edit

## Success Metrics

- Zero partial file modifications (atomicity)
- LLM self-correction success rate > 90%
- Performance: < 100ms for typical edits
- Memory usage: < 3x file size
- Test coverage: > 95%