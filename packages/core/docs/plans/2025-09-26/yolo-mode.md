# Permission Mode Override System - Implementation Plan

## Overview

We're building a runtime permission override system that allows users to quickly switch between three permission modes without modifying their stored session configuration:

- **Normal Mode**: Uses configured tool policies as-is
- **YOLO Mode**: All tools automatically approved (developer productivity mode)
- **Read-Only Mode**: Only safe read operations allowed (safe exploration mode)

## Architecture Summary

**ACTUAL IMPLEMENTATION (as of 2025-01-28):**

```
Web UI (Segmented Control)
    ↓
Session API (/api/sessions/:id/configuration)
    ↓
Session.updateConfiguration({runtimeOverrides: {permissionMode: 'yolo'}})
    ↓
Session.setPermissionOverrideMode() [called automatically]
    ↓
Updates all Agent ToolExecutors
    ↓
ToolExecutor.getEffectivePolicy() [called by Agent during tool approval]
    ↓
Tool executes with modified permission
```

**Key Design Decisions:**
- Permission mode is set via the existing `/configuration` endpoint (not a separate endpoint)
- Permission mode is stored in `SessionConfiguration.runtimeOverrides.permissionMode`
- Logic lives in `Session.updateConfiguration()`, not in the API layer
- When permission mode changes, `Session` automatically calls `setPermissionOverrideMode()` which updates all agent tool executors

## Prerequisites

- Node.js 20.18+
- Understanding of TypeScript
- Basic familiarity with React
- The codebase uses:
  - Monorepo structure (`packages/core` and `packages/web`)
  - Vitest for testing
  - DaisyUI/Tailwind for UI components
  - SQLite for persistence

## Development Setup

```bash
# Install dependencies
npm install

# Run tests in watch mode during development
npm test

# Build to check TypeScript compilation
npm run build

# Start dev server to test UI changes
npm run dev
```

## Implementation Tasks

### Phase 1: Core Type System (Backend Foundation)

#### Task 1.1: Add readOnlySafe annotation to tool types

**File**: `packages/core/src/tools/types.ts`

**What to do**:
1. Find the `ToolAnnotations` interface (around line 25-30)
2. Add a new optional property: `readOnlySafe?: boolean;`

**Code to add**:
```typescript
export interface ToolAnnotations {
  title?: string;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
  safeInternal?: boolean;
  readOnlySafe?: boolean;  // NEW: Indicates tool is safe in read-only mode
}
```

**Test this step**:
```bash
npm run build
# Should compile without errors
```

**Commit**:
```bash
git add -A && git commit -m "feat(tools): add readOnlySafe annotation to ToolAnnotations interface"
```

---

#### Task 1.2: Create PermissionOverrideMode type

**File**: `packages/core/src/tools/types.ts`

**What to do**:
Add a new type export at the end of the file:

```typescript
export type PermissionOverrideMode = 'normal' | 'yolo' | 'read-only';
```

**Test**: `npm run build`

**Commit**:
```bash
git commit -am "feat(tools): add PermissionOverrideMode type"
```

---

#### Task 1.3: Mark read-only safe tools

**Files to update** (each tool has an `annotations` property):

**SAFE tools** (add `readOnlySafe: true`):
- `packages/core/src/tools/implementations/file_read.ts`
- `packages/core/src/tools/implementations/file_list.ts`
- `packages/core/src/tools/implementations/file_find.ts`
- `packages/core/src/tools/implementations/ripgrep_search.ts`
- `packages/core/src/tools/implementations/url_fetch.ts`

**Example change** for `file_read.ts`:
```typescript
annotations: ToolAnnotations = {
  title: 'Read files',
  readOnlySafe: true,  // ADD THIS LINE
};
```

**UNSAFE tools** (add `readOnlySafe: false` or leave undefined):
- `packages/core/src/tools/implementations/bash.ts`
- `packages/core/src/tools/implementations/file_write.ts`
- `packages/core/src/tools/implementations/file_edit.ts`

**Test**: Build should still pass
```bash
npm run build
```

**Commit**:
```bash
git commit -am "feat(tools): mark tools with readOnlySafe annotation"
```

---

### Phase 2: Session Layer Implementation

#### Task 2.1: Add permission override to Session class

**File**: `packages/core/src/sessions/session.ts`

**What to do**:
1. Import the new type at the top:
```typescript
import type { ToolPolicy, PermissionOverrideMode } from '~/tools/types';
```

