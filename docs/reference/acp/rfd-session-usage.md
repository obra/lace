# ACP RFD: Session Usage and Context Status

Source: https://agentclientprotocol.com/rfds/session-usage.md

## Problem

ACP lacks standardized mechanisms for agents to communicate:
- Token usage per turn
- Context window status (cumulative)
- Cost information
- Prompt caching metrics

Clients cannot display resource consumption or warn users about context limits.

## Proposed Solution

### Token Usage in PromptResponse

Per-turn token breakdowns in `session/prompt` result:

```typescript
interface Usage {
  total_tokens: number;        // required
  input_tokens: number;        // required
  output_tokens: number;       // required
  thought_tokens?: number;     // optional - extended thinking tokens
  cached_read_tokens?: number; // optional - cache hit tokens
  cached_write_tokens?: number;// optional - cache write tokens
}
```

### Context Window via session/update

Agents push context window data through `session/update` notification with `type: "usage_update"`:

```typescript
interface UsageUpdate {
  type: "usage_update";
  used: number;   // tokens currently in context
  size: number;   // total context window size
  cost?: {
    amount: number;
    currency: string;  // ISO 4217 (e.g., "USD")
  };
}
```

## Design Rationale

### Separation of Concerns

- **Per-turn usage**: Tied to specific prompt/response pairs. Reported in `PromptResponse`.
- **Context window**: Cumulative session state. Pushed proactively via notifications.

This separation reflects different use cases:
- "How much did that response cost?" vs "How full is my context?"

### Agent-Pushed Notifications

Agents send `usage_update` when data becomes available rather than requiring client polling. This allows:
- Immediate updates after compaction
- Updates when agent calculates context size
- No polling overhead

### Optional Cost Reporting

Cost tracking is optional because:
- Not all providers expose pricing
- Some agents don't track costs
- Currency handling is complex

## Client Implementation Guidelines

### Derived Values

Clients compute from raw data:
- Remaining tokens: `size - used`
- Percentage: `(used / size) * 100`

### Warning Thresholds

Recommended visual indicators:
- **< 75%**: Normal (green/neutral)
- **75-90%**: Warning (yellow)
- **90-95%**: Alert (orange)
- **> 95%**: Critical (red) - risk of context overflow

### Handling Missing Data

- If agent doesn't send `usage_update`, client shows "unknown"
- Cost field optional - don't require it

## Schema Changes Required

### PromptResponse.usage

```typescript
const UsageSchema = z.object({
  total_tokens: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  thought_tokens: z.number().optional(),
  cached_read_tokens: z.number().optional(),
  cached_write_tokens: z.number().optional(),
});
```

### SessionUpdate.usage_update

```typescript
const UsageUpdateSchema = z.object({
  type: z.literal('usage_update'),
  used: z.number(),     // current context tokens
  size: z.number(),     // max context window
  cost: z.object({
    amount: z.number(),
    currency: z.string(),
  }).optional(),
});
```

## Timing

Agents should send `usage_update`:
- After initialization (once context size is known)
- After each turn completes
- After compaction operations
- When context size changes significantly

## Status

Draft (updated 2025-12-19)
