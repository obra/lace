# Visible Prompts Implementation Plan

## Goal
Make the system prompt and user instructions visible in the conversation timeline by having the Agent record what it's actually sending to the AI model.

## Background
Currently, the system prompt is generated and applied at the CLI level, passed to providers, but users can't see what prompt was actually sent to the AI. User instructions from `LACE_DIR/instructions.md` are also invisible. We want these to appear as the first timeline items with collapsible UI, representing exactly what the Agent configures the Provider to use.

## Architecture Change

### Current Architecture (problematic):
```
CLI → createProvider(loads prompts) → Provider(with systemPrompt) 
CLI → new Agent(provider)
Agent → uses pre-configured provider
```

### New Architecture (simple, clean):
```
CLI → createProvider() → Provider (no system prompt)
CLI → new Agent(provider)
Agent.start() → loads prompts → provider.setSystemPrompt() → records events
```

**Key insight:** Agent controls Provider configuration and records exactly what it configures.

## Implementation Approach

### 1. New Event Types ✅ COMPLETED
Add to `src/threads/types.ts`:
- `SYSTEM_PROMPT` - The fully generated system prompt sent to the AI model
- `USER_SYSTEM_PROMPT` - Content from `LACE_DIR/instructions.md`

### 2. Custom Display Components ✅ COMPLETED
Create specialized React components with collapsible UI:

**`src/interfaces/terminal/components/events/SystemPromptDisplay.tsx`** ✅
- Renders the generated system prompt
- Collapsible with header showing "System Prompt" 
- Content foldable to save screen space
- Similar styling to existing event components

**`src/interfaces/terminal/components/events/UserSystemPromptDisplay.tsx`** ✅
- Renders user instructions from `LACE_DIR/instructions.md`
- Collapsible with header showing "User Instructions"
- Content foldable to save screen space

### 3. Event Display Integration ✅ COMPLETED
Update `src/interfaces/terminal/components/events/EventDisplay.tsx`:
- Add new event types to `componentMap`
- Route `SYSTEM_PROMPT` → `SystemPromptDisplay`
- Route `USER_SYSTEM_PROMPT` → `UserSystemPromptDisplay`

### 4. Provider API Changes ✅ COMPLETED
Add simple prompt configuration methods to Provider interface:

**Update Provider interface (`src/providers/types.ts`):** ✅
```typescript
export abstract class AIProvider extends EventEmitter {
  // Add these methods:
  setSystemPrompt(systemPrompt: string): void;
  get systemPrompt(): string;
  
  // Existing API unchanged:
  abstract createResponse(messages: ProviderMessage[], tools: Tool[]): Promise<ProviderResponse>;
  // etc...
}
```

### 5. Agent Start Logic ✅ COMPLETED  
Modify `Agent.start()` to load prompts and configure provider:

**Update Agent.start() (`src/agents/agent.ts`):**
```typescript
async start(): Promise<void> {
  // Load prompts when starting
  const promptConfig = await loadPromptConfig({ tools: this._tools });
  
  // Configure provider with loaded system prompt
  this._provider.setSystemPrompt(promptConfig.systemPrompt);
  
  // Record events for new conversations only
  const events = this._threadManager.getEvents(this._threadId);
  const hasConversationStarted = events.some(e => 
    e.type === 'USER_MESSAGE' || e.type === 'AGENT_MESSAGE'
  );
  
  if (!hasConversationStarted) {
    this._threadManager.addEvent(this._threadId, 'SYSTEM_PROMPT', promptConfig.systemPrompt);
    this._threadManager.addEvent(this._threadId, 'USER_SYSTEM_PROMPT', promptConfig.userInstructions);
  }
  
  this._isRunning = true;
}
```

### 6. CLI Simplification ✅ COMPLETED
Remove system prompt loading from `createProvider()`:

**Update CLI (`src/cli.ts`):**
- Remove prompt loading from `createProvider()` function
- Create providers without system prompt configuration
- Let Agent handle all prompt loading and configuration

### 7. Conversation Building Updates ✅ COMPLETED
Update `buildConversationFromEvents` in `src/agents/agent.ts`:
- Skip `SYSTEM_PROMPT` and `USER_SYSTEM_PROMPT` events when building provider messages
- These are UI-only events representing what was sent, similar to `LOCAL_SYSTEM_MESSAGE`
- System prompt already included in provider configuration

## Technical Details

### Event Data Structure
```typescript
// SYSTEM_PROMPT event
{
  type: 'SYSTEM_PROMPT',
  data: '<generated system prompt content>'
}

// USER_SYSTEM_PROMPT event  
{
  type: 'USER_SYSTEM_PROMPT',
  data: '<content from LACE_DIR/instructions.md>'
}
```

