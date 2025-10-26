# Claude Agent SDK Provider - Remaining Fixes

## Issues Found During Testing

### 1. Session Creation Validation Bug (High Priority - Blocks Testing)

**Issue:** Session creation fails with validation error when tool policies are configured.

**Error Message:**
```
HTTP 400: Validation failed: tools: Expected array, received object
```

**Root Cause:**
- `SessionConfigurationSchema` expects `tools: z.array(z.string()).optional()` (line 13 in `session-config.ts`)
- UI is sending `toolPolicies` object in the configuration
- Schema validation fails because it receives object instead of array

**Location:**
- Schema: `packages/core/src/sessions/session-config.ts:13`
- API: `packages/web/app/routes/api.projects.$projectId.sessions.ts`

**Impact:**
- Cannot create new sessions with tool policies configured
- Affects ALL providers, not just SDK provider
- Existing sessions with old model IDs cannot be replaced with new sessions

**Fix Options:**

**Option A: Fix Schema (Recommended)**
Update `SessionConfigurationSchema` to handle `toolPolicies` as object:
```typescript
// In session-config.ts
export const SessionConfigurationSchema = z.object({
  maxTokens: z.number().int().positive().optional(),
  compactionStrategy: z.string().optional(),
  permissionOverrideMode: z.enum(['normal', 'yolo', 'read-only']).optional(),
  tools: z.array(z.string()).optional(),
  toolPolicies: z.record(z.enum(['allow', 'deny', 'ask'])).optional(), // ADD THIS
  environmentVariables: z.record(z.string()).optional(),
  providerInstanceId: z.string().optional(),
  modelId: z.string().optional(),
  workspaceMode: z.enum(['container', 'local']).optional(),
  initialMessage: z.string().optional(),
});
```

**Option B: Fix UI**
Stop sending `toolPolicies` in configuration, send `tools` array instead.

**Testing:**
```bash
# After fix, verify session creation works
# In browser: Create new session with SDK provider and tool policies
# Should succeed without validation error
```

---

### 2. Existing Sessions Have Invalid Model IDs (Medium Priority)

**Issue:** Sessions created before model ID update have `claude-sonnet-4` instead of `default`.

**Error:**
```
[ERROR] Failed to create provider instance for agent {
  "modelId":"claude-sonnet-4",
  "error":"Model not found in catalog: claude-sonnet-4 for provider claude-agents-sdk"
}
[WARN] AGENT: Initialization incomplete - no provider
```

**Root Cause:**
- Old model IDs were: `claude-sonnet-4`, `claude-opus-4`, `claude-haiku-4`
- Updated to SDK's actual IDs: `default`, `opus`, `sonnet[1m]`
- Existing session `lace_20251002_q5dtq6` has old model ID in database

**Location:**
- Session config stored in: SQLite database (`sessions` table)
- Model validation: `packages/core/src/providers/registry.ts:230-235`

**Impact:**
- Existing SDK provider sessions cannot initialize
- Agent fails to load on session reconstruction
- Cannot send messages until model ID is updated

**Workaround:**
1. Reload browser page
2. Edit session configuration in UI
3. Change model from dropdown to "Default (Sonnet 4.5)"
4. Save configuration
5. Reload page again to force session reconstruction

**Permanent Fix:**
Add migration or fallback mapping for old model IDs:
```typescript
// In claude-sdk-provider.ts or registry.ts
function normalizeSDKModelId(modelId: string): string {
  const migrations: Record<string, string> = {
    'claude-sonnet-4': 'default',
    'claude-opus-4': 'opus',
    'claude-haiku-4': 'default', // No haiku equivalent, use default
  };
  return migrations[modelId] || modelId;
}
```

---

### 3. Model Refresh in UI (Low Priority - Already Working)

**Status:** ✅ RESOLVED - Models are refreshing correctly

**What was fixed:**
- Updated `getAvailableModels()` to return SDK model IDs
- Updated catalog JSON with correct model definitions
- UI now shows: "Default (Sonnet 4.5)", "Opus 4.1", "Sonnet (1M context)"

**No further action needed.**

---

## SDK Provider Test Checklist

Once issues #1 and #2 are resolved, test the following:

### Basic Functionality
- [ ] Create SDK provider instance without credentials
- [ ] Instance shows as configured (auto-auth)
- [ ] Create new session with SDK provider
- [ ] Select "Default (Sonnet 4.5)" model
- [ ] Send simple message: "What is 2+2?"
- [ ] Verify response received
- [ ] Check token usage displayed

### Tool Execution
- [ ] Send message requiring tool: "List files in current directory"
- [ ] Verify tool approval prompt appears
- [ ] Approve tool execution
- [ ] Verify tool executes via Lace's tool system (not SDK's)
- [ ] Check MCP server logs for `__lace_tools` activity

### Streaming
- [ ] Send message: "Count from 1 to 10"
- [ ] Verify tokens stream in real-time
- [ ] Check token usage updates progressively

### Session Resumption
- [ ] Send first message
- [ ] Note session ID in debug logs
- [ ] Send second message
- [ ] Verify same session ID used (resumption working)
- [ ] Edit conversation history (compact or edit message)
- [ ] Send third message
- [ ] Verify new session ID (fork detected)

### Error Handling
- [ ] Trigger authentication error (if possible)
- [ ] Verify `authentication_required` event emitted
- [ ] Check error logs contain stack traces