2. Add private field to the Session class (around line 60):
```typescript
export class Session {
  // ... existing fields ...
  private _permissionOverrideMode: PermissionOverrideMode = 'normal';
```

3. Add getter and setter methods (add near other getters, around line 800):
```typescript
getPermissionOverrideMode(): PermissionOverrideMode {
  return this._permissionOverrideMode;
}

setPermissionOverrideMode(mode: PermissionOverrideMode): void {
  this._permissionOverrideMode = mode;

  // Update all agents' tool executors
  for (const agent of this._agents.values()) {
    agent.toolExecutor.setPermissionOverrideMode(mode);
  }

  // Persist to database
  this.updateSessionConfiguration({
    ...this.getSessionData().configuration,
    runtimeOverrides: {
      permissionMode: mode
    }
  });

  logger.info('Permission override mode updated', {
    sessionId: this._sessionId,
    mode
  });
}
```

4. Load the override mode during session reconstruction (in `_performReconstruction` method):
```typescript
// After creating the session instance, restore override mode
const overrideMode = sessionData.configuration?.runtimeOverrides?.permissionMode as PermissionOverrideMode;
if (overrideMode && overrideMode !== 'normal') {
  session.setPermissionOverrideMode(overrideMode);
}
```

**Test with**:
```bash
npm run build
```

**Commit**:
```bash
git commit -am "feat(session): add permission override mode to Session class"
```

---

#### Task 2.2: Write tests for Session permission mode

**File**: Create `packages/core/src/sessions/session-permission-override.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Session } from './session';
import { setupCoreTest } from '~/test-utils/core-test-setup';

describe('Session Permission Override', () => {
  beforeEach(() => {
    setupCoreTest();
  });

  it('should start in normal mode', async () => {
    const session = await Session.create({
      projectId: 'test-project',
      name: 'Test Session',
    });

    expect(session.getPermissionOverrideMode()).toBe('normal');
  });

  it('should update permission mode', async () => {
    const session = await Session.create({
      projectId: 'test-project',
      name: 'Test Session',
    });

    session.setPermissionOverrideMode('yolo');
    expect(session.getPermissionOverrideMode()).toBe('yolo');

    session.setPermissionOverrideMode('read-only');
    expect(session.getPermissionOverrideMode()).toBe('read-only');
  });

  it('should persist permission mode', async () => {
    const session = await Session.create({
      projectId: 'test-project',
      name: 'Test Session',
    });

    session.setPermissionOverrideMode('yolo');

    // Reload session
    const reloaded = await Session.getById(session.getId());
    expect(reloaded?.getPermissionOverrideMode()).toBe('yolo');
  });
});
```

**Run tests**:
```bash
npm test -- session-permission-override
```

**Commit**:
```bash
git add -A && git commit -m "test(session): add tests for permission override mode"
```

---

### Phase 3: ToolExecutor Implementation

#### Task 3.1: Add override mode to ToolExecutor

**File**: `packages/core/src/tools/executor.ts`

**What to do**:
1. Import the type:
```typescript
import type { PermissionOverrideMode } from './types';
```

2. Add private field (around line 20):
```typescript
export class ToolExecutor {
  private tools = new Map<string, Tool>();
  private envManager: ProjectEnvironmentManager;
  private permissionOverrideMode: PermissionOverrideMode = 'normal';  // NEW
```

3. Add setter method:
```typescript
setPermissionOverrideMode(mode: PermissionOverrideMode): void {
  this.permissionOverrideMode = mode;
}
```

4. Add override logic method:
```typescript
private getEffectivePolicy(tool: Tool, configuredPolicy: ToolPolicy): ToolPolicy {
  // Apply override mode
  switch (this.permissionOverrideMode) {
    case 'yolo':
      return 'allow';

    case 'read-only':
      // Check if tool is read-only safe
      if (tool.annotations?.readOnlySafe) {
        return 'allow';
      }
      return 'deny';

    case 'normal':
    default:
      return configuredPolicy;
  }
}
```

5. Update the `execute` method to use `getEffectivePolicy` when checking permissions:
```typescript
// In the execute method, find where it checks tool policies
// Replace direct policy check with:
const effectivePolicy = this.getEffectivePolicy(tool, configuredPolicy);
// Use effectivePolicy for permission decisions
```

**Test**: Build should pass
```bash
npm run build
```

**Commit**:
```bash
git commit -am "feat(executor): add permission override mode support to ToolExecutor"
```

