# File Edit Tool Implementation Plan

## Overview

You will be implementing a file editing tool that can make multiple text replacements in a single file atomically. This tool is used by AI assistants to modify code files. The key feature is that it validates the exact number of occurrences before making any changes.

## Background Context

### What This Tool Does
- Takes a file path and a list of text replacements to make
- Each replacement specifies the exact text to find, what to replace it with, and how many times it should occur
- If ANY validation fails (wrong occurrence count, text not found), NO changes are made
- Applies edits sequentially - each edit sees the result of the previous edit

### Critical Requirements
1. **NEVER use `any` type** - Use `unknown` and type guards instead
2. **NEVER mock the functionality being tested** - Test real file operations
3. **Test-Driven Development (TDD)** - Write failing tests first, then implement
4. **Frequent commits** - Commit after each test passes
5. **YAGNI** - Don't add features not in the spec
6. **DRY** - Don't repeat code

### TypeScript Tips for This Project
```typescript
// NEVER do this:
const data: any = JSON.parse(content);

// Do this instead:
const data: unknown = JSON.parse(content);
if (typeof data === 'object' && data !== null && 'path' in data) {
  // Now TypeScript knows data is an object with a path property
}

// For arrays:
if (Array.isArray(edits)) {
  // TypeScript knows edits is an array
}

// For catching errors:
try {
  // code
} catch (error: unknown) {
  if (error instanceof Error) {
    console.log(error.message);
  }
}
```

## Project Structure

```
src/
  tools/
    implementations/
      file-edit.ts          # Current implementation to replace
      file-edit.test.ts     # Current tests to enhance
    types.ts               # Tool type definitions
    tool.ts                # Base Tool class
    schemas/
      common.ts            # Common Zod schemas
```

## Implementation Tasks

### Task 1: Set Up Development Environment

**Goal**: Ensure you can run tests and understand the codebase.

**Steps**:
1. Run existing tests to ensure environment works:
   ```bash
   npm run test:run -- src/tools/implementations/file-edit.test.ts
   ```

2. Read these files to understand the system:
   - `src/tools/tool.ts` - Base class your tool extends
   - `src/tools/types.ts` - Type definitions for tools
   - `src/tools/implementations/file-edit.ts` - Current implementation
   - `src/tools/schemas/common.ts` - Reusable Zod schemas

3. Run the linter to understand code standards:
   ```bash
   npm run lint
   ```

**Commit**: No code changes, just verification

---

### Task 2: Create Test File for New Implementation

**Goal**: Set up test infrastructure without implementation.

**File**: Create `src/tools/implementations/file-edit-v2.test.ts`

```typescript
// ABOUTME: Comprehensive tests for enhanced file_edit tool with multiple edits support
// ABOUTME: Tests occurrence validation, sequential processing, and LLM-friendly errors

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
// Will import FileEditTool from './file-edit-v2' once it exists

describe('FileEditTool V2', () => {
  let tool: any; // Will be FileEditTool type
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    // tool = new FileEditTool(); // Uncomment when class exists
    testDir = await fs.mkdtemp(join(tmpdir(), 'file-edit-v2-test-'));
    testFile = join(testDir, 'test.txt');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Single Edit Operations', () => {
    it.skip('should replace single occurrence by default', async () => {
      // Write test first, then implement
      await writeFile(testFile, 'Hello World', 'utf-8');
      
      const result = await tool.execute({
        path: testFile,
        edits: [{
          old_text: 'World',
          new_text: 'Universe'
        }]
      });
      
      expect(result.isError).toBe(false);
      const content = await readFile(testFile, 'utf-8');
      expect(content).toBe('Hello Universe');
    });
  });
});
```

**Testing**: 
```bash
npm run test:run -- src/tools/implementations/file-edit-v2.test.ts
```
Should see skipped test.

**Commit**: 
```bash
git add src/tools/implementations/file-edit-v2.test.ts
git commit -m "test: add test structure for file-edit-v2 tool"
```

---

### Task 3: Create Basic Tool Class Structure

**Goal**: Create minimal tool class that makes tests compile.

**File**: Create `src/tools/implementations/file-edit-v2.ts`