### Permission Modes
- [ ] Test with `normal` permission mode
- [ ] Test with `yolo` mode (auto-approve)
- [ ] Test with `read-only` mode (plan only)

---

## Files Modified in This Implementation

### Core Provider
- `packages/core/src/providers/claude-sdk-provider.ts` - Main implementation
- `packages/core/src/providers/claude-sdk-provider.test.ts` - Unit tests
- `packages/core/src/providers/claude-sdk-integration.test.ts` - Integration tests
- `packages/core/src/providers/claude-sdk-e2e.test.ts` - E2E tests (skipped)
- `packages/core/src/providers/catalog/data/claude-agents-sdk.json` - Catalog entry

### Registry & Base
- `packages/core/src/providers/registry.ts` - Added SDK provider registration
- `packages/core/src/providers/base-provider.ts` - Added ProviderRequestContext

### Agent Integration
- `packages/core/src/agents/agent.ts` - Build and pass context to providers
- `packages/core/src/agents/agent.test.ts` - Updated MockProvider signature

### Other Providers (Context Parameter)
- `packages/core/src/providers/anthropic-provider.ts`
- `packages/core/src/providers/openai-provider.ts`
- `packages/core/src/providers/gemini-provider.ts`
- `packages/core/src/providers/lmstudio-provider.ts`
- `packages/core/src/providers/ollama-provider.ts`

### UI/Web
- `packages/web/components/providers/AddInstanceModal.tsx` - Hide API key for SDK
- `packages/web/components/providers/ProviderInstanceProvider.tsx` - Conditional credential sending
- `packages/web/app/routes/api.provider.instances.ts` - Optional credentials

### Dependencies
- `package.json` (root) - Added `@anthropic-ai/claude-agent-sdk": "^0.1.2`
- `packages/core/package.json` - Added SDK dependency

---

## Known Limitations (By Design)

### SDK Auto-Authentication
The SDK automatically detects authentication from:
- Claude Code CLI session
- Browser claude.ai session cookies
- `ANTHROPIC_API_KEY` environment variable

If none are available, SDK will fail. No OAuth UI flow is needed because:
1. Users with Claude Pro/Team are already logged in to Claude Code CLI or browser
2. SDK subprocess inherits authentication automatically
3. Manual session token only needed if auto-detection fails

### Model IDs
SDK uses short identifiers (`default`, `opus`, `sonnet[1m]`), not full API model IDs.
Cannot use `claude-sonnet-4-5-20250929` style IDs with SDK.

### Subprocess Overhead
SDK spawns a Node.js subprocess per request. This adds ~500ms overhead compared to direct API calls.
This is by design - SDK manages its own process lifecycle.

### Session Token Storage
If user manually provides session token, it's stored in credentials as `apiKey`.
This reuses existing credential infrastructure without adding new fields.

---

## Next Steps After Fixes

Once issues #1 and #2 are resolved:

1. **Complete Phase 7 Testing**
   - Run full E2E test with real session
   - Verify tool execution works
   - Test session resumption
   - Document test results

2. **Phase 8: Documentation & Polish**
   - Add provider documentation
   - Update CODE-MAP.md
   - Update main documentation

3. **Phase 9: Final Integration**
   - Manual testing with real agent
   - Performance testing vs direct API

4. **Phase 10: Cleanup & Review**
   - Code review checklist
   - Update CHANGELOG
   - Prepare PR

---

## Debug Information

### Test Script Results
Created `test-sdk-auth.mjs` to verify SDK auto-authentication:
```
✅ SDK initialized successfully
Session ID: 59ed4f94-fcb5-41a8-b575-b537ebde925c
API Key Source: none
Model: claude-sonnet-4-5-20250929
✅ Assistant response: 4
Duration: 1975ms
Tokens: 4 in, 5 out
```

**Conclusion:** SDK auto-authentication works perfectly without any credentials!

### Supported Models Discovery
SDK returns these model identifiers via `supportedModels()`:
```json
[
  {
    "value": "default",
    "displayName": "Default (recommended)",
    "description": "Sonnet 4.5 · Smartest model for daily use"
  },
  {
    "value": "opus",
    "displayName": "Opus",
    "description": "Opus 4.1 for complex tasks · Reaches usage limits faster"
  },
  {
    "value": "sonnet[1m]",
    "displayName": "Sonnet (1M context)",
    "description": "Sonnet 4.5 with 1M context · Uses rate limits faster"
  }
]
```

---

## Session Creation Bug - Detailed Analysis

**Current Behavior:**
When UI sends session creation request with tool policies:
```json
{
  "configuration": {
    "toolPolicies": { "bash": "allow" },
    "providerInstanceId": "...",
    "modelId": "..."
  }
}
```

**Schema Expects:**
```typescript
tools: z.array(z.string()).optional()  // ["bash", "read_file"]
```

**Schema Receives:**
```typescript
toolPolicies: { "bash": "allow" }  // Object, not array!
```

**Why This Breaks:**
- Zod validation fails because field name mismatch
- `toolPolicies` is not in schema (gets passed through as unknown)
- If `tools` field exists as object instead of array, validation fails

**Quick Fix:**
Add `toolPolicies` to schema in `session-config.ts`:
```typescript
toolPolicies: z.record(z.enum(['allow', 'deny', 'ask'])).optional(),
```

**Testing After Fix:**
1. Create new session with bash tool policy set to "allow"
2. Verify session creates successfully
3. Verify tool policy is respected in session
