# Token Management and Streaming Architecture Plan

## Overview

This document outlines the comprehensive plan for implementing robust token management and preventing token exhaustion issues in Lace. The plan addresses the core problem where LLMs hit `max_tokens` limits mid-tool-call, creating incomplete tool calls that break conversation flow.

## Problem Statement

**Root Issue**: LLM hits `max_tokens` during tool call generation, creating incomplete tool calls with missing required parameters. This causes:
- Tool execution failures ("Content must be a string")
- API errors when sending empty error content to providers
- Broken conversation state and user experience

## ✅ **SOLUTION IMPLEMENTED**

**The original token exhaustion bug has been resolved through a comprehensive two-layer approach:**

1. **Reactive Protection** (Phase 1): StopReasonHandler filters incomplete tool calls when max_tokens is reached
2. **Proactive Prevention** (Phase 2): TokenBudgetManager tracks usage and blocks requests that would exceed limits

**Result**: 
- ✅ Zero crashes from incomplete tool calls
- ✅ Proactive budget management prevents token exhaustion
- ✅ 26 new tests ensure reliability  
- ✅ All existing functionality preserved

## Architecture Principles

- **YAGNI**: Only implement features needed to solve token exhaustion
- **DRY**: Reusable token management across all providers
- **Simple**: Clear single-responsibility components
- **Testable**: Each component unit-testable in isolation
- **Well-factored**: Clean separation between concerns

## Current State (✅ Completed)

### 1. SDK Upgrades
- **Anthropic SDK**: Upgraded from 0.30.1 → 0.54.0
  - ✅ `client.beta.messages.countTokens()` API now available
  - ✅ Enhanced `response.usage` data for exact token counts
  - ✅ Access to `response.stop_reason` for detecting max_tokens
- **LMStudio SDK**: 1.2.1 (latest) with token counting support
- **Ollama SDK**: 0.5.16 (latest) with response token data

### 2. Universal Streaming Support
- **✅ Anthropic**: Already had full streaming support
- **✅ Ollama**: Added `supportsStreaming: true` and `createStreamingResponse()`
- **✅ LMStudio**: Added streaming interface exposing internal streaming
- **✅ Agent**: Now defaults to streaming for all providers that support it

**Benefits of Streaming-First**:
- Real-time user feedback during generation
- Early detection of approaching token limits
- Better control over response completion
- Foundation for advanced token management

## Implementation Phases

### Phase 1: Stop Reason Foundation ✅ **COMPLETED**
**Goal**: Prevent broken tool calls from crashing the system

#### Components
1. **Enhanced ProviderResponse Interface**
   ```typescript
   interface ProviderResponse {
     content: string;
     toolCalls: ProviderToolCall[];
     metadata?: {
       usage?: { inputTokens: number; outputTokens: number };
       stopReason?: string;
       modelInfo?: string;
     };
   }
   ```

2. **StopReasonHandler** (Single responsibility)
   ```typescript
   interface StopReasonHandler {
     handleResponse(response: ProviderResponse, stopReason: string): ProviderResponse;
   }
   ```
   - Detects `max_tokens` stop reason
   - Filters out incomplete tool calls (missing required parameters)
   - Logs token exhaustion events
   - Returns cleaned response with only complete tool calls

#### Provider Updates
- **Anthropic**: Return `usage` and `stop_reason` in metadata
- **LMStudio**: Return available token data in metadata
- **Ollama**: Return `prompt_eval_count` and `eval_count` in metadata

#### Implementation Status ✅
- ✅ **ProviderResponse Enhanced**: Added `stopReason`, `usage`, and `performance` fields
- ✅ **All Providers Updated**: Anthropic, Ollama, and LMStudio return rich metadata
- ✅ **StopReasonHandler**: Filters incomplete tool calls when max_tokens reached
- ✅ **Agent Integration**: Integrated into both streaming and non-streaming responses
- ✅ **Comprehensive Tests**: All functionality tested and verified

#### Tests ✅
- ✅ 19 unit tests for StopReasonHandler covering all scenarios
- ✅ Integration tests with Agent class confirmed working
- ✅ 434 total tests passing, only LMStudio integration tests failing (expected - requires LMStudio server)

### Phase 2: Token Budget Management ✅ **COMPLETED**
**Goal**: Proactive token management using provider APIs

#### Components
1. **TokenBudgetManager** (Centralized tracking)
   ```typescript
   interface TokenBudgetManager {
     calculateContextSize(messages: ProviderMessage[]): Promise<number>;
     getAvailableBudget(maxTokens: number, contextSize: number): number;
     shouldPruneContext(contextSize: number, maxTokens: number): boolean;
   }
   ```
   - Uses provider-specific token counting APIs:
     - Anthropic: `client.beta.messages.countTokens()`
     - LMStudio: `llm.countTokens()`
     - Ollama: Estimate from response data
   - Reserves minimum budget for responses (e.g., 500 tokens)
   - Triggers context pruning when budget is low