```typescript
// ABOUTME: Enhanced file_edit tool with multiple edits and occurrence validation
// ABOUTME: Supports atomic multi-edit operations with precise occurrence counting

import { z } from 'zod';
import { Tool } from '~/tools/tool';
import type { ToolResult, ToolContext, ToolAnnotations } from '~/tools/types';
import { FilePath } from '~/tools/schemas/common';

// Define schemas for input validation
const editOperationSchema = z.object({
  old_text: z.string(),
  new_text: z.string(),
  occurrences: z.number().int().positive().optional(),
});

const fileEditArgsSchema = z.object({
  path: FilePath,
  edits: z.array(editOperationSchema).min(1),
  dry_run: z.boolean().optional(),
});

// Export types for use in tests and other files
export type EditOperation = z.infer<typeof editOperationSchema>;
export type FileEditArgs = z.infer<typeof fileEditArgsSchema>;

export class FileEditTool extends Tool {
  name = 'file_edit';
  description = 'Edit files by making multiple text replacements with occurrence validation';
  schema = fileEditArgsSchema;
  
  annotations: ToolAnnotations = {
    destructiveHint: true,
  };
  
  protected async executeValidated(
    args: FileEditArgs,
    context?: ToolContext
  ): Promise<ToolResult> {
    // Temporary implementation to make tests compile
    return this.createError('Not implemented yet');
  }
}
```

**Update test file** to import the tool:
```typescript
import { FileEditTool } from './file-edit-v2';
```

**Testing**:
```bash
npm run test:run -- src/tools/implementations/file-edit-v2.test.ts
```
Test should compile but still be skipped.

**Commit**:
```bash
git add src/tools/implementations/file-edit-v2.ts
git add src/tools/implementations/file-edit-v2.test.ts
git commit -m "feat: add basic structure for file-edit-v2 tool"
```

---

### Task 4: Implement Single Edit (TDD)

**Goal**: Make the simplest test pass - single edit with default occurrence.

**Step 1**: Remove `.skip` from first test and run it:
```bash
npm run test:run -- src/tools/implementations/file-edit-v2.test.ts
```
Test should fail with "Not implemented yet"

**Step 2**: Implement minimal code to pass in `file-edit-v2.ts`:

```typescript
import { readFile, writeFile } from 'fs/promises';

protected async executeValidated(
  args: FileEditArgs,
  context?: ToolContext
): Promise<ToolResult> {
  const resolvedPath = this.resolvePath(args.path, context);
  
  // Read file
  let content: string;
  try {
    content = await readFile(resolvedPath, 'utf-8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return this.createError(`File not found: ${args.path}`);
    }
    throw error;
  }
  
  // Apply single edit (minimal implementation)
  const edit = args.edits[0];
  const occurrences = content.split(edit.old_text).length - 1;
  const expectedOccurrences = edit.occurrences ?? 1;
  
  if (occurrences !== expectedOccurrences) {
    return this.createError(
      `Expected ${expectedOccurrences} occurrences but found ${occurrences}`
    );
  }
  
  const newContent = content.replace(edit.old_text, edit.new_text);
  
  // Write file
  try {
    await writeFile(resolvedPath, newContent, 'utf-8');
  } catch (error: unknown) {
    return this.createError(`Failed to write file: ${error}`);
  }
  
  return this.createResult('Successfully replaced text');
}
```

**Step 3**: Run test - should pass:
```bash
npm run test:run -- src/tools/implementations/file-edit-v2.test.ts
```

**Commit**:
```bash
git add -A
git commit -m "feat: implement single edit with default occurrence"
```

---

### Task 5: Add Test for Occurrence Validation

**Goal**: Ensure tool fails when occurrence count doesn't match.

**Add test** to `file-edit-v2.test.ts`:

```typescript
it('should fail when occurrence count does not match', async () => {
  await writeFile(testFile, 'foo bar foo baz foo', 'utf-8');
  
  const result = await tool.execute({
    path: testFile,
    edits: [{
      old_text: 'foo',
      new_text: 'qux',
      occurrences: 2  // Actually has 3
    }]
  });
  
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('Expected 2 occurrences but found 3');
  
  // File should not be modified
  const content = await readFile(testFile, 'utf-8');
  expect(content).toBe('foo bar foo baz foo');
});
```

