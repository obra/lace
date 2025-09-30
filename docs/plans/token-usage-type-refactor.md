# Token Usage Type Refactoring Plan

## Problem

Current `CombinedTokenUsage.thread` field is ambiguous:
- **What it contains**: Cumulative billing totals (sum of all API calls)
- **What UI uses it for**: Current context window usage
- **Result**: Footer shows 48K when actual context is 14K

## Proposed New Structure

```typescript
// What was sent/received THIS turn
interface TurnTokenUsage {
  inputTokens: number;       // Tokens sent to API this turn
  outputTokens: number;      // Tokens received from API this turn
  totalTokens: number;       // inputTokens + outputTokens
}

// Current context window state (for UI)
interface ContextWindowUsage {
  currentTokens: number;      // What would be sent if user types now
  limit: number;              // Model's context window size
  percentUsed: number;        // currentTokens / limit
  nearLimit: boolean;         // percentUsed >= 0.8
}

// Cumulative spend across all turns (for billing/analytics)
interface CumulativeSpend {
  totalInputTokens: number;   // Sum of all inputs ever sent
  totalOutputTokens: number;  // Sum of all outputs ever received
  totalTokens: number;        // Total API spend
  turnCount: number;          // Number of API calls made
}

// Combined for AGENT_MESSAGE events
interface TokenUsageMetrics {
  turn: TurnTokenUsage;              // This specific turn
  context: ContextWindowUsage;       // Current window state
  cumulative?: CumulativeSpend;      // Optional billing data
}
```

## Impact Analysis

### Files to Search:
1. Type definitions: `token-management/types.ts`
2. Event creation: `agents/agent.ts` (creates AGENT_MESSAGE)
3. Event reading: `hooks/useAgentTokenUsage.ts` (frontend)
4. Event reading: `threads/token-aggregation.ts`
5. Helpers: `helpers/base-helper.ts`
6. Tests: All files using CombinedTokenUsage

### Migration Strategy

1. **Add new types** alongside old ones (no breaking change yet)
2. **Add new fields** to CombinedTokenUsage while keeping old ones
3. **Update writers** to populate both old and new fields
4. **Update readers** to prefer new fields, fall back to old
5. **Remove old fields** after verification

## Search Commands

```bash
# Find all CombinedTokenUsage usage
grep -rn "CombinedTokenUsage" packages/core/src packages/web

# Find thread field access
grep -rn "\.thread\." packages/core/src packages/web

# Find ThreadTokenUsage usage
grep -rn "ThreadTokenUsage" packages/core/src packages/web
```