2. **Enhanced ConversationBuilder** (Token-aware)
   ```typescript
   interface ConversationBuilder {
     buildConversation(events: ThreadEvent[]): ProviderMessage[];
     estimateTokens(messages: ProviderMessage[]): Promise<number>;
     pruneToTokenLimit(messages: ProviderMessage[], limit: number): ProviderMessage[];
   }
   ```

#### Agent Integration
```typescript
// Before sending request
const tokenCount = await this._conversationBuilder.estimateTokens(messages);
if (tokenCount > TOKEN_BUDGET) {
  messages = await this._conversationBuilder.pruneToTokenLimit(messages, TOKEN_BUDGET);
}
```

#### Provider Capabilities
| Provider | Token Counting | Token Limits | Streaming |
|----------|---------------|--------------|-----------|
| Anthropic | ✅ Proactive + Reactive | ✅ | ✅ |
| LMStudio | ✅ Proactive + Reactive | ✅ | ✅ |
| Ollama | 🟡 Reactive only | ✅ | ✅ |

#### Implementation Status ✅
- ✅ **TokenBudgetManager**: Comprehensive token tracking with configurable limits and reserves
- ✅ **Agent Integration**: Budget monitoring with warnings and request blocking
- ✅ **Proactive Prevention**: Blocks requests that would exceed budget before sending
- ✅ **Warning System**: Emits events when approaching limits with optimization recommendations
- ✅ **Optional Configuration**: Works seamlessly when enabled, no impact when disabled

#### Tests ✅
- ✅ 19 unit tests for TokenBudgetManager covering all functionality
- ✅ 7 integration tests for Agent-TokenBudgetManager integration
- ✅ All scenarios covered: tracking, warnings, blocking, reset, edge cases

### Phase 3: Conversation Summarization (Next)
**Goal**: Maintain context while staying within token limits

#### Components
1. **ConversationPruner** (Message management)
   ```typescript
   interface ConversationPruner {
     pruneMessages(messages: ProviderMessage[], targetSize: number): ProviderMessage[];
   }
   ```
   - Identifies old message pairs (user + assistant) for summarization
   - Preserves recent messages (last N turns)
   - Preserves system messages and tool context

2. **MessageSummarizer** (Content compression)
   ```typescript
   interface MessageSummarizer {
     summarizeMessages(messages: ProviderMessage[]): ProviderMessage;
   }
   ```
   - Creates concise summaries of conversation segments
   - Uses simple template-based approach (YAGNI)
   - Maintains key context (tool results, important decisions)

#### Integration Points
- **ConversationBuilder**: Integrate with pruning logic
- **ThreadManager**: Support summarized message segments
- **Agent**: Apply pruning when budget is low

#### Tests
- Unit tests for pruning logic
- Integration tests for full summarization flow

### Phase 4: Advanced Features (Future)
**Goal**: Enhanced user experience and debugging

#### Token Visibility
- Agent events for token usage warnings
- CLI progress indicators for token consumption
- Debug information about context pruning

#### Fallback Strategies
- Automatic model switching for large contexts
- Smart tool call deferral when approaching limits
- User prompts for context management preferences

## File Structure

```
src/
├── token-management/
│   ├── stop-reason-handler.ts
│   ├── token-budget-manager.ts  
│   ├── conversation-pruner.ts
│   ├── message-summarizer.ts
│   └── __tests__/
├── providers/
│   ├── anthropic-provider.ts (enhanced)
│   ├── ollama-provider.ts (enhanced)
│   └── lmstudio-provider.ts (enhanced)
├── threads/
│   └── conversation-builder.ts (token-aware)
└── agents/
    └── agent.ts (budget management)
```

## Error Handling Strategy

### Graceful Degradation
1. **Incomplete tool calls** → text-only response  
2. **Token exhaustion** → context pruning + retry
3. **Summarization failure** → simple truncation

### User Feedback
- Emit events for token budget warnings
- Log context pruning actions
- Expose token usage in agent state

## Testing Strategy

### Unit Tests
- Each component isolated with mocks
- Token calculation accuracy
- Stop reason detection logic

### Integration Tests
- Full conversation flows with token limits
- Provider-specific token counting
- Context pruning workflows

### Regression Tests
- Reproduce original token exhaustion scenario
- Verify incomplete tool call handling

### Performance Tests
- Token counting API response times
- Memory usage during context pruning

## Success Metrics

1. **Zero broken tool calls** due to token exhaustion
2. **Graceful handling** of max_tokens scenarios
3. **Accurate token tracking** across all providers
4. **Seamless user experience** with automatic context management
5. **Maintainable architecture** with clear separation of concerns

## Benefits

- **Immediate**: Fixes token exhaustion crashes
- **User Experience**: Real-time streaming, no broken conversations
- **Developer Experience**: Clear token visibility and debugging
- **Scalability**: Foundation for advanced context management
- **Reliability**: Robust error handling and fallback strategies

## Dependencies

- Anthropic SDK 0.54.0+ (token counting API)
- LMStudio SDK 1.2.1+ (token utilities)
- Ollama SDK 0.5.16+ (response token data)
- Universal streaming support (✅ implemented)

---

*This plan provides a comprehensive, phased approach to solving token management while maintaining code quality and user experience.*