**Run test** - should already pass with current implementation.

**Commit**:
```bash
git add -A
git commit -m "test: add test for occurrence count validation"
```

---

### Task 6: Add Test and Implement Multiple Edits

**Goal**: Support multiple edits applied sequentially.

**Add test**:

```typescript
describe('Multiple Edit Operations', () => {
  it('should apply multiple edits sequentially', async () => {
    await writeFile(testFile, 'const a = 1;\nconst b = 2;', 'utf-8');
    
    const result = await tool.execute({
      path: testFile,
      edits: [
        {
          old_text: 'const',
          new_text: 'let',
          occurrences: 2
        },
        {
          old_text: 'let a',
          new_text: 'let x'
        }
      ]
    });
    
    expect(result.isError).toBe(false);
    const content = await readFile(testFile, 'utf-8');
    expect(content).toBe('let x = 1;\nlet b = 2;');
  });
});
```

**Run test** - should fail

**Implement** in `file-edit-v2.ts`:

```typescript
protected async executeValidated(
  args: FileEditArgs,
  context?: ToolContext
): Promise<ToolResult> {
  const resolvedPath = this.resolvePath(args.path, context);
  
  // Read file once
  let content: string;
  try {
    content = await readFile(resolvedPath, 'utf-8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return this.createError(`File not found: ${args.path}`);
    }
    throw error;
  }
  
  // Validate all edits first
  let workingContent = content;
  for (let i = 0; i < args.edits.length; i++) {
    const edit = args.edits[i];
    const occurrences = workingContent.split(edit.old_text).length - 1;
    const expectedOccurrences = edit.occurrences ?? 1;
    
    if (occurrences === 0) {
      return this.createError(
        `Edit ${i + 1} of ${args.edits.length}: No matches found for "${edit.old_text}"`
      );
    }
    
    if (occurrences !== expectedOccurrences) {
      return this.createError(
        `Edit ${i + 1} of ${args.edits.length}: Expected ${expectedOccurrences} occurrences but found ${occurrences}`
      );
    }
    
    // Simulate the edit for next validation
    workingContent = workingContent.split(edit.old_text).join(edit.new_text);
  }
  
  // Apply all edits
  workingContent = content;
  for (const edit of args.edits) {
    workingContent = workingContent.split(edit.old_text).join(edit.new_text);
  }
  
  // Write file once
  try {
    await writeFile(resolvedPath, workingContent, 'utf-8');
  } catch (error: unknown) {
    return this.createError(`Failed to write file: ${error}`);
  }
  
  return this.createResult(`Successfully applied ${args.edits.length} edits`);
}
```

**Run test** - should pass

**Commit**:
```bash
git add -A
git commit -m "feat: implement multiple sequential edits"
```

---

### Task 7: Add Enhanced Error Reporting

**Goal**: Provide detailed errors that help LLMs self-correct.

**Add test**:

```typescript
describe('Enhanced Error Reporting', () => {
  it('should provide detailed error with line numbers', async () => {
    const content = `line 1
line 2
line 3
line 2
line 5`;
    await writeFile(testFile, content, 'utf-8');
    
    const result = await tool.execute({
      path: testFile,
      edits: [{
        old_text: 'line 2',
        new_text: 'modified',
        occurrences: 1  // Actually has 2
      }]
    });
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Expected 1 occurrence');
    expect(result.content[0].text).toContain('found 2');
    expect(result.metadata?.validation_error).toBeDefined();
    expect(result.metadata?.validation_error?.match_locations).toHaveLength(2);
  });
});
```

**Add types** to `file-edit-v2.ts`:

```typescript
interface MatchLocation {
  line_number: number;
  column_start: number;
  line_content: string;
}

interface ValidationError {
  type: 'NO_MATCH' | 'WRONG_COUNT';
  edit_index: number;
  total_edits: number;
  expected_occurrences?: number;
  actual_occurrences?: number;
  match_locations?: MatchLocation[];
}
```

**Enhance error reporting**:

```typescript
private findMatchLocations(content: string, searchText: string): MatchLocation[] {
  const lines = content.split('\n');
  const locations: MatchLocation[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    let columnIndex = 0;
    while ((columnIndex = lines[i].indexOf(searchText, columnIndex)) !== -1) {
      locations.push({
        line_number: i + 1,
        column_start: columnIndex + 1,
        line_content: lines[i]
      });
      columnIndex += searchText.length;
    }
  }
  
  return locations;
}

// In executeValidated, enhance the error:
if (occurrences !== expectedOccurrences) {
  const locations = this.findMatchLocations(workingContent, edit.old_text);
  
  const errorMessage = `Edit ${i + 1} of ${args.edits.length}: Expected ${expectedOccurrences} occurrence${expectedOccurrences === 1 ? '' : 's'} but found ${occurrences}

Found '${edit.old_text}' at:
${locations.map(loc => `  Line ${loc.line_number}, column ${loc.column_start}: "${loc.line_content}"`).join('\n')}

Options to fix:
1. Update occurrences to ${occurrences} if you want to replace all instances
2. Add more context to make old_text unique to just the ${expectedOccurrences} you want`;

  return this.createError(errorMessage, {
    validation_error: {
      type: 'WRONG_COUNT',
      edit_index: i,
      total_edits: args.edits.length,
      expected_occurrences: expectedOccurrences,
      actual_occurrences: occurrences,
      match_locations: locations
    }
  });
}
```

**Run test** - should pass

**Commit**:
```bash
git add -A
git commit -m "feat: add enhanced error reporting with line numbers"
```

---

### Task 8: Add Dry Run Support

**Goal**: Allow previewing changes without modifying file.

**Add test**:

```typescript
describe('Dry Run Mode', () => {
  it('should not modify file in dry run mode', async () => {
    const originalContent = 'Hello World';
    await writeFile(testFile, originalContent, 'utf-8');
    
    const result = await tool.execute({
      path: testFile,
      dry_run: true,
      edits: [{
        old_text: 'World',
        new_text: 'Universe'
      }]
    });
    
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Dry run');
    expect(result.metadata?.dry_run).toBe(true);
    
    // File should not be modified
    const content = await readFile(testFile, 'utf-8');
    expect(content).toBe(originalContent);
  });
});
```

**Implement dry run**:

```typescript
// After validation, before applying edits:
if (args.dry_run) {
  return this.createResult(
    `Dry run completed. Would apply ${args.edits.length} edit${args.edits.length === 1 ? '' : 's'} to ${args.path}`,
    {
      dry_run: true,
      would_modify: true,
      edits_to_apply: args.edits
    }
  );
}
```

**Run test** - should pass

**Commit**:
```bash
git add -A
git commit -m "feat: add dry run mode support"
```

---

### Task 9: Add Context to Results

**Goal**: Include diff context in successful results (using existing type from file-edit.ts).

**Add test**:

```typescript
it('should include diff context in results', async () => {
  await writeFile(testFile, 'line 1\nline 2\nline 3', 'utf-8');
  
  const result = await tool.execute({
    path: testFile,
    edits: [{
      old_text: 'line 2',
      new_text: 'modified line'
    }]
  });
  
  expect(result.isError).toBe(false);
  expect(result.metadata?.diff).toBeDefined();
  expect(result.metadata?.diff?.oldContent).toContain('line 2');
  expect(result.metadata?.diff?.newContent).toContain('modified line');
});
```

**Copy the diff extraction logic** from existing `file-edit.ts` and add to successful result.

**Commit**:
```bash
git add -A  
git commit -m "feat: add diff context to results"
```

---

### Task 10: Add Edge Case Tests

**Goal**: Ensure tool handles edge cases correctly.

**Add tests**:

```typescript
describe('Edge Cases', () => {
  it('should handle empty file', async () => {
    await writeFile(testFile, '', 'utf-8');
    
    const result = await tool.execute({
      path: testFile,
      edits: [{
        old_text: 'foo',
        new_text: 'bar'
      }]
    });
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No matches found');
  });
  
  it('should preserve line endings', async () => {
    await writeFile(testFile, 'line1\r\nline2\r\nline3', 'utf-8');
    
    const result = await tool.execute({
      path: testFile,
      edits: [{
        old_text: 'line2',
        new_text: 'modified'
      }]
    });
    
    expect(result.isError).toBe(false);
    const content = await readFile(testFile, 'utf-8');
    expect(content).toBe('line1\r\nmodified\r\nline3');
  });
  
  it('should handle file not found', async () => {
    const result = await tool.execute({
      path: '/nonexistent/file.txt',
      edits: [{
        old_text: 'foo',
        new_text: 'bar'
      }]
    });
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('File not found');
  });
});
```

**Run tests** and fix any issues.

**Commit**:
```bash
git add -A
git commit -m "test: add edge case tests"
```

---

### Task 11: Add Performance Tests

**Goal**: Ensure tool performs well with large inputs.

**Add tests**:

```typescript
describe('Performance', () => {
  it('should handle many edits efficiently', async () => {
    // Create file with repeated pattern
    const content = Array(100).fill('foo').join('\n');
    await writeFile(testFile, content, 'utf-8');
    
    // Create 100 different edits
    const edits = Array(100).fill(null).map((_, i) => ({
      old_text: 'foo',
      new_text: `bar${i}`,
      occurrences: 1
    }));
    
    const start = Date.now();
    const result = await tool.execute({
      path: testFile,
      edits
    });
    const duration = Date.now() - start;
    
    expect(result.isError).toBe(false);
    expect(duration).toBeLessThan(1000); // Should complete in under 1 second
  });
  
  it('should refuse to edit very large files', async () => {
    // Create 101MB file (over 100MB limit)
    const largeContent = 'x'.repeat(101 * 1024 * 1024);
    await writeFile(testFile, largeContent, 'utf-8');
    
    const result = await tool.execute({
      path: testFile,
      edits: [{
        old_text: 'x',
        new_text: 'y',
        occurrences: 101 * 1024 * 1024
      }]
    });
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('File too large');
  });
});
```

**Add size check** to implementation:

```typescript
// After reading file:
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
if (content.length > MAX_FILE_SIZE) {
  return this.createError(`File too large: ${content.length} bytes (max ${MAX_FILE_SIZE} bytes)`);
}
```

**Commit**:
```bash
git add -A
git commit -m "feat: add file size limit and performance tests"
```

---

### Task 12: Integration Test

**Goal**: Test the tool in real scenarios.

**Create** `src/tools/implementations/file-edit-v2.integration.test.ts`:

```typescript
describe('Real-world scenarios', () => {
  it('should rename a variable throughout a TypeScript file', async () => {
    const tsContent = `
interface User {
  userId: string;
  userName: string;
}

function getUser(userId: string): User {
  console.log('Fetching user:', userId);
  return {
    userId: userId,
    userName: 'Test User'
  };
}

const userId = '123';
const user = getUser(userId);
console.log(user.userId);
`;
    
    await writeFile(testFile, tsContent, 'utf-8');
    
    const result = await tool.execute({
      path: testFile,
      edits: [{
        old_text: 'userId',
        new_text: 'userIdentifier',
        occurrences: 7
      }]
    });
    
    expect(result.isError).toBe(false);
    
    const newContent = await readFile(testFile, 'utf-8');
    expect(newContent).not.toContain('userId');
    expect(newContent).toContain('userIdentifier: string;');
    expect(newContent).toContain('getUser(userIdentifier)');
  });
});
```

**Run test** and ensure it passes.

**Commit**:
```bash
git add -A
git commit -m "test: add integration tests for real-world scenarios"
```

---

### Task 13: Replace Old Implementation

**Goal**: Update the existing file-edit.ts to use new implementation.

**Steps**:

1. **Backup old implementation**:
   ```bash
   cp src/tools/implementations/file-edit.ts src/tools/implementations/file-edit.old.ts
   ```

2. **Copy new implementation**:
   ```bash
   cp src/tools/implementations/file-edit-v2.ts src/tools/implementations/file-edit.ts
   ```

3. **Run existing tests**:
   ```bash
   npm run test:run -- src/tools/implementations/file-edit.test.ts
   ```

