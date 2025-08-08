# File Edit Tool

## Purpose
Edits files by making multiple text replacements with occurrence validation.

## Key Features
- Multiple edits in single operation
- Exact occurrence counting
- Sequential application
- Atomic operations (all or nothing)
- Dry run mode
- Enhanced error reporting for LLM self-correction

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
- Similar content suggestions for typos
- Specific difference analysis (whitespace, case, content)
- Actionable suggestions for fixing
- No partial modifications

## Sequential Processing
Edits are applied in order, with each edit seeing the results of previous edits:

```typescript
// This works as expected:
await tool.execute({
  path: '/src/app.ts',
  edits: [
    { old_text: 'const x', new_text: 'let x' },  // Changes 'const x' to 'let x'
    { old_text: 'let x = 1', new_text: 'let x = 100' } // Now finds 'let x = 1'
  ]
});
```

## API Schema

```typescript
interface EditOperation {
  old_text: string;          // Exact text to find and replace
  new_text: string;          // Replacement text
  occurrences?: number;      // Expected number of occurrences (default: 1)
}

interface FileEditArgs {
  path: string;              // File path (absolute or relative)
  edits: EditOperation[];    // Array of edit operations (minimum 1)
  dry_run?: boolean;         // Preview changes without applying (default: false)
}
```

## Testing
Run tests:
```bash
npm run test:run -- src/tools/file-edit-context.test.ts
npm run test:run -- src/tools/file-edit-actual.test.ts
```

## Error Types

### NO_MATCH
When text is not found, provides:
- Similar content with similarity scores
- Specific difference analysis (whitespace, case, punctuation)
- Suggestions like "use file_read to see exact content"

### WRONG_COUNT
When occurrence count doesn't match, provides:
- Line numbers and column positions of all matches
- Context lines before and after each match
- Suggestions to adjust count or add more context

### Enhanced Error Example
```
Edit 1 of 2: Could not find exact text in /src/app.ts.

Searched for (between >>>markers<<<):
>>>console.log('hello')<<<

File contains similar content that might be what you're looking for:

Line 15: console.log("hello")
  Difference: punctuation - expected ''hello'', found '"hello"'

Line 23: console.log('hello world')  
  Difference: content - expected 'hello', found 'hello world'

Suggestions:
Use file_read to see the exact content, then copy it precisely
  Example: Include all whitespace, tabs, and line breaks exactly as they appear
Check for tabs vs spaces - copy the exact whitespace from the file
```