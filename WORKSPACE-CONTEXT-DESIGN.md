# Workspace Context Design Proposals

## Current Architecture Analysis

### Data Flow
```
Session
  ├─> has WorkspaceManager
  ├─> has WorkspaceInfo
  ├─> creates ToolExecutor(s) via createConfiguredToolExecutor()
  └─> creates Agent(s)
       └─> Agent creates ToolContext { signal, workingDirectory, agent }
            └─> Agent calls ToolExecutor.execute(toolCall, toolContext)
                 └─> ToolExecutor enriches context with { processEnv, toolTempDir }
                      └─> Tool.execute() receives enriched context
```

### The Circular Dependency Problem

**Current problematic imports:**
```
tool.ts
  → imports Session (to call Session.getByIdSync())
    → session.ts imports ToolExecutor
      → executor.ts imports BashTool (and other tool implementations)
        → bash.ts extends Tool from tool.ts
          → CIRCULAR!
```

**Root cause:** `Tool` base class reaches back into `Session` to get workspace info:
```typescript
// In tool.ts - BAD!
const session = Session.getByIdSync(asThreadId(threadId));
const workspaceInfo = session?.getWorkspaceInfo();
```

This violates the dependency hierarchy. Tool is a low-level abstraction that shouldn't know about Session (high-level orchestration).

---

## Design Option 1: Context Enrichment in ToolExecutor (RECOMMENDED)

### Overview
ToolExecutor enriches the ToolContext with workspace information before passing it to tools. This maintains the existing flow and puts enrichment logic where it belongs.

### Implementation

**1. Update ToolContext interface** (already done in your current changes):
```typescript
export interface ToolContext {
  signal: AbortSignal;
  workingDirectory?: string;
  agent?: Agent;
  processEnv?: NodeJS.ProcessEnv;
  toolTempDir?: string;

  // NEW: Workspace context
  workspaceInfo?: {
    mode: 'local' | 'container';
    workingDirectory: string;
    projectDir: string;
    clonePath: string;
    containerId?: string;
  };
  workspaceManager?: IWorkspaceManager;
}
```

**2. Update ToolExecutor.execute()** to populate workspace context:
```typescript
async execute(toolCall: ToolCall, context: ToolContext): Promise<ToolResult> {
  const tool = this.getTool(toolCall.name);
  if (!tool) {
    throw new Error(`Tool '${toolCall.name}' not found`);
  }

  let toolContext: ToolContext = context || {};

  // Enrich context if agent is available
  if (context?.agent) {
    const session = await context.agent.getFullSession();
    const projectId = session?.getProjectId();

    // Add environment variables
    if (projectId) {
      const projectEnv = this.envManager.getMergedEnvironment(projectId);
      toolContext.processEnv = { ...process.env, ...projectEnv };
    }

    // Add temp directory
    const toolTempDir = await this.createToolTempDirectory(toolCall.id, context);

    // ADD: Workspace info
    const workspaceInfo = session?.getWorkspaceInfo();
    const workspaceManager = session?.getWorkspaceManager();

    toolContext = {
      ...toolContext,
      toolTempDir,
      workspaceInfo,      // NEW
      workspaceManager,   // NEW
    };
  }

  const result = await tool.execute(toolCall.arguments, toolContext);
  // ...
}
```

**3. Update Tool base class** to use context directly:
```typescript
// In tool.ts
protected resolveWorkspacePath(path: string, context?: ToolContext): string {
  const workspaceInfo = context?.workspaceInfo;  // From context, not Session!

  if (!workspaceInfo) {
    return this.resolvePath(path, context);
  }

  // Container mode translation
  if (workspaceInfo.mode === 'container') {
    const workspaceManager = context?.workspaceManager;
    // ... translation logic
  }

  // Local mode path resolution
  // ... resolution logic
}
```

**4. Remove Session import from tool.ts** - No more circular dependency!

