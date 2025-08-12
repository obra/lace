# Token Counting Architecture

## Overview

Lace implements a comprehensive token counting and budget management system that works seamlessly with the event-sourcing architecture and compaction system. This document describes how token tracking works across the system, particularly how it handles compaction events.

## Core Principles

1. **Single Source of Truth**: TokenBudgetManager is the authoritative source for current token usage
2. **Event-Driven**: All token tracking follows the event-sourcing pattern
3. **Compaction-Aware**: The system properly handles token counts when conversation history is compacted
4. **Proactive Management**: Token limits are enforced before making API calls to prevent exhaustion

## Architecture Components

### TokenBudgetManager (`src/token-management/token-budget-manager.ts`)

The central component responsible for:
- Tracking cumulative token usage across conversation lifetime
- Enforcing token budgets and providing warnings
- Handling compaction events to maintain accurate counts
- Providing usage information to other components

**Key Methods:**
- `recordUsage(response: ProviderResponse)`: Records tokens from AI provider responses
- `handleCompaction(compactionData: CompactionData)`: Resets counts and applies summary tokens
- `getTokenUsage()`: Returns current usage statistics
- `getBudgetStatus()`: Returns budget enforcement information

### Agent Token API (`src/agents/agent.ts`)

The Agent class provides a clean public API for token usage information:

```typescript
interface AgentTokenUsage {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  contextLimit: number;
  percentUsed: number;
  nearLimit: boolean;
  eventCount?: number;
}

getTokenUsage(): AgentTokenUsage
```

This encapsulates access to the TokenBudgetManager and provides a stable interface for external consumers.

### Token Aggregation (`src/threads/token-aggregation.ts`)

Utility functions for analyzing token usage from event sequences:

- `aggregateTokenUsage(events: ThreadEvent[])`: Compaction-aware token counting
- `estimateConversationTokens(events: ThreadEvent[])`: Token estimation when usage data unavailable

**Compaction Logic**: Only counts tokens from:
1. Summary events from the most recent compaction
2. Events that occurred after the most recent compaction

## Data Flow

### Normal Operation
```
User Input → Agent → Provider API → ProviderResponse with usage → TokenBudgetManager.recordUsage()
```

### Compaction Flow
```
TokenBudgetManager reaches threshold → Triggers compaction → Agent receives COMPACTION event → 
Agent.handleCompaction() → TokenBudgetManager.handleCompaction(compactionData) → 
Resets usage to only include summary tokens
```

### Token Usage Queries
```
External System → Agent.getTokenUsage() → TokenBudgetManager.getUsageInfo() → AgentTokenUsage
```

## Compaction Integration

### Problem Solved
Before this architecture, the system had two parallel token tracking systems that didn't communicate:
- ThreadManager's `aggregateTokenUsage()` counted all events including originals + summaries
- TokenBudgetManager tracked usage but didn't understand compaction
- Token counts grew indefinitely even after compaction
- Neither system was compaction-aware

### Solution
1. **Unified Tracking**: TokenBudgetManager is the single source of truth
2. **Compaction Awareness**: Both Agent and TokenBudgetManager understand compaction events
3. **Proper Reset Logic**: Token counts reset to only include summary + post-compaction events
4. **Clean APIs**: External code uses Agent.getTokenUsage(), never accesses internals

### Compaction Event Handling

When a COMPACTION event is processed:

1. **Agent Detection**: Agent detects COMPACTION event in `handleCompaction()`
2. **Notification**: Agent calls `TokenBudgetManager.handleCompaction(compactionData)`
3. **Reset**: TokenBudgetManager resets internal counters to zero
4. **Summary Processing**: Extracts token usage from `compactionData.compactedEvents`
5. **New Baseline**: Usage now reflects only summary + any post-compaction events

```typescript
// Example compaction data
const compactionData: CompactionData = {
  strategyId: 'summarize',
  originalEventCount: 50,
  compactedEvents: [
    {
      type: 'AGENT_MESSAGE',
      data: {
        content: 'Summary of conversation',
        tokenUsage: {
          promptTokens: 300,
          completionTokens: 200, 
          totalTokens: 500
        }
      }
    }
  ]
};
```

### Token Aggregation Compaction Logic

The `aggregateTokenUsage()` function implements compaction-aware counting:

```typescript
// Find most recent COMPACTION event
let lastCompactionIndex = -1;
for (let i = events.length - 1; i >= 0; i--) {
  if (events[i].type === 'COMPACTION') {
    lastCompactionIndex = i;
    break;
  }
}

if (lastCompactionIndex >= 0) {
  // Count only:
  // 1. Summary events from the compaction
  // 2. Events after the compaction
} else {
  // No compaction, count all events
}
```

