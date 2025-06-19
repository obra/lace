# Terminal UI Token Counter Not Working with Anthropic Models

## Summary
The terminal UI's token counter displays "0 tokens" instead of actual token usage when using Anthropic models. The counter works correctly for other providers but fails to update for Anthropic.

## Root Cause Analysis

### 1. Missing Token Budget Configuration
The Agent is created without a `tokenBudget` configuration in `src/cli.ts` line 145:

```typescript
const agent = new Agent({
  provider,
  toolExecutor,
  threadManager,
  threadId,
  tools: toolExecutor.getAllTools(),
  // tokenBudget: undefined - missing token budget config
});
```

This results in `this._tokenBudgetManager` being `null` in the Agent class.

### 2. Token Usage Only Emitted Through Budget Manager
Token usage information is only emitted via the `token_budget_warning` event, which requires an active `TokenBudgetManager`:

**Agent.ts lines 326-336:**
```typescript
// Record token usage if budget tracking is enabled
if (this._tokenBudgetManager) {
  this._tokenBudgetManager.recordUsage(processedResponse);

  // Emit warning if approaching budget limits
  const recommendations = this._tokenBudgetManager.getRecommendations();
  if (recommendations.warningMessage) {
    this.emit('token_budget_warning', {
      message: recommendations.warningMessage,
      usage: this._tokenBudgetManager.getBudgetStatus(),
      recommendations,
    });
  }
}
```

### 3. Terminal Interface Expects Usage Updates
The terminal interface (`src/interfaces/terminal/terminal-interface.tsx`) correctly listens for token updates but only receives them through `token_budget_warning` events:

```typescript
const handleTokenBudgetWarning = ({ usage }: { usage: any }) => {
  if (usage && typeof usage === 'object') {
    setTokenUsage({
      promptTokens: usage.promptTokens || usage.prompt_tokens,
      completionTokens: usage.completionTokens || usage.completion_tokens,
      totalTokens: usage.totalTokens || usage.total_tokens,
    });
  }
};
```

### 4. Anthropic Provider Returns Correct Usage Data
The Anthropic provider (`src/providers/anthropic-provider.ts`) correctly returns usage information in both streaming and non-streaming responses:

```typescript
usage: response.usage
  ? {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    }
  : undefined,
```

## Proposed Solutions

### Option 1: Always Emit Token Usage (Recommended)
Add a new `token_usage_update` event that fires regardless of budget management status:

1. **In Agent class**, emit usage after recording:
```typescript
// Record token usage if budget tracking is enabled
if (this._tokenBudgetManager) {
  this._tokenBudgetManager.recordUsage(processedResponse);
  // ... existing budget warning logic
}

// Always emit token usage for UI updates
if (processedResponse.usage) {
  this.emit('token_usage_update', { usage: processedResponse.usage });
}
```

2. **In Terminal Interface**, listen for the new event:
```typescript
const handleTokenUsageUpdate = ({ usage }: { usage: any }) => {
  setTokenUsage({
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
  });
};

agent.on("token_usage_update", handleTokenUsageUpdate);
```

### Option 2: Default Token Budget Configuration
Enable token budget management by default with reasonable limits, ensuring the existing code path works.

### Option 3: Separate Token Counter
Create a lightweight token usage tracker separate from budget management for UI display purposes.

## Files Affected
- `src/agents/agent.ts` - Agent class token usage emission
- `src/interfaces/terminal/terminal-interface.tsx` - Terminal UI event handling
- `src/cli.ts` - Agent configuration (if using Option 2)

## Testing
- [ ] Verify token counter updates with Anthropic models
- [ ] Ensure existing budget management functionality still works
- [ ] Test with other providers (OpenAI, LMStudio, Ollama)
- [ ] Verify counter works in both streaming and non-streaming modes

## Priority
**Medium** - UI functionality issue that affects user experience but doesn't break core functionality.