### UI Behavior
- Both prompt types start collapsed by default
- Users can expand to see full content
- Consistent styling with existing event components
- Should not interfere with conversation flow

### Agent Flow (New)
1. `new Agent(provider, ...)` → Agent receives unconfigured provider
2. `agent.start()` → Agent loads prompts, configures provider, records events for new conversations
3. `agent.sendMessage()` → Agent records USER_MESSAGE, calls provider, records AGENT_MESSAGE

## Implementation Order

### Phase 1: Core Infrastructure ✅ COMPLETED
1. ✅ Add new event types to `types.ts`
2. ✅ Create `SystemPromptDisplay.tsx` component
3. ✅ Create `UserSystemPromptDisplay.tsx` component  
4. ✅ Update `EventDisplay.tsx` componentMap
5. ✅ Update `buildConversationFromEvents` to handle new types

### Phase 2: Provider API Changes ✅ COMPLETED
6. ✅ Add `setSystemPrompt()` and `get systemPrompt()` to Provider base class
7. ✅ Update Anthropic and OpenAI providers to use new system prompt API
8. ✅ Add system prompt support to LMStudio provider (was missing)
9. ✅ Add system prompt support to Ollama provider (was missing)
10. ✅ Remove system prompt from all Provider constructors

### Phase 3: Agent Changes ✅ COMPLETED  
11. ✅ Make `Agent.start()` async and add prompt loading logic
12. ✅ Add prompt config loading imports to Agent

### Phase 4: CLI Changes ✅ COMPLETED
13. ✅ Remove prompt loading from `createProvider()` function
14. ✅ Update all provider creation to not pass system prompts

### Phase 5: Cleanup ✅ COMPLETED
15. ✅ Remove ThreadManager.injectSystemPromptEvents() method (incorrect approach)
16. ✅ Update tests for new Agent.start() behavior
17. ✅ Test complete flow with new architecture

## Current Status

**✅ COMPLETED:** All implementation phases finished successfully!
**✅ Working:** UI components display system prompts correctly with collapsible interface
**✅ Working:** buildConversationFromEvents skips UI-only events correctly  
**✅ Working:** Provider API with setSystemPrompt/get systemPrompt methods
**✅ Working:** Agent.start() loads prompts and configures provider automatically
**✅ Working:** CLI simplified - providers created without system prompts
**✅ Working:** All providers (Anthropic, OpenAI, LMStudio, Ollama) support system prompts
**✅ Working:** Tests updated for async Agent.start() behavior
**✅ Working:** Complete end-to-end flow with clean architecture

## Detailed Code Changes Required

### Files to Modify:

#### `src/providers/types.ts` 
- Add `setSystemPrompt(systemPrompt: string): void` to AIProvider base class
- Add `get systemPrompt(): string` to AIProvider base class  
- Add protected `_systemPrompt: string` field

#### `src/providers/anthropic-provider.ts`
- Remove `systemPrompt` from constructor config
- Implement `setSystemPrompt()` and `get systemPrompt()` methods
- Use `this._systemPrompt` in `createResponse()` instead of constructor config

#### `src/providers/openai-provider.ts` 
- Same changes as anthropic-provider.ts

#### `src/providers/lmstudio-provider.ts`
- Add system prompt support (currently missing)
- Implement `setSystemPrompt()` and `get systemPrompt()` methods  
- Use `this._systemPrompt` in API calls

#### `src/providers/ollama-provider.ts`
- Add system prompt support (currently missing)
- Implement `setSystemPrompt()` and `get systemPrompt()` methods
- Use `this._systemPrompt` in API calls

#### `src/agents/agent.ts`
- Add imports: `import { loadPromptConfig } from '../config/prompts.js'`
- Change `start(): void` to `async start(): Promise<void>`
- Add prompt loading and provider configuration logic to start()
- Add new conversation detection and event recording

#### `src/cli.ts`
- Remove prompt loading from `createProvider()` function
- Remove `promptConfig` variable and related logic
- Update `agent.start()` call to be awaited since it's now async

#### Files to Clean Up:
- `src/threads/thread-manager.ts` - Remove `injectSystemPromptEvents()` method
- `src/threads/__tests__/thread-manager.test.ts` - Remove tests for incorrect approach
- `src/agents/__tests__/agent.test.ts` - Update tests for async `start()` method

## Migration Notes
- This is a minimal, targeted change that maintains existing APIs except for Provider configuration
- Agent.start() becomes async but that's the only breaking change to Agent API
- Provider constructors lose systemPrompt parameter but gain setSystemPrompt() method
- The architecture becomes much cleaner with clear separation of concerns
- Agent truly owns conversation flow while Provider becomes pure execution layer