---

#### Task 3.2: Write tests for ToolExecutor override

**File**: Create `packages/core/src/tools/executor-override.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolExecutor } from './executor';
import { Tool } from './tool';
import { z } from 'zod';

// Create mock tools for testing
class SafeReadTool extends Tool {
  name = 'safe_read';
  description = 'A safe read tool';
  schema = z.object({});
  annotations = { readOnlySafe: true };

  protected async executeValidated() {
    return this.createResult('read data');
  }
}

class UnsafeWriteTool extends Tool {
  name = 'unsafe_write';
  description = 'An unsafe write tool';
  schema = z.object({});
  annotations = { readOnlySafe: false };

  protected async executeValidated() {
    return this.createResult('wrote data');
  }
}

describe('ToolExecutor Permission Override', () => {
  let executor: ToolExecutor;
  let safeTool: SafeReadTool;
  let unsafeTool: UnsafeWriteTool;

  beforeEach(() => {
    executor = new ToolExecutor();
    safeTool = new SafeReadTool();
    unsafeTool = new UnsafeWriteTool();

    executor.registerTool(safeTool.name, safeTool);
    executor.registerTool(unsafeTool.name, unsafeTool);
  });

  describe('YOLO mode', () => {
    it('should allow all tools in YOLO mode', async () => {
      executor.setPermissionOverrideMode('yolo');

      // Both tools should execute without approval
      const safeResult = await executor.execute(
        { name: 'safe_read', arguments: {} },
        { signal: new AbortController().signal }
      );
      expect(safeResult.status).toBe('completed');

      const unsafeResult = await executor.execute(
        { name: 'unsafe_write', arguments: {} },
        { signal: new AbortController().signal }
      );
      expect(unsafeResult.status).toBe('completed');
    });
  });

  describe('Read-only mode', () => {
    it('should allow safe tools in read-only mode', async () => {
      executor.setPermissionOverrideMode('read-only');

      const result = await executor.execute(
        { name: 'safe_read', arguments: {} },
        { signal: new AbortController().signal }
      );
      expect(result.status).toBe('completed');
    });

    it('should deny unsafe tools in read-only mode', async () => {
      executor.setPermissionOverrideMode('read-only');

      const result = await executor.execute(
        { name: 'unsafe_write', arguments: {} },
        { signal: new AbortController().signal }
      );
      expect(result.status).toBe('denied');
    });
  });
});
```

**Run tests**:
```bash
npm test -- executor-override
```

**Commit**:
```bash
git add -A && git commit -m "test(executor): add tests for permission override modes"
```

---

### Phase 3.5: Fix Circular Dependency (CRITICAL - BLOCKING)

**STATUS**: Must complete before Phase 4. Tests are failing due to circular dependency.

**Problem**: Circular dependency introduced in container work:
```
tool.ts → Session → ToolExecutor → BashTool → tool.ts
```

**Solution**: Option 1 - Context Enrichment in ToolExecutor

#### Task 3.5.1: Update ToolExecutor to populate workspace context

**File**: `packages/core/src/tools/executor.ts`

**What to do**: In the `execute()` method, add workspace info to the context after line 301:

```typescript
// Use the LLM-provided tool call ID and create temp directory
const toolTempDir = await this.createToolTempDirectory(toolCall.id, context);

// NEW: Get workspace context from session
const workspaceInfo = session?.getWorkspaceInfo();
const workspaceManager = session?.getWorkspaceManager();

// Enhanced context with temp directory, workspace info, and workspace manager
toolContext = {
  ...toolContext,
  toolTempDir,
  workspaceInfo,      // NEW
  workspaceManager,   // NEW
};
```

#### Task 3.5.2: Update Tool base class to use context directly

**File**: `packages/core/src/tools/tool.ts`

**What to do**:
1. Remove the two helper methods: `getWorkspaceInfo()` and `getWorkspaceManager()` (they use require() for Session)
2. Update `resolveWorkspacePath()` method to read from context instead:

```typescript
protected resolveWorkspacePath(path: string, context?: ToolContext): string {
  // Read from context instead of calling getWorkspaceInfo()
  const workspaceInfo = context?.workspaceInfo;

  if (!workspaceInfo) {
    return this.resolvePath(path, context);
  }
  // ... rest unchanged
}
```

#### Task 3.5.3: Update BashTool to use context directly

