# Token Usage Type Consolidation Plan

## Executive Summary
Consolidate 4+ fragmented token usage types into 2 canonical types in `src/token-management/types.ts` with ZERO backward compatibility. Remove vanity metrics (`eventCount`, `lastCompactionAt`) that don't drive user or compaction decisions.

## New Canonical Types (to be created in `src/token-management/types.ts`)

### 1. `MessageTokenUsage` - For individual message/request token counts
```typescript
export interface MessageTokenUsage {
  promptTokens: number;        // Tokens in this specific message's prompt
  completionTokens: number;    // Tokens in this specific message's completion  
  totalTokens: number;         // promptTokens + completionTokens for this message
}
```

### 2. `ThreadTokenUsage` - For cumulative thread-level token tracking
```typescript
export interface ThreadTokenUsage {
  // Cumulative totals across all messages in thread
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  
  // Context management
  contextLimit: number;
  percentUsed: number;
  nearLimit: boolean;
}
```

### 3. `CombinedTokenUsage` - For contexts needing both
```typescript
export interface CombinedTokenUsage {
  message?: MessageTokenUsage;    // Current message token usage
  thread: ThreadTokenUsage;       // Thread-level cumulative usage
}
```

## Types to Remove

### `src/token-management/types.ts`
- ❌ **Remove** `TokenUsage` interface (lines 10-22)
- ❌ **Remove** `TokenUsageInfo` interface (lines 42-59)

### `src/agents/agent.ts` 
- ❌ **Remove** `AgentTokenUsage` interface

### `packages/web/types/api.ts`
- ❌ **Remove** anonymous `tokenUsage` type in `AgentResponse` (lines 101-110)

## Vanity Metrics to Remove
- ❌ **Remove** `eventCount` - Vanity metric that doesn't drive user or compaction decisions
- ❌ **Remove** `lastCompactionAt` - Not displayed to users and doesn't affect compaction logic

## Type Usage Replacements

### Core Package (`src/`)

**Files using `TokenUsage`:**
1. `src/agents/agent.ts` - Replace with `CombinedTokenUsage`, remove `eventCount`/`lastCompactionAt` usage
2. `src/threads/types.ts` - Replace with `CombinedTokenUsage`
3. `src/token-management/token-budget-manager.ts` - Replace with `ThreadTokenUsage`, remove vanity metrics
4. `src/token-management/stop-reason-handler.ts` - Replace with `MessageTokenUsage`
5. `src/threads/token-aggregation.ts` - Replace with `ThreadTokenUsage`, remove vanity metrics
6. `src/threads/token-aggregation.test.ts` - Update test types, remove vanity metric tests
7. `src/agents/agent-token-api.test.ts` - Update test types, remove vanity metric tests

**Files using `TokenUsageInfo`:**
1. `src/token-management/token-budget-manager.ts` - Replace with `ThreadTokenUsage`, remove vanity metrics

**Files using `AgentTokenUsage`:**
1. `src/agents/agent.ts` - Replace with `ThreadTokenUsage`, remove vanity metrics

### Web Package (`packages/web/`)

**Files using `TokenUsage`:**
1. `packages/web/lib/server/session-service.ts` - Replace with `CombinedTokenUsage`
2. `packages/web/components/pages/LaceApp.tsx` - Replace with `ThreadTokenUsage`  
3. `packages/web/hooks/useAgentTokenUsage.ts` - Replace with `ThreadTokenUsage`, remove vanity metrics
4. `packages/web/types/core.ts` - Remove export, import from core instead
5. `packages/web/app/api/agents/[agentId]/route.ts` - Replace with `ThreadTokenUsage`, remove vanity metrics
6. `packages/web/app/api/agents/[agentId]/__tests__/route.test.ts` - Update test types, remove vanity metrics

**Files using anonymous tokenUsage type:**
1. `packages/web/types/api.ts` - Replace with `ThreadTokenUsage`, remove vanity metrics
2. `packages/web/types/api.test.ts` - Update test types, remove vanity metrics
3. `packages/web/app/api/compaction.e2e.test.ts` - Replace with `ThreadTokenUsage`, remove vanity metrics
4. `packages/web/app/api/compaction-simple.test.ts` - Replace with `ThreadTokenUsage`, remove vanity metrics
5. `packages/web/app/api/compaction-integration.test.ts` - Replace with `ThreadTokenUsage`, remove vanity metrics
6. `packages/web/app/api/agents/[agentId]/__tests__/route.test.ts` - Replace with `ThreadTokenUsage`, remove vanity metrics

**Files using `AgentTokenUsage`:**
1. `packages/web/components/pages/LaceApp.tsx` - Replace with `ThreadTokenUsage`, remove vanity metrics
2. `packages/web/hooks/useAgentTokenUsage.ts` - Replace with `ThreadTokenUsage`, remove vanity metrics

**UI Components (likely using `totalPromptTokens` pattern):**
1. `packages/web/components/ui/TokenUsageDisplay.stories.tsx` - Replace with `ThreadTokenUsage`, remove vanity metrics
2. `packages/web/components/ui/TokenUsageDisplay.tsx` - Replace with `ThreadTokenUsage`, remove vanity metrics

## Additional Cleanup Required

### Remove eventCount/lastCompactionAt Usage
Need to search codebase for all references to these fields and remove:
- All code that calculates or tracks `eventCount`
- All code that sets or reads `lastCompactionAt`  
- All UI that displays these metrics
- All tests that verify these metrics
- All logging that includes these metrics

### Search Patterns to Find All Usage:
```bash
grep -r "eventCount" src/ packages/web/
grep -r "lastCompactionAt" src/ packages/web/
```

## Migration Sequence

### Phase 1: Create New Types
1. Add new canonical types to `src/token-management/types.ts`
2. Export them from `packages/web/types/core.ts`

### Phase 2: Update Core Package
1. Replace all core usages with new types
2. Remove `eventCount`/`lastCompactionAt` from all calculations
3. Update agent events to use new types
4. Update tests, remove vanity metric assertions

### Phase 3: Update Web Package  
1. Replace all web usages with new types
2. Remove vanity metrics from API endpoints
3. Update UI components, remove vanity metric displays
4. Update tests, remove vanity metric assertions

### Phase 4: Remove Old Types and Vanity Metrics
1. Delete old type definitions
2. Remove all `eventCount`/`lastCompactionAt` code
3. Verify no remaining references

## Breaking Changes
- **All existing code using these types will break** ✅ (This is intentional)
- **API response formats will change** - Web clients must update
- **Event payload formats will change** - SSE consumers must update  
- **UI displays will change** - eventCount/lastCompactionAt will disappear
- **Database/persistence formats may change** - Migration might be needed

## Benefits After Migration
- ✅ Single source of truth for token types
- ✅ Clear separation between message vs thread token usage  
- ✅ No more field name confusion (`maxTokens` vs `contextLimit`)
- ✅ Consistent optional/required fields across codebase
- ✅ Type safety improvements
- ✅ Easier maintenance and future changes
- ✅ Removal of vanity metrics that don't drive decisions
- ✅ Cleaner UI focused on actionable token information

---

**Total Estimated Files to Modify: ~25-30 files**
**Additional Cleanup Files: ~15-20 files for vanity metric removal**