# Production Code Deduplication Plan

## Analysis Summary

After filtering out test files and JSON fixtures, there are **65 production code duplicates** across the agent package. This plan addresses the most impactful duplications.

### Duplication by Category

| Category | Lines Duplicated | Files Involved |
|----------|-----------------|----------------|
| Provider implementations | ~130 lines | 5 files |
| Workspace managers | ~58 lines | 2 files |
| runner.ts ↔ job-tools.ts | ~51 lines | 2 files |
| RPC handlers | ~100+ lines | 6 files |
| runner.ts internal | ~80+ lines | 1 file |

---

## Phase 1: Provider Shared Utilities

**Problem**: Multiple providers have duplicated helper functions and patterns.

### Task 1.1: Extract `getTextContent()` helper

**Files**: `lmstudio-provider.ts`, `ollama-provider.ts`

Both files have identical helper:
```typescript
function getTextContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}
```

**Action**:
- Create `providers/utils/content-helpers.ts` with shared `getTextContent()`
- Import in both providers

**Impact**: ~14 lines removed

### Task 1.2: Extract Ollama connection validation

**File**: `ollama-provider.ts` (lines 100-148 and 230-278)

The `complete()` and `stream()` methods have 49 identical lines for:
- Connection diagnostics check
- Model availability check
- Message conversion setup

**Action**:
- Extract private method `prepareRequest(messages, model)` that handles validation and message conversion
- Return `{ diagnostics, ollamaMessages }` ready for API call

**Impact**: ~40 lines removed

---

## Phase 2: Workspace Command Execution

**Problem**: `local-workspace-manager.ts` and `worktree-workspace-manager.ts` have nearly identical `runCommand()` implementations (42 lines each).

### Task 2.1: Extract shared command execution

**Files**: `workspace/local-workspace-manager.ts`, `workspace/worktree-workspace-manager.ts`

**Action**:
- Create `workspace/command-runner.ts` with shared `executeCommand()` function
- Both managers import and use it

**Impact**: ~35 lines removed

---

## Phase 3: Runner ↔ Job Tools Consolidation

**Problem**: `runner.ts` has inline job tool implementations that duplicate `job-tools.ts`.

### Task 3.1: Audit runner.ts job tool usage

**Files**: `core/conversation/runner.ts`, `core/tools/special/job-tools.ts`

The runner has methods like `executeJobListTool()` (lines 906-931) that duplicate `executeJobList()` in job-tools.ts.

**Action**:
- Determine if runner.ts should call job-tools.ts instead of duplicating
- If yes, refactor runner to use job-tools.ts functions
- If architectural constraints prevent this, document why

**Impact**: ~50 lines removed (if consolidation is possible)

---

## Phase 4: RPC Handler Patterns

### Task 4.1: Connection lookup helper

**Problem**: `models.ts` and `connections.ts` repeatedly lookup instances by connectionId with identical error handling.

**Pattern** (appears 5+ times):
```typescript
const connectionId = toNonEmptyString(parsed?.connectionId);
if (!connectionId) throwInvalidParams('connectionId is required');
const instances = await state.providerInstances.loadInstances();
const instance = instances.instances[connectionId];
if (!instance)
  throw {
    code: EntErrorCodes.ConnectionNotFound,
    message: 'ConnectionNotFound',
    data: { category: 'provider' },
  };
```

**Action**:
- Create `rpc/helpers/connection-lookup.ts` with `getConnectionInstance(state, connectionId)` helper
- Throws appropriate errors if not found
- Returns validated instance

**Impact**: ~50 lines removed

### Task 4.2: Session validation guards

**Problem**: Many handlers repeat the same session validation.

**Pattern** (appears 8+ times):
```typescript
assertInitialized(state);
if (!state.activeSession)
  throw { code: AcpErrorCodes.SessionNotFound, message: 'SessionNotFound', data: { category: 'session' } };
if (state.activeTurn)
  throw { code: AcpErrorCodes.SessionBusy, message: 'SessionBusy', data: { category: 'session' } };
```

**Action**:
- Create `rpc/helpers/session-guards.ts` with:
  - `assertActiveSession(state)` - throws if no session
  - `assertNotBusy(state)` - throws if turn active
  - `assertSessionReady(state)` - combines both

**Impact**: ~40 lines removed

---

## Phase 5: Provider Catalog Validation

### Task 5.1: Provider catalog lookup helper

**Problem**: `models.ts` handlers repeatedly load catalog and lookup provider.

**Pattern** (appears 3+ times):
```typescript
await ensureProviderCatalogLoaded(state);
const providerId = instance.catalogProviderId;
const provider = state.providerCatalog.getProvider(providerId);
if (!provider) throw { code: EntErrorCodes.ProviderError, ... };
```

**Action**:
- Create helper `getProviderForConnection(state, instance)`
- Handles catalog loading and provider lookup
- Throws if not found

**Impact**: ~25 lines removed

---

## Execution Order

1. **Phase 1** (Provider utilities) - Low risk, isolated changes
2. **Phase 2** (Workspace) - Low risk, clear extraction
3. **Phase 4** (RPC helpers) - Medium risk, touches multiple handlers
4. **Phase 5** (Catalog helpers) - Low risk, builds on Phase 4
5. **Phase 3** (Runner consolidation) - Higher risk, needs careful analysis

---

## Expected Results

| Metric | Before | After (Expected) |
|--------|--------|------------------|
| Clones | 350 | ~320 |
| Duplication % | 8.17% | ~7.5% |
| Lines duplicated | 4759 | ~4400 |

---

## Notes

- Phase 3 (runner.ts consolidation) needs investigation to understand why runner has its own job tool implementations
- Some RPC handler duplication may be intentional for clarity - don't over-abstract
- Provider consolidation is limited by different API contracts (Anthropic SDK vs Ollama REST vs LMStudio SDK)
