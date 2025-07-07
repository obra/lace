# Debug Tools

This document describes the debugging tools available for Lace development.

## debug-thread Tool

The `debug-thread` tool allows you to inspect thread conversations and analyze token usage without making API calls.

### Usage

```bash
# Build the project first
npm run build

# Show help (also shown when no args provided)
node dist/debug-thread.js --help
node dist/debug-thread.js

# Run debug-thread directly
node dist/debug-thread.js --thread-id <thread-id> --provider <provider> [options]

# Or use the npm script
npm run debug-thread -- --thread-id <thread-id> --provider <provider> [options]
```

### Options

- `-t, --thread-id <threadId>`: Thread ID to debug (required)
- `-p, --provider <provider>`: Provider to use for conversation format (required)
  - Available providers: `anthropic`, `openai`, `lmstudio`, `ollama`
- `-f, --format <format>`: Output format - `json` or `text` (default: `json`)
- `-o, --output <file>`: Output file path (defaults to stdout)

### Examples

#### JSON Output (Default)
```bash
node dist/debug-thread.js --thread-id lace_20250706_abc123 --provider anthropic
```

This outputs a JSON structure with:
- Thread metadata (ID, canonical ID, provider)
- Token count analysis
- Provider-specific conversation format
- Raw events from the thread

#### Text Output (Human Readable)
```bash
node dist/debug-thread.js --thread-id lace_20250706_abc123 --provider anthropic --format text
```

This outputs a human-readable format with:
- Thread summary
- Token count breakdown
- Complete conversation messages (never truncated)
- Full raw event list with pretty-printed JSON

#### Save to File
```bash
node dist/debug-thread.js --thread-id lace_20250706_abc123 --provider anthropic --format text --output debug-report.txt
```

### Output Structure

#### JSON Format
```json
{
  "threadId": "lace_20250706_abc123",
  "canonicalId": "lace_20250706_abc123",
  "provider": "anthropic",
  "format": "json",
  "eventCount": 15,
  "tokenCounts": {
    "estimated": 1250,
    "breakdown": {
      "userMessages": 300,
      "agentMessages": 650,
      "toolCalls": 150,
      "toolResults": 100,
      "systemPrompts": 50
    }
  },
  "conversation": [
    {
      "role": "user",
      "content": "Hello, can you help me debug this code?"
    },
    {
      "role": "assistant",
      "content": [
        { "type": "text", "text": "I'd be happy to help..." },
        { "type": "tool_use", "id": "call_123", "name": "file_read", "input": {...} }
      ]
    }
  ],
  "rawEvents": [...]
}
```

#### Text Format
```
Thread Debug Report
==================
Thread ID: lace_20250706_abc123
Canonical ID: lace_20250706_abc123
Provider: anthropic
Event Count: 15

Token Counts:
  Estimated Total: 1250
  Breakdown:
    User Messages: 300
    Agent Messages: 650
    Tool Calls: 150
    Tool Results: 100
    System Prompts: 50

Conversation (anthropic format):
========================================
Message 1 (user):
  Hello, can you help me debug this code?

Message 2 (assistant):
  Block 1 (text):
    I'd be happy to help you debug your code. Let me first read the file to understand what you're working with...
  Block 2 (tool_use):
    Tool Use ID: call_123
    Tool Name: file_read
    Tool Input: {
      "path": "/path/to/file.js"
    }
    
  Tool Calls: 1
    1. file_read:
       Input: {
         "path": "/path/to/file.js"
       }

...
```

### Token Counting

The tool provides token estimates using the same estimation logic as the main application:
- Rough approximation: 1 token ≈ 4 characters
- Counts are broken down by event type
- No API calls are made - all estimates are local

### Provider-Specific Formats

The tool converts the generic `ProviderMessage` format to provider-specific formats:

- **Anthropic**: Uses content blocks with `tool_use` and `tool_result` blocks
- **OpenAI**: Uses the generic format (conversion not yet implemented)
- **LMStudio/Ollama**: Uses the generic format

### Use Cases

1. **Debugging Compaction**: Analyze token usage before and after compaction
2. **Conversation Analysis**: Understand how conversations are structured for each provider
3. **Tool Usage Inspection**: See how tool calls and results are formatted
4. **Event Debugging**: Examine raw event sequences for conversation reconstruction issues

### Limitations

- Token counts are estimates only (no actual API calls)
- OpenAI-specific formatting not yet implemented
- Requires access to the Lace database file
- Thread must exist in the database

### Integration with Compaction System

This tool is particularly useful for debugging the compaction system:

1. **Before Compaction**: Run on original thread to see full conversation
2. **After Compaction**: Run on compacted thread to see summarized version
3. **Compare**: Use the canonical ID to track threads across compactions

Example workflow:
```bash
# Debug original thread
node dist/debug-thread.js --thread-id lace_20250706_abc123 --provider anthropic --format text --output before-compaction.txt

# After compaction, debug the new thread
node dist/debug-thread.js --thread-id lace_20250706_def456 --provider anthropic --format text --output after-compaction.txt

# Compare the two files to see what changed
diff before-compaction.txt after-compaction.txt
```