# Lace Project Guidelines

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
