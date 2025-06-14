# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Lace Project Guidelines

Lace is a lightweight agentic coding environment that implements an orchestrator-driven agent system with multi-generational memory management. It provides a rich terminal interface for AI-powered development tasks using Claude AI models.

## Development Commands

```bash
# Primary Development
npm start              # Run interactive Lace UI
npm run ui            # Alternative to start
npm run dev           # Development mode with auto-restart

# Testing
npm test              # Run both mocked and integration tests
npm run test:watch    # Watch mode for tests
npm run test:with-mocks # Unit tests with mocks
npm run test:no-mocks # Integration tests with real APIs

# Code Quality
npm run lint          # ESLint code checking
npm run format        # Prettier code formatting
npm run typecheck     # TypeScript type checking
npm run dead-code     # Knip unused code detection

# Single Test Execution
npm test -- --testNamePattern="test name"
npm run test:with-mocks -- --testPathPattern="path/to/test"
```

## High-Level Architecture

### Orchestrator-Driven Agent System

- **Primary Agent (Orchestrator)**: Uses powerful models (Claude Sonnet) for task analysis and coordination
- **Specialized Subagents**: Planning, Execution, Reasoning, Memory agents with model selection optimized for task type
- **Model Selection**: Orchestrator chooses appropriate models - expensive for complex tasks, fast (Haiku) for simple execution
- **Multi-Provider Support**: Built for Anthropic (current), with architecture for OpenAI and local models

### Multi-Generational Memory Management

- **Generational Handoffs**: When context approaches limits, agents spawn new generations with compressed context
- **Memory Oracles**: Previous agent generations kept alive as queryable historical context
- **SQLite Persistence**: Full conversation history stored in `lace-memory.db`
- **Context Optimization**: Configurable caching strategies and context utilization

### Core System Components

#### Agent System (`/src/agents/`)
- `agent.ts` - Core agent class with reasoning, tool calls, context management
- `agent-registry.ts` - Agent role definitions and registration
- `roles/` - Specialized agent role implementations

#### Model System (`/src/models/`)
- `model-registry.ts` - Provider registration and model definition storage
- `providers/anthropic-provider.ts` - Anthropic API integration
- Abstract provider pattern for multi-model support

#### Tool System (`/src/tools/`)
- `tool-registry.ts` - Plugin-style tool management with registration
- `base-tool.ts` - Abstract base class for all tools
- Individual tools: `shell.ts`, `read-file.ts`, `write-file.ts`, `javascript.ts`

#### UI System (`/src/ui/`)
- **Entry Points**: `lace-cli.js` (CLI), `lace-ui.ts` (main UI class), `App.tsx` (React component)
- **Rich Terminal Interface**: React + Ink with syntax highlighting, diff highlighting, search
- **Components**: ConversationView, Message, ShellInput, StatusBar, ToolApprovalModal
- **Tab Completion**: Commands and file paths

#### Database Layer (`/src/database/`)
- `conversation-db.js` - SQLite-based persistent conversation storage
- Tables: conversations, agent_generations, sessions
- Full history with context summaries and queryable interactions

### Key Patterns

1. **File Structure**: All files start with 2-line `ABOUTME:` comments explaining purpose
2. **Delegation Over Inheritance**: Orchestrator delegates to specialized agents
3. **Plugin Architecture**: Tools as plugins registered in central registry
4. **Context Management**: Multi-generational memory with compression and handoffs
5. **ESM Modules**: `"type": "module"` with proper import/export throughout

### Testing Strategy

- **Dual Configurations**: `jest.config.js` (with-mocks) and `jest.integration.config.js` (no-mocks)
- **Comprehensive Mocking**: Extensive `__mocks__` directory structure
- **ESM + TypeScript**: Complex Jest setup for mixed module system
- **API Key Requirements**: Integration tests need Anthropic API key in `~/.lace/api-keys/anthropic`

## Conversation Configuration

The Lace agent system supports configurable conversation memory and caching behavior:

### Configuration Options

```typescript
interface ConversationConfig {
  historyLimit?: number;        // Max messages to retrieve from history (default: 10)
  contextUtilization?: number;  // Fraction of context window to use (default: 0.7)
  cachingStrategy?: 'aggressive' | 'conservative' | 'disabled'; // Cache strategy (default: 'aggressive')
  freshMessageCount?: number;   // Number of recent messages to keep fresh (default: 2)
}
```

### Caching Strategies

- **aggressive**: Cache all but the last 2 messages for maximum performance
- **conservative**: Cache all but the last 3 messages for balanced performance/freshness  
- **disabled**: No prompt caching applied to conversation history

### Usage

```javascript
// Configure during agent creation
const agent = new Agent({
  conversationConfig: {
    historyLimit: 15,
    contextUtilization: 0.8,
    cachingStrategy: 'conservative',
    freshMessageCount: 3
  }
});

// Update configuration at runtime
agent.updateConversationConfig({
  cachingStrategy: 'disabled',
  historyLimit: 5
});

// Get current configuration
const config = agent.getConversationConfig();
```

## TypeScript Migration Strategy

This project is progressively migrating from JavaScript to TypeScript while maintaining ESM modules.

### Current Setup

- **Module System**: ESM (`"type": "module"` in package.json)
- **Build Tool**: tsx for handling mixed JS/TS files
- **Migration Approach**: Progressive - new files in TS, existing files migrated gradually

### File Extensions

- `.js` - Existing JavaScript files (keep during migration)
- `.ts` - New TypeScript files
- `.jsx` - React components in JavaScript (will become `.tsx`)
- `.tsx` - React components in TypeScript (preferred for new UI)

### Migration Priority

1. **New files**: Always write in TypeScript
2. **UI Components**: Convert to `.tsx` with proper prop types
3. **Agent System**: High value for typing - orchestration, tool registry
4. **Tool System**: Type safety critical for tool parameters
5. **Database/Models**: Structured data benefits from interfaces
6. **Utilities**: Convert as needed when touching files

### TypeScript Configuration

- `allowJs: true` - Permits .js files alongside .ts
- `strict: false` initially - Tighten as migration progresses
- `jsx: "react-jsx"` - For React components without import React

### Development Commands

- `npm run ui` - Run Ink UI with tsx
- `npm run typecheck` - Check types without building
- Mixed file imports work seamlessly with tsx

### Best Practices

- Start new features in TypeScript
- Add types when modifying existing files
- Use interfaces for agent messages, tool schemas, conversation data
- Proper typing especially valuable for the complex agent orchestration system

## Project-Specific Conventions

### ABOUTME Comments
All code files must start with a brief 2-line comment explaining what the file does:
```javascript
// ABOUTME: This file handles agent orchestration and task delegation
// ABOUTME: Coordinates between different specialized agent roles
```

### Important File Requirements
- **API Keys**: Anthropic API key must be in `~/.lace/api-keys/anthropic` for integration tests
- **Database**: SQLite database `lace-memory.db` stores conversation persistence
- **Node Version**: Requires Node.js 18.0.0+ for ESM and modern features

### Testing Approach
- Use `npm run test:with-mocks` for fast unit tests during development
- Use `npm run test:no-mocks` for full API testing (requires API key)
- Both test suites must pass for production readiness
- Complex ESM + TypeScript Jest configuration handles mixed file types
