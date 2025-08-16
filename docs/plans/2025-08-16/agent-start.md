# Agent Start/Initialization Refactor

## Problem

The current agent initialization system has several issues:

1. **Inconsistent session creation behavior**:
   - `Session.create()` creates agents but doesn't initialize them (no prompts, no events)
   - `Session.getById()` creates agents AND calls `start()` to initialize them
   - This leads to agents in different states depending on creation path

2. **Confusing `agent.start()` responsibilities**:
   - Loads prompts (expensive, should happen once)
   - Sets system prompt on provider (needed for fresh providers)
   - Records initial events (should happen once at creation)
   - Sets `_isRunning = true` (lifecycle management)

3. **Misleading `_isRunning` flag**:
   - Actually tracks "has been initialized" not "is actively running"
   - User-controllable operations use `agent.abort()`, not start/stop
   - `agent.stop()` is only for cleanup/teardown

4. **Lazy initialization pattern**:
   - `sendMessage()` and `continueConversation()` auto-call `start()` if not initialized
   - Creates fragile existence checks and expensive repeated operations

## Solution

### 1. Separate Initialization from Runtime Control

**Agent Constructor:**
- Fast, synchronous setup of basic state
- No expensive I/O operations

**Agent Initialization (new `_initialize()` method):**
- Load prompts from config (expensive, happens once)
- Record initial SYSTEM_PROMPT/USER_SYSTEM_PROMPT events (happens once)
- Set system prompt on provider (happens every time for fresh providers)
- Mark as initialized

**Agent Start/Stop (renamed for clarity):**
- `start()` → lightweight runtime control, ensures provider is configured
- `stop()` → cleanup/teardown only

### 2. Fix Session Creation Consistency

Both `Session.create()` and `Session.getById()` should create fully initialized agents:

```typescript
// Both paths use common agent creation
const agent = this.createInitializedAgent({
  provider, toolExecutor, threadManager, threadId, metadata
});
```

### 3. Rename Flags for Clarity

```typescript
// OLD
private _isRunning = false;  // Confusing - not about runtime state

// NEW  
private _initialized = false;  // Clear - tracks initialization state
```

## Detailed Changes

### Agent Class Changes

1. **New `_initialize()` method**:
   ```typescript
   private async _initialize(): Promise<void> {
     if (this._initialized) return; // idempotent
     
     // Load prompts (expensive, once)
     const promptConfig = await loadPromptConfig({ ... });
     this._promptConfig = promptConfig;
     
     // Record initial events (once)
     if (!this._hasInitialEvents()) {
       this._addInitialEvents(promptConfig);
     }
     
     // Configure provider (every time)
     this.providerInstance.setSystemPrompt(promptConfig.systemPrompt);
     
     this._initialized = true;
   }
   ```

2. **Simplified `start()` method**:
   ```typescript
   async start(): Promise<void> {
     await this._initialize();
     // Provider might be fresh, so always set system prompt
     if (this._promptConfig) {
       this.providerInstance.setSystemPrompt(this._promptConfig.systemPrompt);
     }
   }
   ```

3. **Update flag usage**:
   ```typescript
   // In sendMessage() and continueConversation()
   if (!this._initialized) {
     await this._initialize();
   }
   
   // In stop()
   stop(): void {
     this._initialized = false; // Mark as shut down
     // ... cleanup
   }
   ```

### Session Class Changes

1. **Simplify agent architecture**:
   Remove artificial distinction between "session agent" and "delegate agents" - they're all just agents that belong to the session:

   ```typescript
   export class Session {
     // Remove special _sessionAgent field
     private _agents: Map<ThreadId, Agent> = new Map();
     
     // Coordinator agent is just the one with sessionId as threadId
     getCoordinatorAgent(): Agent | null {
       return this._agents.get(this._sessionId) || null;
     }
   }
   ```

2. **Extract common agent creation**:
   ```typescript
   private async createAgent(params: {
     sessionData: SessionData;
     provider: AIProvider;
     toolExecutor: ToolExecutor;
     threadManager: ThreadManager;
     threadId: string;
     providerInstanceId: string;
     modelId: string;
   }): Promise<Agent> {
     const agent = new Agent({ ... });
     await agent._initialize(); // Ensure fully initialized
     return agent;
   }
   ```

3. **Consistent creation paths**:
   ```typescript
   // Session.create() - create coordinator like any other agent
   const coordinatorAgent = await this.createAgent({ 
     threadId: sessionId, 
     ... 
   });
   this._agents.set(sessionId, coordinatorAgent);
   
   // Session.getById() - same logic for all agents
   for (const threadId of allThreadIds) {
     const agent = await this.createAgent({ threadId, ... });
     this._agents.set(threadId, agent);
   }
   ```

### Event Recording Changes

Move initial event recording from `agent.start()` to agent initialization:

```typescript
private _addInitialEvents(promptConfig: PromptConfig): void {
  this._addEventAndEmit({
    type: 'SYSTEM_PROMPT',
    threadId: this._threadId,
    data: promptConfig.systemPrompt,
  });
  this._addEventAndEmit({
    type: 'USER_SYSTEM_PROMPT', 
    threadId: this._threadId,
    data: promptConfig.userInstructions,
  });
}

private _hasInitialEvents(): boolean {
  const events = this._threadManager.getEvents(this._threadId);
  return events.some(e => e.type === 'SYSTEM_PROMPT' || e.type === 'USER_SYSTEM_PROMPT');
}
```

## Implementation Plan

1. **Phase 1: Agent refactoring**
   - Add `_initialize()` method with prompt loading and event recording
   - Rename `_isRunning` to `_initialized` 
   - Update all references to use new flag name
   - Simplify `start()` to just call `_initialize()` + provider config

2. **Phase 2: Session consistency**
   - Remove artificial distinction between coordinator and delegate agents
   - Extract `createAgent()` helper method for all agents
   - Update `Session.create()` to use common agent creation
   - Update `Session.getById()` to use common agent creation
   - Simplify agent lookup and management (remove special `_sessionAgent` field)

3. **Phase 3: Testing**
   - Verify both session creation paths produce identical agent states
   - Test that expensive operations (prompt loading) only happen once
   - Test that provider reconfiguration works correctly
   - Update existing tests for new initialization pattern

## Benefits

1. **Consistent behavior**: Both session creation paths produce fully initialized agents
2. **Performance**: Expensive operations happen exactly once per agent
3. **Clarity**: Clear separation between initialization and runtime control
4. **Maintainability**: Single source of truth for agent creation logic
5. **Robustness**: Proper handling of provider recreation scenarios
6. **Architectural simplicity**: All agents treated uniformly, no special coordinator logic

## Breaking Changes

- `agent.start()` signature remains the same but behavior changes (becomes idempotent)
- `_isRunning` property renamed to `_initialized` (internal change)
- Agent constructor may need to become async (TBD - might keep sync constructor + lazy init)

## Testing Strategy

1. **Unit tests**: Verify initialization happens exactly once
2. **Integration tests**: Test both session creation paths produce identical results  
3. **Performance tests**: Verify prompt loading doesn't repeat unnecessarily
4. **Provider tests**: Verify system prompt gets reapplied to fresh providers