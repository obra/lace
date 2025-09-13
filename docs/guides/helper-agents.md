# Helper Agents Guide

Helper agents provide lightweight LLM task execution outside the normal conversation workflow. Think of them as "calling an AI like a function" - you give it a task, it completes it (possibly using tools), and returns a result.

## Overview

The helper system consists of two main types:

- **InfrastructureHelper**: For Lace's internal systems (bypasses user approval)
- **SessionHelper**: For agents spawning sub-tasks (respects user approval policies)

Both types support multi-turn LLM execution internally but return a single consolidated result to their caller.

## Quick Start

```typescript
import { InfrastructureHelper, SessionHelper, HelperFactory } from '@lace/core';

// Infrastructure helper for system tasks
const infraHelper = HelperFactory.createInfrastructureHelper({
  model: 'smart', // 'fast' or 'smart'
  tools: ['file-read', 'ripgrep-search']
});

// Session helper within an agent
const sessionHelper = HelperFactory.createSessionHelper({
  model: 'fast', // 'fast' or 'smart'
  parentAgent: this
});

const result = await infraHelper.execute('Analyze the error patterns in the logs');
console.log(result.content); // The analysis
console.log(result.toolCalls); // Tools that were used
console.log(result.tokenUsage); // Token consumption
```

## InfrastructureHelper

Use infrastructure helpers when Lace's internal systems need to perform LLM tasks programmatically.

### Security Model

- **Explicit whitelist**: Only tools in the `tools` array can be used
- **No user approval**: Bypasses approval system entirely  
- **Trust boundary**: Calling code is responsible for tool safety

### Basic Usage

```typescript
const helper = new InfrastructureHelper({
  model: 'fast' | 'smart',           // Model tier to use
  tools: ['tool1', 'tool2'],         // Whitelisted tools only
  workingDirectory?: '/path/to/dir', // Optional working directory
  processEnv?: { VAR: 'value' },     // Optional environment variables
  abortSignal?: controller.signal    // Optional cancellation
});

const result = await helper.execute('Task description');
```

### Common Patterns

**Memory System Analysis:**
```typescript
const memoryHelper = new InfrastructureHelper({
  model: 'smart',
  tools: ['ripgrep-search', 'file-read'],
  workingDirectory: conversationLogDir
});

const insights = await memoryHelper.execute(
  'Analyze the last 10 conversations and identify recurring user patterns'
);
```

**Error Analysis:**
```typescript
const errorHelper = new InfrastructureHelper({
  model: 'smart',
  tools: ['ripgrep-search', 'file-read'],
  workingDirectory: logDirectory
});

const errorAnalysis = await errorHelper.execute(
  'Search for error patterns in .log files and categorize them by severity'
);
```

**Task Creation from Natural Language:**
```typescript
const taskHelper = new InfrastructureHelper({
  model: 'fast',
  tools: ['task-create']
});

await taskHelper.execute(`Create tasks for: ${userRequest}`);
```

## SessionHelper

Use session helpers when agents need to spawn sub-tasks during conversation flow.

### Security Model

- **Inherited policies**: Uses parent session's tool policies
- **Normal approval**: Goes through standard approval workflow
- **Session context**: Inherits working directory, tools, etc.

### Basic Usage

```typescript
// Inside an agent
const helper = new SessionHelper({
  model: 'fast' | 'smart',           // Model tier to use
  parentAgent: this,                 // Current agent instance
  abortSignal?: controller.signal    // Optional cancellation
});

const result = await helper.execute('Sub-task description');
```

### Common Patterns

**URL Summarization:**
```typescript
// Inside agent handling user message with URL
const helper = new SessionHelper({
  model: 'fast',
  parentAgent: this
});

const summary = await helper.execute(`Summarize the content at ${url}`);
// Use summary in agent response
```

**Data Analysis:**
```typescript
const helper = new SessionHelper({
  model: 'smart', // Use smart model for complex analysis
  parentAgent: this
});

const analysis = await helper.execute(
  `Analyze this data and provide key insights:\n${complexData}`
);
```