**File**: `packages/core/src/tools/implementations/bash.ts`

**What to do**: Find any calls to `getSessionFromContext()` or `session?.getWorkspaceInfo()` and replace with context reads:

```typescript
// OLD
const session = this.getSessionFromContext(context);
const workspaceInfo = session?.getWorkspaceInfo();

// NEW
const workspaceInfo = context?.workspaceInfo;
const workspaceManager = context?.workspaceManager;
```

#### Task 3.5.4: Run all tests

```bash
npm test
# All tool tests should now pass - circular dependency is fixed
```

#### Task 3.5.5: Verify build and lint

```bash
npm run build  # Should compile without errors
npm run lint   # Should pass
```

**Commit**:
```bash
git add -A && git commit -m "fix(tools): eliminate circular dependency by enriching context in ToolExecutor

- ToolExecutor now populates workspaceInfo and workspaceManager in context
- Tool base class reads from context instead of calling Session
- Removes Session helper methods from tool.ts
- Fixes circular dependency: tool.ts → Session → ToolExecutor → tools → tool.ts"
```

---

### Phase 4: API Layer

**ACTUAL IMPLEMENTATION:**

No separate endpoint was created. Instead, permission mode is integrated into the existing configuration endpoint.

#### Task 4.1: Add runtimeOverrides to configuration schema

**File**: `packages/web/app/routes/api.sessions.$sessionId.configuration.ts`

**Changes made**:
1. Added `runtimeOverrides` to the `ConfigurationSchema`:
```typescript
const ConfigurationSchema = z.object({
  // ... existing fields ...
  runtimeOverrides: z
    .object({
      permissionMode: z.enum(['normal', 'yolo', 'read-only']).optional(),
    })
    .optional(),
});
```

2. Added to `SessionConfigurationSchema` in `packages/core/src/sessions/session-config.ts`:
```typescript
export const SessionConfigurationSchema = z.object({
  // ... existing fields ...
  runtimeOverrides: z
    .object({
      permissionMode: z.enum(['normal', 'yolo', 'read-only']).optional(),
    })
    .optional(),
});
```

3. Updated `Session.updateConfiguration()` to automatically handle permission mode changes:
```typescript
updateConfiguration(updates: Partial<SessionConfiguration>): void {
  // Validate configuration
  const validatedConfig = Session.validateConfiguration(updates);

  const currentConfig = this._sessionData.configuration || {};
  const newConfig = { ...currentConfig, ...validatedConfig };

  // Update database and cache
  Session.updateSession(this._sessionId, { configuration: newConfig });

  // If permission mode changed, update all agent tool executors
  if (validatedConfig.runtimeOverrides?.permissionMode) {
    this.setPermissionOverrideMode(validatedConfig.runtimeOverrides.permissionMode);
  }
}
```

**Usage**:
```bash
# Update permission mode via existing configuration endpoint
curl -X PUT http://localhost:31339/api/sessions/SESSION_ID/configuration \
  -H "Content-Type: application/json" \
  -d '{
    "runtimeOverrides": {
      "permissionMode": "yolo"
    }
  }'
```

**Commit**:
```bash
git add -A && git commit -m "feat(session): integrate permission mode into configuration system"
```

---

### Phase 5: Frontend UI Implementation

#### Task 5.1: Create SegmentedControl component

**File**: Create `packages/web/components/ui/segmented-control.tsx`

```typescript
import { cn } from '@/lib/utils';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className
}: SegmentedControlProps<T>) {
  return (
    <div className={cn("join", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          className={cn(
            "join-item btn btn-sm",
            value === option.value ? "btn-primary" : "btn-ghost"
          )}
          onClick={() => onChange(option.value)}
          disabled={option.disabled}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
```

**Commit**:
```bash
git add -A && git commit -m "feat(ui): add SegmentedControl component"
```

---

#### Task 5.2: Add permission mode control to session sidebar

**File**: Find the session sidebar component (likely in `packages/web/components/session/` or similar)

**What to add**:
1. Import the component and types:
```typescript
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { PermissionOverrideMode } from '@lace/core/tools/types';
```

2. Add state for the permission mode:
```typescript
const [permissionMode, setPermissionMode] = useState<PermissionOverrideMode>('normal');
```

