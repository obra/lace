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

## Phase 4: Enhanced Streaming (Optional)

### Task 4.1: Handle additional streaming events

- [ ] Update `handleStreamResponse()` in anthropic-provider
- [ ] Handle `message_delta`, `content_block_start`, `content_block_stop`
- [ ] Better tool use streaming
- [ ] ~12 lines of code

### Task 4.2: Add "extended thinking" support

- [ ] Support thinking content blocks in streaming
- [ ] Forward thinking tokens to UI separately
- [ ] Add thinking display to UI components
- [ ] ~15 lines of code

## Phase 5: Polish & Optimization

### Task 5.1: Add conversation metrics

- [ ] Track conversation length, token usage, cache hits per session
- [ ] Add to status display
- [ ] Expose via `getStatus()` in LaceUI
- [ ] ~8 lines of code

### Task 5.2: Add configuration options

- [ ] Make conversation history limit configurable
- [ ] Add cache strategy options
- [ ] Document in CLAUDE.md
- [ ] ~5 lines of code

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
