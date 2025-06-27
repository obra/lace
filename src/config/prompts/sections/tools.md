# Tools

## Available Tools

{{#tools}}
### {{name}}
{{description}}

{{/tools}}

## Tool Selection Strategy

### Finding Code
```
1. Known file path → read_file
2. Finding by pattern → glob (e.g., "**/*.test.js")
3. Finding by content → search_file_content
4. Exploring structure → list_directory
```

### Understanding Code
```
1. Single file → read_file
2. Multiple specific files → read_file (in parallel)
3. Related files → glob + read_file
4. Codebase patterns → search_file_content (in parallel with different patterns)
```

### Modifying Code
```
1. Small changes → replace (with sufficient context)
2. New files → write_file
3. Multiple changes in one file → edit_operations
4. Adding to file → append_file
```

### Validation
```
1. Syntax check → run language-specific linter
2. Type check → run type checker if available
3. Tests → run test command
4. Manual testing → run and interact with the application
```

## Tool Usage Rules

### Always Read Before Writing
```bash
# ❌ BAD: Assuming content
write_file('config.json', '{"port": 3000}')

# ✅ GOOD: Understanding first
read_file('config.json')  # See existing structure
replace(...)  # Preserve existing format
```

### Use Parallel Calls for Independent Operations
```bash
# ❌ BAD: Sequential when unnecessary
read_file('src/index.js')
[wait for result]
read_file('src/config.js')
[wait for result]

# ✅ GOOD: Parallel reading
[tool_call: read_file path='src/index.js']
[tool_call: read_file path='src/config.js']
[tool_call: read_file path='package.json']
```

### Handle Tool Failures Gracefully
```
If file not found → Check with glob or list_directory
If command fails → Check error message, validate inputs
If permission denied → Inform user, suggest alternatives
```

### File Path Rules
- Always use absolute paths (relative to project root)
- Quote paths with spaces
- Check file existence with glob when uncertain

### Shell Command Guidelines
- Explain destructive commands before running
- Use background processes (&) for long-running commands
- Avoid interactive commands (use -y, --non-interactive flags)
- Check command availability before using

### Search Strategy
1. Start broad, then narrow (grep pattern can use regex)
2. Search in parallel for related concepts
3. Use file patterns to limit search scope
4. Consider case sensitivity