3. Add the control to the sidebar UI:
```typescript
<div className="p-4 border-b">
  <label className="text-sm font-medium mb-2 block">
    Permission Mode
  </label>
  <SegmentedControl
    options={[
      { value: 'read-only', label: '🔒 Read Only' },
      { value: 'normal', label: '✓ Normal' },
      { value: 'yolo', label: '⚡ YOLO' }
    ]}
    value={permissionMode}
    onChange={handlePermissionModeChange}
  />
</div>
```

4. Add the change handler:
```typescript
const handlePermissionModeChange = async (mode: PermissionOverrideMode) => {
  setPermissionMode(mode);

  try {
    const response = await fetch(
      `/api/sessions/${sessionId}/permission-mode`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      }
    );

    if (!response.ok) {
      throw new Error('Failed to update permission mode');
    }
  } catch (error) {
    console.error('Failed to update permission mode:', error);
    // Revert on error
    setPermissionMode(previousMode);
  }
};
```

**Commit**:
```bash
git commit -am "feat(ui): add permission mode control to session sidebar"
```

---

#### Task 5.3: Add visual indicators for active modes

**File**: The main chat/session view component

**What to add**:

1. Conditionally apply border/background classes based on mode:
```typescript
<div className={cn(
  "flex-1 overflow-y-auto",
  permissionMode === 'read-only' && "border-2 border-red-500/20",
  permissionMode === 'yolo' && "border-2 border-amber-500/20"
)}>
  {/* Chat messages */}
</div>
```

Or for background tint:
```typescript
<div className={cn(
  "flex-1 overflow-y-auto",
  permissionMode === 'read-only' && "bg-red-50/5",
  permissionMode === 'yolo' && "bg-amber-50/5"
)}>
```

**Test visually**:
- Start dev server: `npm run dev`
- Open a session
- Toggle between modes
- Verify visual changes

**Commit**:
```bash
git commit -am "feat(ui): add visual indicators for permission modes"
```

---

### Phase 6: Auto-resolve Pending Approvals

#### Task 6.1: Implement approval auto-resolution

**File**: `packages/core/src/sessions/session.ts`

**Update** the `setPermissionOverrideMode` method to handle pending approvals:

```typescript
async setPermissionOverrideMode(mode: PermissionOverrideMode): Promise<void> {
  this._permissionOverrideMode = mode;

  // Update all agents' tool executors
  for (const agent of this._agents.values()) {
    agent.toolExecutor.setPermissionOverrideMode(mode);
  }

  // Auto-resolve pending approvals based on new mode
  if (mode !== 'normal') {
    await this.autoResolvePendingApprovals(mode);
  }

  // Persist to database
  this.updateSessionConfiguration({
    ...this.getSessionData().configuration,
    runtimeOverrides: {
      permissionMode: mode
    }
  });

  logger.info('Permission override mode updated', {
    sessionId: this._sessionId,
    mode
  });
}

private async autoResolvePendingApprovals(mode: PermissionOverrideMode): Promise<void> {
  // Get all pending approvals for this session
  const pendingApprovals = await this.getPendingApprovals();

  for (const approval of pendingApprovals) {
    const tool = this.getToolByName(approval.toolName);

    if (mode === 'yolo') {
      // Approve all in YOLO mode
      await this.approveToolCall(approval.id);
    } else if (mode === 'read-only') {
      // In read-only mode, approve safe tools, deny others
      if (tool?.annotations?.readOnlySafe) {
        await this.approveToolCall(approval.id);
      } else {
        await this.denyToolCall(approval.id);
      }
    }
  }
}
```

**Commit**:
```bash
git commit -am "feat(session): auto-resolve pending approvals on mode change"
```

---

### Phase 7: Integration Testing

#### Task 7.1: End-to-end test

**File**: Create `packages/core/src/sessions/permission-override-e2e.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Session } from './session';
import { Agent } from '~/agents/agent';
import { setupCoreTest } from '~/test-utils/core-test-setup';

describe('Permission Override E2E', () => {
  let session: Session;
  let agent: Agent;

  beforeEach(async () => {
    setupCoreTest();

    session = await Session.create({
      projectId: 'test-project',
      name: 'Test Session',
      configuration: {
        toolPolicies: {
          file_read: 'ask',
          file_write: 'ask',
          bash: 'ask'
        }
      }
    });

    agent = session.getCoordinatorAgent();
  });

  it('should allow all tools in YOLO mode', async () => {
    session.setPermissionOverrideMode('yolo');

    // File write should be auto-approved
    const writeResult = await agent.toolExecutor.execute({
      name: 'file_write',
      arguments: {
        file_path: '/tmp/test.txt',
        content: 'test content'
      }
    });

    expect(writeResult.status).toBe('completed');
  });

  it('should block destructive tools in read-only mode', async () => {
    session.setPermissionOverrideMode('read-only');

    // File read should work
    const readResult = await agent.toolExecutor.execute({
      name: 'file_read',
      arguments: {
        file_path: '/tmp/test.txt'
      }
    });
    expect(readResult.status).toBe('completed');

    // File write should be denied
    const writeResult = await agent.toolExecutor.execute({
      name: 'file_write',
      arguments: {
        file_path: '/tmp/test.txt',
        content: 'new content'
      }
    });
    expect(writeResult.status).toBe('denied');
  });
});
```

