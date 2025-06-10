# Conversation Memory & Performance TODO

## Phase 1: Fix Basic Conversation Memory (Critical)

### Task 1.1: Write failing test for conversation memory ✅

- [x] Create `test/no-mocks/integration/conversation-memory.test.js`
- [x] Test: Agent remembers previous message in same session
- [x] Verify test fails (confirms current bug)
- [x] Integration test with real database

### Task 1.2: Add conversation history retrieval to Agent ✅

- [x] Modify `Agent.generateResponse()` in `src/agents/agent.ts`
- [x] Add `getConversationHistory(sessionId, 10)` call before building messages
- [x] Convert DB format to LLM message format with `convertHistoryToMessages()`
- [x] Exclude current user message to avoid duplication
- [x] Run test - passes ✅

### Task 1.3: Handle tool calls in conversation history ✅

- [x] Update conversation history conversion to include tool_calls
- [x] Parse `tool_calls` JSON from database
- [x] Format for LLM message structure
- [x] Handle malformed JSON gracefully

## Phase 2: Add Accurate Token Counting ✅

### Task 2.1: Add token counting method to AnthropicProvider ✅

- [x] Add `countTokens(messages)` method to `src/models/providers/anthropic-provider.js`
- [x] Use Anthropic's beta token counting API with `"token-counting-2024-11-01"`
- [x] Return precise token count with error handling
- [x] Write comprehensive unit tests with mocking
- [x] ~30 lines of code + tests

### Task 2.2: Replace token estimation with accurate counting ✅

- [x] Update `Agent.generateResponse()` to use real token counts
- [x] Count tokens before agentic loop starts
- [x] Initialize context size with accurate count
- [x] Add debug logging for token counting
- [x] Add integration test to verify functionality

### Task 2.3: Add smart conversation truncation ✅

- [x] Implement `truncateConversationHistory()` helper in Agent
- [x] Keep recent messages, truncate older ones based on token limits (70% of context)
- [x] Preserve system prompt and recent conversation flow
- [x] Test with long conversations and verify truncation behavior
- [x] ~60 lines of code + comprehensive test

## Phase 3: Implement Prompt Caching ✅

### Task 3.1: Add cache control to system prompts ✅

- [x] Update `anthropic-provider.js` to support `cache_control` parameter
- [x] Add cache control to system message formatting with `"prompt-caching-2024-07-31"` beta
- [x] Write test for cache control parameter presence
- [x] Support caching in both `chat()` and `countTokens()` methods

### Task 3.2: Implement conversation history caching ✅

- [x] Add caching strategy to conversation history in `Agent.generateResponse()`
- [x] Cache system prompt (always)
- [x] Cache stable conversation history (older messages)
- [x] Fresh content for recent messages (last 2 messages kept fresh)
- [x] Add `applyCachingStrategy()` method to Agent

### Task 3.3: Add cache performance tracking ✅

- [x] Track `cache_creation_input_tokens` and `cache_read_input_tokens`
- [x] Add to usage statistics in agent response
- [x] Log cache hit rates in debug mode
- [x] Update Usage interface to include cache metrics

## Phase 4: Enhanced Streaming ✅

### Task 4.1: Handle additional streaming events ✅

- [x] Update `handleStreamResponse()` in anthropic-provider
- [x] Handle `message_delta`, `content_block_start`, `content_block_stop`
- [x] Better tool use streaming with progress notifications
- [x] Add content block index tracking
- [x] Enhanced error handling for tool parsing

### Task 4.2: Add "extended thinking" support ✅

- [x] Support thinking content blocks in streaming
- [x] Forward thinking tokens to UI separately via `onThinkingToken` callback
- [x] Add thinking state change notifications via `onThinkingState` callback
- [x] Add tool event notifications via `onToolEvent` callback
- [x] Enhanced verbose mode with thinking and tool indicators
- [x] Comprehensive test coverage for all streaming enhancements

## Phase 5: Polish & Optimization ✅

### Task 5.1: Add conversation metrics ✅

- [x] Track conversation length, token usage, cache hits per session
- [x] Add to status display via enhanced `getStatus()` method
- [x] Expose via `getStatus()` in LaceUI
- [x] Include session uptime, cache hit rates, and activity tracking
- [x] Comprehensive test coverage

### Task 5.2: Add configuration options ✅

- [x] Make conversation history limit configurable
- [x] Add cache strategy options: 'aggressive', 'conservative', 'disabled'
- [x] Add context utilization and fresh message count configuration
- [x] Document in CLAUDE.md with usage examples
- [x] Add `updateConversationConfig()` method for runtime updates
- [x] Test coverage for configuration functionality

## Acceptance Criteria

**Memory Fixed**: Agent remembers within single session
**Accuracy**: Precise token counting, not estimation
**Maintainable**: Clean, simple implementation
**Tested**: Each feature has passing tests

## Files Modified

- `src/agents/agent.ts` (conversation history, caching)
- `src/models/providers/anthropic-provider.js` (token counting, cache control)
- `test/unit/conversation-memory.test.js` (new)
- `CLAUDE.md` (configuration docs)

## Success Metrics

- Conversation memory test passes
- Token count accuracy within 1% of Anthropic API
- Cache hit rate >80% for stable conversations
- No performance regression in streaming
- Code diff <100 lines total