**Code Review:**
```typescript
const helper = new SessionHelper({
  model: 'smart',
  parentAgent: this
});

const review = await helper.execute(
  `Review this code for potential issues:\n${codeContent}`
);
```

## Helper Registry

For centralized helper lifecycle management:

```typescript
import { HelperRegistry } from '@lace/core';

const registry = new HelperRegistry();

// Create and track helpers
const helper1 = registry.createInfrastructureHelper('memory-task', {
  model: 'smart',
  tools: ['file-read', 'ripgrep-search']
});

const helper2 = registry.createSessionHelper('url-summary', {
  model: 'fast',
  parentAgent: agent
});

// Manage helpers
console.log(registry.getActiveHelperIds()); // ['memory-task', 'url-summary']
console.log(registry.getHelperType('memory-task')); // 'infrastructure'

// Cleanup
registry.removeHelper('memory-task');
registry.clearAll();
```

## Configuration

Create `~/.lace/config.json` (see docs/examples/config.json for a full template).  
Each model string is `<providerInstanceId>:<modelId>` (e.g. `anthropic-default:claude-3-5-sonnet-20241022`):

```json
{
  "defaultModels": {
    "fast": "anthropic-default:claude-3-5-haiku-20241022",
    "smart": "anthropic-default:claude-3-5-sonnet-20241022"  
  }
}
```

If this configuration is missing, helper creation will throw with a clear error.  
Ensure both `~/.lace/config.json` and `~/.lace/provider-instances.json` exist.

## Error Handling

Helpers are resilient - tool failures don't break execution:

```typescript
const result = await helper.execute('Complex task');

// Check overall execution
if (result.content.includes('error')) {
  console.log('Task had issues but completed');
}

// Check individual tool results
for (const toolResult of result.toolResults) {
  if (toolResult.status === 'failed') {
    const msg =
      Array.isArray(toolResult.content)
        ? toolResult.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join(' ').trim()
        : String(toolResult.content ?? '');
    console.error(`Tool ${toolResult.toolCallId} failed: ${msg}`);
  }
}

// Check token usage
if (result.tokenUsage) {
  console.log(`Used ${result.tokenUsage.totalTokens} tokens`);
}
```

## Performance Considerations

**Model Selection:**
- Use `fast` models for simple tasks (summarization, formatting)
- Use `smart` models for complex analysis or reasoning tasks

**Tool access:**
- Infrastructure helpers require explicit tool whitelisting
- Only include tools actually needed for the task
- Session helpers inherit tools from parent agent

**Resource Management:**
- Helpers are lightweight - create as needed
- Use registry for long-lived helper management
- Clean up helpers when tasks complete

## Testing Helpers

Always test with real implementations:

```typescript
describe('Helper Integration', () => {
  it('should process real tasks', async () => {
    const helper = new InfrastructureHelper({
      model: 'fast',
      tools: ['file-read'],
      workingDirectory: testDataDir
    });

    const result = await helper.execute('Read and summarize test-file.txt');
    
    expect(result.content).toContain('summary');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolResults[0].status).toBe('completed');
  });
});
```

**Don't mock the helpers themselves** - test real behavior with controlled inputs.

## Architecture Notes

- **Multi-turn execution**: Helpers can make multiple LLM calls internally
- **Single result**: Always return one consolidated HelperResult
- **Stateless**: Each helper execution is independent
- **Tool inheritance**: Session helpers inherit from parent agents
- **Provider abstraction**: Works with any configured AI provider

## Troubleshooting

**Configuration Issues:**
- Ensure `~/.lace/config.json` exists with proper model mappings
- Check provider instances are configured in `~/.lace/provider-instances.json`

**Tool Execution:**
- Infrastructure helpers: Check tool is in whitelist
- Session helpers: Check parent agent has required tools
- Verify working directory permissions for file operations

**Performance:**
- Monitor token usage with `result.tokenUsage`
- Use appropriate model tier for task complexity
- Consider tool execution time in timeout planning