## Integration Points

### Session API (`packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.ts`)

Web interface queries token usage via Agent API:

```typescript
const sessionInstance = await Session.getById(asThreadId(sessionId));
const mainAgent = sessionInstance.getAgent(sessionInstance.getId());
const agentUsage = mainAgent.getTokenUsage();

tokenUsage = {
  totalPromptTokens: agentUsage.totalPromptTokens,
  totalCompletionTokens: agentUsage.totalCompletionTokens,
  totalTokens: agentUsage.totalTokens,
  contextLimit: agentUsage.contextLimit,
  percentUsed: agentUsage.percentUsed,
  nearLimit: agentUsage.nearLimit,
  eventCount: agentUsage.eventCount || 0
};
```

### Provider Integration

All AI providers (Anthropic, OpenAI, etc.) return standardized `ProviderResponse` objects:

```typescript
interface ProviderResponse {
  content: string;
  toolCalls: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
```

The Agent automatically records this usage with TokenBudgetManager after each provider response.

## Configuration

### TokenBudgetManager Configuration

```typescript
interface TokenBudgetConfig {
  maxTokens: number;           // Maximum tokens allowed
  warningThreshold: number;    // Warning threshold (0-1)
  reserveTokens: number;       // Reserve buffer
}
```

### Model Context Limits

Token budgets are automatically initialized based on model context windows:
- Claude-3.5-Sonnet: 200,000 tokens
- GPT-4: 128,000 tokens  
- Custom models: Configurable

## Error Handling and Edge Cases

### Missing Usage Data
- Providers may not return usage data
- System falls back to token estimation
- Estimation uses conservative 4 chars/token ratio

### Multiple Compactions  
- Only the most recent compaction matters
- Previous summaries are ignored
- Post-compaction events are always counted

### Empty Compactions
- Some compaction strategies may produce empty summaries
- System handles empty `compactedEvents` arrays gracefully
- Only post-compaction events are counted in this case

### Negative Token Values
- Invalid provider responses are handled gracefully
- Negative values are ignored or clamped to zero
- System maintains non-negative token counts

## Testing Strategy

### Unit Tests
- TokenBudgetManager: Comprehensive usage tracking and compaction handling
- Agent: Token API and compaction integration  
- TokenAggregation: Compaction-aware event processing

### Integration Tests
- Agent + TokenBudgetManager: Full token lifecycle
- Session API: Web interface integration
- Compaction: End-to-end compaction workflows

### Key Test Scenarios
1. **Basic Usage**: Normal token recording and reporting
2. **Compaction Reset**: Proper count reset after compaction
3. **Multiple Compactions**: Only latest compaction counts
4. **Post-Compaction**: Continued tracking after compaction
5. **Empty Summaries**: Handling compaction with no summary events
6. **API Integration**: Web interface token usage queries

## Best Practices

### For Developers

1. **Always use Agent.getTokenUsage()**: Never access TokenBudgetManager directly
2. **Handle missing usage**: Provider responses may not include token counts
3. **Respect budget limits**: Check `canMakeRequest()` before API calls
4. **Test compaction scenarios**: Ensure your code works after compaction

### For Token Management

1. **Set appropriate budgets**: Consider model context limits and reserve buffers
2. **Monitor usage**: Use warnings to trigger compaction before limits
3. **Configure thresholds**: Balance between compaction frequency and efficiency
4. **Handle edge cases**: Plan for missing data and provider inconsistencies

## Migration Notes

This architecture replaces the previous dual-tracking system where:
- ThreadManager and TokenBudgetManager tracked tokens separately
- Neither understood compaction events  
- Token counts continued growing after compaction
- External code accessed internal token tracking state

### Breaking Changes
- External code must use `Agent.getTokenUsage()` instead of accessing internals
- `TokenBudgetManager.handleCompaction()` now takes `CompactionData` instead of number
- `aggregateTokenUsage()` now implements compaction-aware logic

### Migration Path
1. Update all token usage queries to use `Agent.getTokenUsage()`
2. Remove direct access to TokenBudgetManager internals
3. Ensure compaction events are properly routed to TokenBudgetManager
4. Update tests to reflect new compaction-aware behavior

## Performance Considerations

- **Event Processing**: Compaction logic processes events in reverse for efficiency
- **Memory Usage**: Token tracking has minimal memory overhead  
- **Query Performance**: Token usage queries are O(1) operations
- **Compaction Impact**: Token reset during compaction is fast and atomic

## Future Enhancements

- **Token Budgets per Model**: Different limits for different AI models
- **Historical Usage**: Tracking usage trends over time
- **Cost Tracking**: Integration with provider pricing models
- **Predictive Compaction**: Trigger compaction based on usage velocity