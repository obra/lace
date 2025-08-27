# Helper Agents Implementation

This document provides an overview of the helper agents system implemented in this branch.

## Overview

Helper agents provide lightweight LLM task execution outside normal conversation workflows. They enable "calling an AI like a function" - you provide a task, it executes (possibly using tools), and returns a consolidated result.

## Architecture

The helper system consists of:

- **BaseHelper**: Abstract base class with core execution logic
- **InfrastructureHelper**: For system-level tasks (bypasses user approval)  
- **SessionHelper**: For agent sub-tasks (respects user approval policies)
- **HelperFactory**: Static factory methods for type-safe helper creation
- **HelperRegistry**: Centralized helper lifecycle management

## Key Features

### 🔧 Two Security Models

**InfrastructureHelper:**
- Explicit tool whitelisting
- Bypasses user approval system
- For trusted system operations

**SessionHelper:**
- Inherits tools from parent agent
- Respects session approval policies
- For agent-spawned sub-tasks

### 🎯 Multi-turn Execution

Helpers support multi-turn LLM conversations internally but return a single consolidated result:

```typescript
const result = await helper.execute('Analyze error patterns in logs');
// result.content: "Found 3 critical errors..."
// result.toolCalls: [{ name: 'ripgrep-search', ... }, ...]
// result.toolResults: [{ status: 'completed', ... }, ...]
// result.tokenUsage: { totalTokens: 1250, ... }
```

### 🏭 Factory Pattern

Type-safe helper creation:

```typescript
// Infrastructure helper
const infraHelper = HelperFactory.createInfrastructureHelper({
  model: 'smart',
  tools: ['file-read', 'ripgrep-search']
});

// Session helper  
const sessionHelper = HelperFactory.createSessionHelper({
  model: 'fast',
  parentAgent: this
});
```

### 📊 Centralized Management

Registry for helper lifecycle tracking:

```typescript
const registry = new HelperRegistry();

const helper = registry.createInfrastructureHelper('analysis-task', {
  model: 'smart',
  tools: ['file-read']
});

// Later...
registry.removeHelper('analysis-task');
```

## Implementation Status

✅ **Phase 1-6 Complete:**
- BaseHelper abstract class with multi-turn execution
- InfrastructureHelper with tool whitelisting
- SessionHelper with agent context inheritance
- HelperFactory with type-safe creation methods
- HelperRegistry with lifecycle management
- Comprehensive test coverage (50 tests)

✅ **Phase 7 Complete:**
- Usage documentation and API guide
- Practical code examples and patterns  
- Integration examples for all system components
- Complete documentation with troubleshooting

## Documentation

### Core Documentation
- **[Helper Agents Guide](./guides/helper-agents.md)** - Comprehensive usage guide
- **[Code Examples](./examples/helper-patterns.ts)** - Practical implementation patterns
- **[Integration Examples](./examples/integration-examples.md)** - Real-world system integration

### Quick Start

```typescript
import { InfrastructureHelper, SessionHelper } from '@lace/core';

// System task
const infraHelper = new InfrastructureHelper({
  model: 'smart',
  tools: ['file-read', 'ripgrep-search']
});

const result = await infraHelper.execute('Analyze error patterns in logs');
console.log(result.content); // Analysis results

// Agent sub-task (inside an agent)
const sessionHelper = new SessionHelper({
  model: 'fast', 
  parentAgent: this
});

const summary = await sessionHelper.execute('Summarize this URL: ' + url);
```

## Use Cases

### Infrastructure Helpers
- **Memory System**: Analyze conversation patterns for user insights
- **Error Analysis**: Intelligent log analysis and error categorization
- **Task Creation**: Convert natural language to structured tasks
- **System Diagnostics**: Health monitoring and performance analysis

### Session Helpers  
- **URL Summarization**: Process web content during conversations
- **Data Analysis**: Complex data processing with user approval
- **Code Review**: Analyze code snippets with inherited tools
- **Content Processing**: Transform user-provided content

## Testing

The system includes comprehensive testing:

- **Unit Tests**: Individual component behavior (BaseHelper, Factory, Registry)
- **Integration Tests**: Cross-component interactions and real-world patterns
- **E2E Tests**: Complete workflow validation with real tools

Run tests:
```bash
npm test src/helpers/  # All helper tests (50 tests)
npm test               # Full test suite (1468 tests)
```

## Performance

- **Model Tiers**: Choose `fast` for simple tasks, `smart` for complex analysis
- **Tool Whitelisting**: Explicit security boundaries for infrastructure helpers
- **Resource Tracking**: Token usage monitoring and reporting
- **Concurrent Limits**: Registry supports helper lifecycle management

## Architecture Benefits

1. **Clean Separation**: Clear boundaries between system and session operations
2. **Type Safety**: Full TypeScript support with validated schemas
3. **Tool Security**: Explicit whitelisting vs inherited policies
4. **Testability**: Real implementations testable with controlled inputs
5. **Extensibility**: Factory pattern supports future helper types
6. **Resource Management**: Registry provides centralized lifecycle control

## Future Enhancements

The helper system is designed for extensibility:

- **Custom Helper Types**: Factory pattern supports new helper implementations
- **Advanced Registry**: Metrics, performance monitoring, resource limits
- **Tool Categories**: More sophisticated tool organization and permissions
- **Streaming Support**: Real-time helper execution results
- **Batch Operations**: Concurrent helper execution with scheduling

## API Reference

### InfrastructureHelper
```typescript
new InfrastructureHelper({
  model: 'fast' | 'smart',
  tools: string[],           // Required whitelist
  workingDirectory?: string,
  processEnv?: NodeJS.ProcessEnv,
  abortSignal?: AbortSignal
})
```

### SessionHelper
```typescript
new SessionHelper({
  model: 'fast' | 'smart', 
  parentAgent: Agent,       // Required for context inheritance
  abortSignal?: AbortSignal
})
```

### HelperResult
```typescript
interface HelperResult {
  content: string;           // Final LLM response
  toolCalls: ToolCall[];     // All tools that were called
  toolResults: ToolResult[]; // Results from tool executions
  tokenUsage?: CombinedTokenUsage;
}
```

The helper agents system provides a robust, type-safe foundation for lightweight LLM task execution across Lace's infrastructure and agent workflows.