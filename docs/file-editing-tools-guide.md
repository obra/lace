# File Editing Tools Guide for Lace

## Overview

This guide provides implementation details and best practices for using Lace's file editing tools with various LLM providers. The tools are designed to work reliably across different AI models by being explicit and deterministic.

## Available Tools

### 1. `file_edit` - Search and Replace
- **Purpose**: Replace exact text matches in files
- **Key requirement**: Text must match exactly (including whitespace)
- **Use case**: Modifying existing code, changing implementations

### 2. `file_insert` - Add Content
- **Purpose**: Insert new content at specific lines or append to files
- **Key feature**: Preserves existing content
- **Use case**: Adding new functions, imports, or sections

### 3. `file_read` - View Content (existing)
- **Purpose**: Read file contents with optional line ranges
- **Use case**: Inspecting code before editing

### 4. `file_write` - Create/Overwrite (existing)
- **Purpose**: Create new files or completely overwrite existing ones
- **Use case**: Creating new files from scratch

## Prompting Strategy for LLMs

To ensure LLMs use these tools effectively, include these guidelines in your system prompt:

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

## Examples:

Editing a function:
1. file_read { "path": "src/main.js" }
2. file_edit { 
     "path": "src/main.js",
     "old_text": "function oldName() {\n  return 42;\n}",
     "new_text": "function newName() {\n  return 100;\n}"
   }

Adding an import:
1. file_insert {
     "path": "src/main.js", 
     "content": "import { helper } from './utils.js';",
     "line": 3
   }
```

## Implementation Details

### Tool Registration

Add these tools to your tool registry:

```typescript
import { FileEditTool } from './tools/implementations/file-edit.js';
import { FileInsertTool } from './tools/implementations/file-insert.js';

// In your initialization code:
toolRegistry.register(new FileEditTool());
toolRegistry.register(new FileInsertTool());
```

### Error Handling Patterns

The tools provide specific error messages to guide LLMs:

1. **No matches found**: Guides to check exact text matching
2. **Multiple matches**: Suggests adding more context
3. **Line out of bounds**: Provides file length information
4. **Invalid input**: Clear parameter requirements

### Integration with Different Providers

These tools work with any provider that supports tool calling:

- **Anthropic**: Native tool support
- **LMStudio**: Via OpenAI-compatible API
- **Ollama**: With tool calling models
- **OpenAI**: Direct compatibility

### Performance Considerations

1. **Atomic operations**: Each tool call is a single file operation
2. **No streaming**: File operations complete before returning
3. **Validation first**: Input validation happens before file access
4. **Clear feedback**: Success/failure messages include actionable details

## Testing Strategy

Both tools include comprehensive test suites covering:

- Happy path scenarios
- Multi-line replacements
- Edge cases (empty files, missing files)
- Input validation
- Error messages

Run tests with:
```bash
npm test file-edit
npm test file-insert
```

## Common Patterns

### 1. Refactoring a function
```javascript
// Read -> Edit multiple times
1. Read the file
2. Replace function signature
3. Replace function body
4. Update call sites
```

### 2. Adding a new feature
```javascript
// Insert at different locations
1. Insert imports at top
2. Insert new function in appropriate section
3. Insert exports if needed
```

### 3. Fixing bugs
```javascript
// Precise replacements
1. Read to find exact buggy code
2. Replace with fixed version
3. Verify with another read
```

## Limitations and Workarounds

1. **No regex support**: Use exact text matching
   - Workaround: Read file, identify exact text, then edit

2. **Single occurrence requirement**: Can't replace all occurrences at once
   - Workaround: Multiple tool calls for each occurrence

3. **Line-based insertion**: Can't insert at arbitrary positions
   - Workaround: Use file_edit to replace a larger block

## Future Enhancements

Potential additions to consider:

1. `file_delete_lines`: Remove specific line ranges
2. `file_replace_all`: Replace all occurrences
3. `file_patch`: Apply unified diff patches
4. `file_search_replace`: Regex-based replacements

These would require careful design to maintain LLM-friendliness and cross-provider compatibility.