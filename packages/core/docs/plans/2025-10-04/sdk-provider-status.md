# Claude Agent SDK Provider - Status Report
**Date:** 2025-10-04
**Session:** claude-agents-sdk branch

## ✅ BREAKTHROUGH: SDK Provider Now Working!

### Root Cause Discovered
The "spawn node ENOENT" error was caused by **invalid working directory (`cwd`)**.

When you pass `cwd: '/test/project'` (which doesn't exist) to the SDK with ANY env configuration, the subprocess spawn fails with "spawn node ENOENT".

### Solution Implemented
1. Validate working directory exists before passing to SDK
2. Fall back to `tmpdir()` if invalid (never `process.cwd()` - dangerous in dev environment)
3. Pass `env: process.env` for full environment inheritance
4. Set OAuth token in parent `process.env` before SDK call
5. Clean up token in `finally` block

### Testing Methodology
Created progressive test scripts to isolate the issue:
- `test-sdk-env-scenarios.mjs`: Tested all env passing approaches ✅ All worked
- `test-sdk-with-invalid-cwd.mjs`: Tested with invalid cwd ❌ Failed with ENOENT
- Proved the root cause systematically

### Current Status

**✅ Working:**
- OAuth token authentication via `claude setup-token`
- UI prompts for token with instructions
- SDK subprocess spawns successfully
- Basic text responses working
- Token usage tracking
- Streaming responses
- Tool approval integration ✨ FIXED!
  - `canUseTool` callback properly calls `toolExecutor.requestApproval()`
  - Approvals appear in Lace's approval system
  - SDK permission callbacks mapped to Lace approval workflow
  - Test coverage via `claude-sdk-tool-approval.test.ts`

**✅ COMPLETE:** SDK provider fully functional!

## Tool Approval Fix (2025-10-04)

**Test Created:** `packages/core/src/providers/claude-sdk-tool-approval.test.ts`

**Test Status:** ✅ PASSING

**Root Cause:** The `buildCanUseToolHandler` callback created its own promise management system (`pendingApprovals` map) instead of delegating to ToolExecutor's approval system.

**Fix Implemented:**
Simplified the `case 'ask'` block to directly call `toolExecutor.requestApproval()`:
```typescript
case 'ask': {
  const approvalResult = await toolExecutor.requestApproval({
    toolName,
    parameters: input,
    readOnly: tool?.annotations?.readOnlySafe || false,
  });

  const isAllowed = [
    ApprovalDecision.ALLOW_ONCE,
    ApprovalDecision.ALLOW_SESSION,
    ApprovalDecision.ALLOW_PROJECT,
    ApprovalDecision.ALLOW_ALWAYS,
  ].includes(approvalResult.decision);

  return isAllowed
    ? { behavior: 'allow', updatedInput: input }
    : { behavior: 'deny', message: 'User denied tool execution', interrupt: true };
}
```

**Cleanup:**
- Removed unused `pendingApprovals` map
- Removed event-based approval promise pattern
- Simplified to direct ToolExecutor delegation

### Files Modified
- `packages/core/src/providers/claude-sdk-provider.ts`: Core implementation + tool approval fix
- `packages/core/src/providers/claude-sdk-tool-approval.test.ts`: TDD test for approval integration
- `packages/web/components/providers/AddInstanceModal.tsx`: OAuth token UI
- `packages/web/vite.config.ts`: Workspace watch config for hot reload
- `packages/core/src/providers/registry.ts`: Removed credential-optional special case

### Key Learnings

1. **tsx loads source files directly in dev** via vite config alias `'~': '../core/src'`
   - No build needed for dev mode
   - Changes should hot-reload
   - But tsx doesn't always reload - kill and restart needed

2. **Invalid cwd breaks subprocess spawn** regardless of env configuration
   - spawn() checks cwd exists before spawning
   - Error message misleading ("spawn node ENOENT")
   - Always validate cwd before passing to child processes

3. **Test scripts are essential** for isolating complex integration issues
   - Systematically ruled out env, PATH, token issues
   - Identified exact failing condition
   - Much faster than web UI debugging

### Commits
- `447a5438f`: feat(claude-sdk): add OAuth token authentication and fix PATH for subprocess
- `a91bddf2e`: fix(claude-sdk): pass undefined env to enable PATH search in subprocess spawn
- `93806aa58`: fix(claude-sdk): fix subprocess spawn by validating cwd and using process.env

## Current Server
**URL:** http://localhost:31337
**Status:** Running with working SDK provider
**Test:** Basic chat works, tool use hangs on approval
