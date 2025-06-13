# Model/Provider Refactoring Plan

## Core Principle: Simplify, Don't Overbuild

**Problem**: TypeScript errors from incomplete interfaces, awkward routing through providers for model metadata, unnecessary specialized chat methods.

**Solution**: Models as first-class objects with stateful instances for caching.

## Overview

### Current Issues
- TypeScript errors from incomplete `BaseModelProvider` interface
- Model metadata (context window, pricing) awkwardly routed through providers
- Specialized chat methods (`planningChat`, `executionChat`, `reasoningChat`) are overengineered
- Agents use string model names instead of model objects

### Target Architecture
- **Model Definitions**: Static metadata (context window, pricing, capabilities)
- **Model Instances**: Stateful sessions with caching support
- **Model Provider**: Factory for model sessions, simplified interface
- **Agents**: Bind to model instances, not provider + model name

## Phase 1: New Interfaces (Zero Breaking Changes)

### Files to Create:

**1. `src/models/model-definition.ts`**
```typescript
export interface ModelDefinition {
  name: string;
  provider: string;
  contextWindow: number;
  inputPrice: number;        // per million tokens
  outputPrice: number;       // per million tokens
  capabilities: string[];
}
```

**2. `src/models/model-instance.ts`**
```typescript
export interface ModelInstance {
  definition: ModelDefinition;
  chat(messages: any[], options?: ChatOptions): Promise<any>;
}

export interface ChatOptions {
  tools?: any[];
  maxTokens?: number;
  temperature?: number;
  onTokenUpdate?: (update: any) => void;
}

export interface SessionOptions {
  sessionId?: string;
  enableCaching?: boolean;
}
```

**3. `test/with-mocks/unit/model-definition.test.ts`** (NEW)
```typescript
// Test ModelDefinition interface and registry
```

**4. `test/with-mocks/unit/model-instance.test.ts`** (NEW)
```typescript
// Test ModelInstance interface and session behavior
```

## Phase 2: Update Model Registry

### Files to Modify:

**1. `src/models/model-registry.ts`**
- Add `ModelDefinition` registry alongside existing provider registry
- Add `getModelDefinition(name: string): ModelDefinition`
- Keep existing provider methods unchanged

**2. `test/with-mocks/unit/model-registry.test.ts`** (NEW)
```typescript
// Test model definition storage and retrieval
```

## Phase 3: Update ModelProvider

### Files to Modify:

**1. `src/models/model-provider.ts`**
- Add `getModelSession(modelName: string, options?: SessionOptions): ModelInstance`
- Keep all existing methods for backward compatibility
- Fix TypeScript errors by adding proper interfaces

**2. `test/with-mocks/unit/model-providers.test.js`**
- Add tests for `getModelSession()` method
- Test that model instances maintain session state
- Keep all existing tests unchanged

**3. `test/with-mocks/__mocks__/model-provider.js`**
- Add mock `getModelSession()` method
- Return mock ModelInstance objects

## Phase 4: Update Anthropic Provider

### Files to Modify:

**1. `src/models/providers/anthropic-provider.js`**
- Implement `BaseModelProvider` interface completely
- Move model definitions to ModelRegistry
- Create internal ModelInstance wrapper class

**2. `test/with-mocks/unit/model-providers.test.js`**
- Update to test new interface compliance
- Test model definition retrieval
- Keep all session tracking tests

## Phase 5: Update Agent Construction

### Files to Modify:

**1. `src/agents/agent.ts`**
- Add optional `model?: ModelInstance` to constructor
- Keep `assignedModel`/`assignedProvider` for backward compatibility
- Update `generateResponse()` to use model instance when available

**2. `test/with-mocks/unit/agent.test.ts`**
- Add tests for model instance usage
- Test backward compatibility with existing pattern

**3. `test/with-mocks/unit/agent.test.ts`**
- Update mock expectations for new interface

## Phase 6: Update Agent Roles

### Files to Modify:

**1. `src/agents/roles/*.js` (all role files)**
- Keep existing `defaultModel` and `defaultProvider` 
- Add `getModelInstance()` helper method

## Phase 7: Remove Specialized Chat Methods

### Files to Modify:

**1. `src/models/model-provider.ts`**
- Delete `planningChat()`, `executionChat()`, `reasoningChat()`
- Update any callers to use regular `chat()`

**2. `test/with-mocks/unit/model-providers.test.js`**
- Remove tests for specialized methods

## Phase 8: Integration Testing

### Files to Modify:

**1. `test/no-mocks/integration/step13-lace-backend.test.tsx`**
- Verify integration still works with new interfaces
- Test that agents can use both old and new patterns

## Target Usage Patterns

### Before (Current)
```typescript
// Agent construction
this.assignedModel = "claude-3-5-sonnet-20241022";
this.assignedProvider = "anthropic";

// Usage
await this.modelProvider.chat(messages, {
  provider: this.assignedProvider,
  model: this.assignedModel,
  tools: this.tools
});

// Specialized methods
await this.modelProvider.planningChat(messages, options);
```

### After (Target)
```typescript
// Agent construction
this.model = options.modelProvider.getModelSession(
  options.assignedModel || this.roleDefinition.defaultModel,
  { sessionId: this.id }
);

// Usage
await this.model.chat(messages, {
  tools: this.tools,
  temperature: this.temperature
});

// No specialized methods - behavior comes from prompts and tools
```

## Test Strategy

### New Test Files:
1. `test/with-mocks/unit/model-definition.test.ts`
2. `test/with-mocks/unit/model-instance.test.ts` 
3. `test/with-mocks/unit/model-registry.test.ts`

### Updated Test Files:
1. `test/with-mocks/unit/model-providers.test.js` - Add new interface tests
2. `test/with-mocks/unit/agent.test.ts` - Add model instance tests
3. `test/with-mocks/__mocks__/model-provider.js` - Add new mock methods
4. `test/no-mocks/integration/step13-lace-backend.test.tsx` - Verify integration

### Test Commands:
```bash
npm run test:unit           # Run unit tests only
npm run test:integration    # Run integration tests
npm run test               # Run all tests
npm run typecheck          # Verify TypeScript
```

## Migration Strategy

1. **Add interfaces alongside existing code** (no breaking changes)
2. **Update AnthropicProvider to implement new interface** 
3. **Update one agent role to use new pattern**
4. **Test thoroughly**
5. **Migrate remaining agents**
6. **Remove old specialized methods**

## What We're NOT Building

- ❌ Complex model capability discovery
- ❌ Dynamic model selection algorithms  
- ❌ Multiple caching strategies
- ❌ Model performance monitoring
- ❌ Cross-provider model comparison

## Success Criteria

- ✅ TypeScript compilation without errors
- ✅ All existing tests pass
- ✅ Agents work exactly as before
- ✅ Cleaner agent construction code
- ✅ Model metadata no longer routed through providers
- ✅ Backward compatibility maintained
- ✅ No performance regressions

**Estimated effort**: 4-6 hours with proper testing.

## Implementation Notes

- Keep YAGNI in mind - build only what's needed
- Maintain backward compatibility throughout
- Test each phase before moving to the next
- Focus on simplicity and ease of use
- No complex abstractions or over-engineering