4. **Fix any compatibility issues** - the old tests should mostly pass

5. **Update imports** in any files that import file-edit types

**Commit**:
```bash
git add -A
git commit -m "feat: replace file-edit with enhanced version"
```

---

### Task 14: Documentation

**Goal**: Document the new tool for other developers.

**Create** `src/tools/implementations/file-edit.README.md`:

```markdown
# File Edit Tool

## Purpose
Edits files by making multiple text replacements with occurrence validation.

## Key Features
- Multiple edits in single operation
- Exact occurrence counting
- Sequential application
- Atomic operations (all or nothing)
- Dry run mode

## Usage

### Single Edit
```typescript
await tool.execute({
  path: '/src/app.ts',
  edits: [{
    old_text: 'console.log',
    new_text: 'logger.info'
  }]
});
```

### Multiple Edits with Occurrence Count
```typescript
await tool.execute({
  path: '/src/app.ts',
  edits: [
    {
      old_text: 'const',
      new_text: 'let',
      occurrences: 5  // Must find exactly 5
    },
    {
      old_text: 'require',
      new_text: 'import',
      occurrences: 3
    }
  ]
});
```

### Dry Run
```typescript
await tool.execute({
  path: '/src/app.ts',
  dry_run: true,
  edits: [...]
});
```

## Error Handling
The tool provides detailed errors with:
- Line numbers of all matches
- Suggestions for fixing
- No partial modifications

## Testing
Run tests:
```bash
npm run test:run -- src/tools/implementations/file-edit.test.ts
```
```

**Commit**:
```bash
git add -A
git commit -m "docs: add documentation for file-edit tool"
```

---

### Task 15: Final Cleanup

**Goal**: Remove temporary files and ensure everything works.

**Steps**:

1. **Delete temporary files**:
   ```bash
   rm src/tools/implementations/file-edit-v2.ts
   rm src/tools/implementations/file-edit-v2.test.ts
   rm src/tools/implementations/file-edit.old.ts
   ```

2. **Run all tests**:
   ```bash
   npm run test:run
   ```

3. **Run linter**:
   ```bash
   npm run lint
   ```

4. **Fix any issues**

**Final commit**:
```bash
git add -A
git commit -m "chore: cleanup temporary files"
```

---

## Testing Checklist

After each task, verify:
- [ ] Tests pass: `npm run test:run -- <test-file>`
- [ ] No TypeScript errors: `npm run typecheck`
- [ ] Linter passes: `npm run lint`
- [ ] Commit is made with descriptive message

## Common Issues and Solutions

### TypeScript Errors

**Problem**: "Type 'any' is not allowed"
**Solution**: Use `unknown` and type guards:
```typescript
catch (error: unknown) {
  if (error instanceof Error) {
    // Now error is typed as Error
  }
}
```

**Problem**: "Object is possibly 'null'"
**Solution**: Add null checks:
```typescript
if (result && result.metadata) {
  // Now TypeScript knows they're not null
}
```

### Test Issues

**Problem**: "Cannot mock functionality under test"
**Solution**: Use real file operations with temp directories:
```typescript
const testDir = await fs.mkdtemp(join(tmpdir(), 'test-'));
// Use testDir for real file operations
// Clean up in afterEach
```

**Problem**: Tests are slow
**Solution**: 
- Use smaller test files
- Run specific tests during development
- Use `.only` to focus on current test

### Git Issues

**Problem**: Large commit with many changes
**Solution**: Break into smaller commits:
```bash
git add src/tools/implementations/file-edit.ts
git commit -m "feat: add validation logic"
git add src/tools/implementations/file-edit.test.ts  
git commit -m "test: add validation tests"
```

## Summary

You're implementing a file editing tool that:
1. Takes multiple text replacements
2. Validates exact occurrence counts
3. Applies changes atomically
4. Provides detailed errors for AI self-correction

Remember:
- TDD: Test first, implement second
- No `any` types
- No mocking the functionality being tested
- Commit frequently
- Keep it simple (YAGNI)
- Don't repeat yourself (DRY)

The implementation should take about 8-10 hours following this plan step by step.