**Run**:
```bash
npm test -- permission-override-e2e
```

**Commit**:
```bash
git add -A && git commit -m "test(e2e): add end-to-end tests for permission override system"
```

---

## Testing Checklist

### Manual Testing
1. Start the dev server: `npm run dev`
2. Create a new session
3. Open the session in the web UI
4. Verify the segmented control appears in the sidebar
5. Test switching between modes:
   - Normal → YOLO: All tools should auto-approve
   - Normal → Read Only: Write operations should be denied
   - Visual indicators should change (border/background tint)
6. Test with pending approvals:
   - Queue some tool approvals
   - Switch to YOLO mode
   - Verify they auto-approve
7. Test persistence:
   - Set mode to YOLO
   - Refresh the page
   - Verify mode is still YOLO

### Automated Testing
```bash
# Run all tests
npm test

# Run specific test suites
npm test -- session-permission-override
npm test -- executor-override
npm test -- permission-override-e2e

# Check TypeScript compilation
npm run build

# Run linting
npm run lint
```

## Common Issues & Solutions

### Issue: TypeScript errors about missing types
**Solution**: Make sure you've added all imports and exports correctly. Run `npm run build` to see specific errors.

### Issue: Tests failing with "Session not found"
**Solution**: Make sure you're using `setupCoreTest()` in your test setup to initialize the test database.

### Issue: UI not updating when mode changes
**Solution**: Check that the state is being updated and the API call is succeeding. Look at browser console for errors.

### Issue: Permissions not being overridden
**Solution**: Verify that `getEffectivePolicy` is being called in ToolExecutor instead of using the configured policy directly.

## Architecture Decision Records

### Why store override mode in session, not user preferences?
Different sessions may need different permission levels. A production debugging session might need read-only, while a development session uses YOLO mode.

### Why use tool annotations instead of hardcoded lists?
This makes the system extensible. New tools automatically work with the permission system by setting their `readOnlySafe` annotation.

### Why auto-resolve pending approvals?
User expectation: switching to YOLO mode means "approve everything". Having to still manually approve queued items would be confusing.

### Why visual indicators?
Safety. Users should always be aware when they're in a permissive (YOLO) or restrictive (Read-Only) mode to avoid surprises.

## Next Steps & Future Enhancements

1. **Audit logging**: Record when permission modes are changed
2. **Keyboard shortcuts**: Add hotkeys for quick mode switching
3. **Fine-grained overrides**: Allow per-tool overrides within a mode
4. **Mode presets**: Save custom permission configurations
5. **Team policies**: Enforce certain modes for shared sessions

## Final Checklist

- [ ] All tests passing
- [ ] TypeScript compiles without errors
- [ ] UI controls working in all supported browsers
- [ ] Visual indicators clearly visible
- [ ] Mode persists across page refreshes
- [ ] Pending approvals auto-resolve correctly
- [ ] No regressions in existing permission system
- [ ] Documentation updated (this plan counts!)

## Commit History Guide

Your commit history should look something like:
```
feat(tools): add readOnlySafe annotation to ToolAnnotations interface
feat(tools): add PermissionOverrideMode type
feat(tools): mark tools with readOnlySafe annotation
feat(session): add permission override mode to Session class
test(session): add tests for permission override mode
feat(executor): add permission override mode support to ToolExecutor
test(executor): add tests for permission override modes
feat(api): add permission mode endpoint
feat(ui): add SegmentedControl component
feat(ui): add permission mode control to session sidebar
feat(ui): add visual indicators for permission modes
feat(session): auto-resolve pending approvals on mode change
test(e2e): add end-to-end tests for permission override system
```

This creates a clean, logical progression that's easy to review and potentially revert if needed.