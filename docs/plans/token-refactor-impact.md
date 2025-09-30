# Token Usage Type Refactoring - Impact Analysis

## Scope

- **41 references** to CombinedTokenUsage  
- **13 files** importing or using the type
- **3 files** actually accessing `.thread.` fields

## Files Affected

### Core Package (10 files)
1. `token-management/types.ts` - Type definitions
2. `agents/agent.ts` - Creates CombinedTokenUsage in AGENT_MESSAGE events
3. `threads/token-aggregation.ts` - Extracts from events
4. `helpers/base-helper.ts` - **Accumulates thread totals** (billing use case!)
5. `agents/agent-token.test.ts` - Tests CombinedTokenUsage structure
6. `threads/token-aggregation.test.ts` - Tests with sample data
7. `threads/types.test.ts` - Accesses thread field
8. `threads/types.ts` - Type imports
9. `helpers/types.ts` - Type imports
10. `tools/types.ts` - Type imports

### Web Package (3 files)
1. `hooks/useAgentTokenUsage.ts` - **Reads thread field for footer**
2. `lib/server/session-service.ts` - Type imports
3. `types/core.ts` - Re-exports types

## Key Usage Patterns

### Pattern 1: Creating TokenUsage (agent.ts:940-988)
```typescript
const agentMessageTokenUsage: CombinedTokenUsage = {
  message: { promptTokens, completionTokens, totalTokens },
  thread: threadTokenUsage  // Currently: cumulative sum
};
```

### Pattern 2: Reading for UI (useAgentTokenUsage.ts:78-97)
```typescript
const threadData = tokenUsageData?.thread;
setTokenUsage({
  totalTokens: threadData.totalTokens  // Displays in footer
});
```

### Pattern 3: Accumulating for Billing (base-helper.ts:146-151)
```typescript
totalUsage.thread.totalPromptTokens += response.usage.promptTokens;
totalUsage.thread.totalTokens += response.usage.totalTokens;
// This is BILLING tracking, not context tracking!
```

## Critical Insight

`base-helper.ts` is the ONLY place that actually needs cumulative totals!
- It's tracking cost/billing for helper API calls
- UI should NEVER see this - it wants current context

## Proposed Solution

```typescript
interface TurnTokenUsage {
  inputTokens: number;    // THIS turn's input
  outputTokens: number;   // THIS turn's output  
  totalTokens: number;
}

interface ContextWindowUsage {
  currentTokens: number;  // Would be sent if user types now
  limit: number;
  percentUsed: number;
  nearLimit: boolean;
}

interface BillingMetrics {
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeTotalTokens: number;
  apiCallCount: number;
}

interface TokenUsageMetrics {
  turn: TurnTokenUsage;          // This API call
  context: ContextWindowUsage;   // Current window (UI)
  billing?: BillingMetrics;      // Optional cumulative (helpers only)
}
```

## Migration Path

1. Add new fields alongside old (backwards compatible)
2. Update writers (agent.ts, base-helper.ts)
3. Update readers (useAgentTokenUsage.ts, etc.)
4. Remove old fields
5. Run full test suite

Next: Detailed file-by-file changes