### Pros
- ✅ **Minimal changes** - Only touches ToolExecutor and Tool base class
- ✅ **Clear responsibility** - ToolExecutor enriches context (that's its job)
- ✅ **No circular dependencies** - Tool doesn't import Session
- ✅ **Backward compatible** - Existing code continues to work
- ✅ **Testable** - Can test tools with mock contexts easily
- ✅ **Follows existing patterns** - ToolExecutor already enriches context with processEnv and toolTempDir

### Cons
- ⚠️ Context enrichment logic is in ToolExecutor (coupling to Session via agent.getFullSession())
- ⚠️ ToolExecutor indirectly depends on Session structure

---

## Design Option 2: Context Factory Pattern

### Overview
Introduce a ContextFactory that Session creates and passes to ToolExecutor. The factory knows how to build rich contexts without ToolExecutor needing Session knowledge.

### Implementation

**1. Create ContextFactory**:
```typescript
// NEW FILE: src/tools/context-factory.ts
export class ToolContextFactory {
  constructor(
    private workspaceInfo?: WorkspaceInfo,
    private workspaceManager?: IWorkspaceManager,
    private envManager?: ProjectEnvironmentManager,
    private projectId?: string
  ) {}

  createContext(baseContext: ToolContext): ToolContext {
    return {
      ...baseContext,
      workspaceInfo: this.workspaceInfo,
      workspaceManager: this.workspaceManager,
      processEnv: this.projectId
        ? { ...process.env, ...this.envManager?.getMergedEnvironment(this.projectId) }
        : process.env,
    };
  }
}
```

**2. Session creates and passes factory to ToolExecutor**:
```typescript
// In session.ts
createConfiguredToolExecutor(): ToolExecutor {
  const contextFactory = new ToolContextFactory(
    this._workspaceInfo,
    this._workspaceManager,
    new ProjectEnvironmentManager(),
    this._sessionData.projectId
  );

  const toolExecutor = new ToolExecutor(contextFactory);  // Pass factory
  // ...
}
```

**3. ToolExecutor uses factory**:
```typescript
// In executor.ts
export class ToolExecutor {
  constructor(private contextFactory?: ToolContextFactory) {
    this.envManager = new ProjectEnvironmentManager();
  }

  async execute(toolCall: ToolCall, context: ToolContext): Promise<ToolResult> {
    // Use factory to enrich context
    const enrichedContext = this.contextFactory
      ? this.contextFactory.createContext(context)
      : context;

    const result = await tool.execute(toolCall.arguments, enrichedContext);
    // ...
  }
}
```

### Pros
- ✅ **Clean separation** - Factory encapsulates context creation logic
- ✅ **No circular dependencies** - Tool doesn't import Session
- ✅ **Testable** - Can inject mock factories
- ✅ **Explicit dependencies** - Factory constructor shows what's needed
- ✅ **Reusable** - Factory can be used in other contexts

### Cons
- ⚠️ **New abstraction** - Adds another class to understand
- ⚠️ **More moving parts** - Factory needs to be created and passed around
- ⚠️ **Breaks ToolExecutor constructor** - Currently takes no args

---

## Design Option 3: Lazy Context Resolution via Callbacks

### Overview
Pass callback functions to ToolExecutor that it can call when it needs workspace info. This inverts the dependency - ToolExecutor doesn't need to know about Session structure.

### Implementation

**1. Update ToolExecutor constructor**:
```typescript
export class ToolExecutor {
  constructor(
    private contextProviders?: {
      getWorkspaceInfo?: () => WorkspaceInfo | undefined;
      getWorkspaceManager?: () => IWorkspaceManager | undefined;
      getProjectEnv?: () => NodeJS.ProcessEnv;
    }
  ) {
    this.envManager = new ProjectEnvironmentManager();
  }
}
```

**2. Session passes callbacks**:
```typescript
// In session.ts
createConfiguredToolExecutor(): ToolExecutor {
  const toolExecutor = new ToolExecutor({
    getWorkspaceInfo: () => this.getWorkspaceInfo(),
    getWorkspaceManager: () => this.getWorkspaceManager(),
    getProjectEnv: () => {
      const projectId = this._sessionData.projectId;
      return projectId
        ? this.envManager.getMergedEnvironment(projectId)
        : {};
    },
  });
  // ...
}
```

**3. ToolExecutor calls providers**:
```typescript
// In executor.ts
async execute(toolCall: ToolCall, context: ToolContext): Promise<ToolResult> {
  let enrichedContext = { ...context };

  if (this.contextProviders) {
    enrichedContext.workspaceInfo = this.contextProviders.getWorkspaceInfo?.();
    enrichedContext.workspaceManager = this.contextProviders.getWorkspaceManager?.();
    enrichedContext.processEnv = {
      ...process.env,
      ...this.contextProviders.getProjectEnv?.(),
    };
  }

  const result = await tool.execute(toolCall.arguments, enrichedContext);
  // ...
}
```

### Pros
- ✅ **Inverted dependencies** - ToolExecutor doesn't know about Session
- ✅ **Flexible** - Can swap out providers easily
- ✅ **No circular dependencies** - Tool doesn't import Session
- ✅ **Lazy evaluation** - Only calls providers when needed

### Cons
- ⚠️ **Callback complexity** - Harder to reason about execution flow
- ⚠️ **Captures `this`** - Arrow functions capture Session instance
- ⚠️ **Breaks ToolExecutor constructor** - Currently takes no args
- ⚠️ **Testing complexity** - Need to mock callback functions

---

## Recommendation: Option 1 (Context Enrichment in ToolExecutor)

**Why Option 1 is best:**

1. **Minimal disruption** - Only two files change (executor.ts and tool.ts)
2. **Follows existing patterns** - ToolExecutor already enriches context
3. **Simple to understand** - Linear data flow, no new abstractions
4. **Easy to test** - Tools receive plain context objects
5. **Backward compatible** - No constructor changes

**Implementation steps:**
1. Add workspaceInfo and workspaceManager to ToolContext (done)
2. Update ToolExecutor.execute() to populate workspace fields
3. Update Tool.resolveWorkspacePath() to use context.workspaceInfo
4. Remove Session import from tool.ts
5. Remove getWorkspaceInfo() and getWorkspaceManager() helper methods from Tool

**Trade-off accepted:**
- ToolExecutor calls `agent.getFullSession()` which creates some coupling
- This is acceptable because ToolExecutor already depends on Agent (via ToolContext.agent)
- The coupling is explicit and localized to one method

**Alternative if we want even cleaner separation:**
- Start with Option 1 for immediate fix
- Refactor to Option 2 (Factory) later if ToolExecutor becomes too Session-aware