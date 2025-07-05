# Retry Logic Implementation Plan

## Overview
Add retry logic with exponential backoff for LLM API calls to handle transient network failures and rate limits.

## Background Context

### What is Lace?
Lace is an AI coding assistant that uses an event-sourcing architecture. User messages and AI responses are stored as events that can be replayed to reconstruct conversations.

### Key Architecture Components
1. **Agent** (`src/agents/agent.ts`): Orchestrates conversations between users and AI providers
2. **Providers** (`src/providers/`): Abstractions over different AI services (Anthropic, OpenAI, local models)
3. **Terminal Interface** (`src/interfaces/terminal-interface.tsx`): React-based UI using Ink (React for CLI)

### Current Request Flow
1. User sends message → Agent receives it
2. Agent calls `provider.createResponse()` or `provider.createStreamingResponse()`
3. Provider makes HTTP request to AI service
4. Response flows back through Agent → UI

### Current Error Handling
- Errors bubble up from providers to Agent
- Agent catches errors and emits `error` events
- UI displays errors to user
- **Built-in retry logic**:
  - Anthropic SDK: 2 retries, exponential backoff (0.5-8s)
  - OpenAI SDK: 2 retries, exponential backoff (0.5-8s)
  - Local providers (LMStudio, Ollama): No retry logic

## Requirements

### Functional Requirements
1. Add retry logic for all providers with consistent UI experience
2. Maximum 10 retry attempts for all providers
3. Only retry transient errors (network, rate limits, server errors)
4. Preserve abort functionality during retries
5. Show retry status in UI

### Non-Functional Requirements
1. No configuration options - hardcoded retry behavior
2. Minimal performance impact
3. Clean, testable implementation
4. Preserve streaming behavior

## Technical Specification

### Retry Parameters (Hardcoded)
```typescript
const RETRY_CONFIG = {
  maxRetries: 10,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
  jitterFactor: 0.1  // ±10% randomization
};
```

### Retryable Errors
```typescript
// Network errors
- ECONNREFUSED, ENOTFOUND, ETIMEDOUT, ECONNRESET, EHOSTUNREACH

// HTTP status codes
- 408 (Request Timeout)
- 429 (Too Many Requests)
- 502 (Bad Gateway)
- 503 (Service Unavailable)
- 504 (Gateway Timeout)

// Provider-specific errors (check error message)
- "Model loading failed" (LMStudio)
- "Insufficient resources" (LMStudio)
- "Cannot connect to server" (Ollama)
```

### Non-Retryable Errors
- Authentication errors (401, 403)
- Client errors (400, 422)
- User abort (AbortError)
- Context window exceeded
- Any error once streaming has started

## Implementation Strategy

### Provider-Level Retry with Agent Coordination
1. **Each provider implements its own retry logic** - They understand their specific error patterns and streaming behavior
2. **Base retry functionality in AIProvider** - Shared retry utilities for all providers
3. **Agent forwards retry events** - Ensures consistent UI experience across all providers
4. **All providers use 10 retry attempts** - Ignoring any internal SDK retries

This approach respects the existing architecture while providing consistent retry visibility and UI experience across all providers.

## Implementation Tasks

### Task 1: Extend AIProvider Base Class with Retry Support
**File**: `src/providers/base-provider.ts`

**TDD Steps**:
1. Write test file: `src/providers/__tests__/base-provider.test.ts`
2. Test: `isRetryableError()` identifies network errors
3. Test: `isRetryableError()` identifies HTTP 5xx errors
4. Test: `isRetryableError()` returns false for auth errors
5. Test: `calculateBackoffDelay()` returns correct delays
6. Test: `calculateBackoffDelay()` applies jitter
7. Test: `withRetry()` successful call returns immediately
8. Test: `withRetry()` retryable error triggers retry
9. Test: `withRetry()` emits retry events
10. Test: `withRetry()` respects abort signal
11. Test: `withRetry()` streaming detection prevents retry after first token

**Implementation**:
```typescript
// Add to AIProvider class
protected readonly RETRY_CONFIG = {
  maxRetries: 10,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
  jitterFactor: 0.1
};

// Add new event types
emit(event: 'retry_attempt', data: { attempt: number; delay: number; error: Error }): void;
emit(event: 'retry_exhausted', data: { attempts: number; lastError: Error }): void;

protected isRetryableError(error: unknown): boolean {
  // Check for network errors (Node.js error codes)
  // Check for HTTP status codes
  // Can be overridden by subclasses for provider-specific errors
}

protected calculateBackoffDelay(attempt: number): number {
  // Exponential backoff with jitter
  // Clamp to maxDelayMs
}

protected async withRetry<T>(
  operation: () => Promise<T>,
  options?: { 
    maxAttempts?: number;
    isStreaming?: boolean;
    canRetry?: () => boolean;
  }
): Promise<T> {
  // Retry loop with exponential backoff
  // Check abort signal before each retry
  // Emit retry events
  // Check canRetry callback for streaming
}
```

**Commit**: "feat: add retry support to AIProvider base class"

### Task 2: Implement Retry in AnthropicProvider
**File**: `src/providers/anthropic-provider.ts`

**TDD Steps**:
1. Write test file: `src/providers/__tests__/anthropic-provider-retry.test.ts`
2. Test: Non-streaming requests use retry wrapper
3. Test: Streaming requests use retry wrapper with streaming detection
4. Test: Uses full 10 retry attempts
5. Test: Provider-specific errors are handled

**Implementation**:
```typescript
async createResponse(messages: ProviderMessage[], options?: AnthropicProviderConfig): Promise<ProviderResponse> {
  // Wrap existing implementation with retry
  return this.withRetry(
    async () => {
      // Existing Anthropic SDK call
      const response = await this.anthropic.messages.create(...);
      return this.convertResponse(response);
    }
    // Uses default maxAttempts: 10
  );
}

async createStreamingResponse(
  messages: ProviderMessage[],
  options?: AnthropicProviderConfig
): Promise<AsyncGenerator<ProviderStreamEvent>> {
  let streamingStarted = false;
  
  return this.withRetry(
    async () => {
      const stream = await this.anthropic.messages.create({ stream: true, ... });
      
      // Track when streaming starts
      const wrappedStream = this.wrapStream(stream, () => {
        streamingStarted = true;
      });
      
      return wrappedStream;
    },
    { 
      isStreaming: true,
      canRetry: () => !streamingStarted
    }
    // Uses default maxAttempts: 10
  );
}
```

**Commit**: "feat: add retry logic to AnthropicProvider"

### Task 3: Implement Retry in OpenAIProvider
**File**: `src/providers/openai-provider.ts`

**Similar to Task 2, but for OpenAI**:
- Uses full 10 retry attempts
- Handle OpenAI-specific error patterns
- Implement streaming detection

**Commit**: "feat: add retry logic to OpenAIProvider"

### Task 4: Implement Retry in LMStudioProvider
**File**: `src/providers/lmstudio-provider.ts`

**TDD Steps**:
1. Write test file: `src/providers/__tests__/lmstudio-provider-retry.test.ts`
2. Test: Uses full 10 retry attempts
3. Test: Provider-specific errors like "Model loading failed"
4. Test: Streaming detection works correctly

**Implementation**:
```typescript
protected isRetryableError(error: unknown): boolean {
  // Call parent implementation first
  if (super.isRetryableError(error)) return true;
  
  // LMStudio-specific errors
  const message = error?.message || '';
  return message.includes('Model loading failed') ||
         message.includes('Insufficient resources');
}

async createResponse(...): Promise<ProviderResponse> {
  return this.withRetry(
    async () => {
      // Existing fetch implementation
    }
    // Uses default maxAttempts: 10
  );
}
```

**Commit**: "feat: add retry logic to LMStudioProvider"

### Task 5: Implement Retry in OllamaProvider
**File**: `src/providers/ollama-provider.ts`

**Similar to Task 4**:
- Full 10 retry attempts
- Ollama-specific error patterns
- Streaming detection

**Commit**: "feat: add retry logic to OllamaProvider"

### Task 6: Update Agent to Forward Retry Events
**File**: `src/agents/agent.ts`

**Changes**:
1. Add retry event types to `AgentEvents` interface:
   ```typescript
   'retry_attempt': [{ attempt: number; delay: number; error: Error; provider: string }];
   'retry_exhausted': [{ attempts: number; lastError: Error; provider: string }];
   ```

2. Set up provider event forwarding:
   ```typescript
   private setupProviderListeners() {
     this._provider.on('retry_attempt', (data) => {
       this.emit('retry_attempt', { ...data, provider: this._provider.providerName });
     });
     
     this._provider.on('retry_exhausted', (data) => {
       this.emit('retry_exhausted', { ...data, provider: this._provider.providerName });
     });
   }
   ```

3. Clean up listeners on abort/cleanup

**Test**: Update `src/agents/__tests__/agent.test.ts`
- Test that retry events are forwarded correctly
- Test cleanup of listeners

**Commit**: "feat: forward provider retry events in Agent"

### Task 7: Add UI Support for Retry Status and User Control
**File**: `src/interfaces/terminal-interface.tsx`

**What is Ink?**: 
- Ink is React for building CLI apps
- Components use React hooks and JSX
- Renders to terminal instead of DOM

**Changes**:
1. Add retry state to TerminalInterface component
2. Listen for `retry_attempt` and `retry_exhausted` events
3. Display retry status with attempt count and delay
4. Show "Press Ctrl+C to cancel retries" during delays
5. Handle retry exhaustion with clear error message

**Implementation**:
```typescript
// Add to component state
const [retryStatus, setRetryStatus] = useState<{attempt: number; delay: number} | null>(null);
const [retryExhausted, setRetryExhausted] = useState<{attempts: number; provider: string} | null>(null);

// In useEffect for agent listeners
agent.on('retry_attempt', ({ attempt, delay }) => {
  setRetryStatus({ attempt, delay });
  // Clear after delay
  setTimeout(() => setRetryStatus(null), delay);
});

agent.on('retry_exhausted', ({ attempts, provider }) => {
  setRetryExhausted({ attempts, provider });
  // Clear after 10 seconds
  setTimeout(() => setRetryExhausted(null), 10000);
});

// In render, show retry status if active
{retryStatus && (
  <Box flexDirection="column">
    <Text color="yellow">
      ⟳ Retrying due to network error... (attempt {retryStatus.attempt}/10)
    </Text>
    <Text dimColor>
      Next attempt in {Math.ceil(retryStatus.delay / 1000)}s • Press Ctrl+C to cancel
    </Text>
  </Box>
)}

{retryExhausted && (
  <Box borderStyle="round" borderColor="red" paddingX={1}>
    <Text color="red">
      Failed after {retryExhausted.attempts} retry attempts. 
      Check your connection and try again.
    </Text>
  </Box>
)}
```

**Test manually**: Hard to unit test Ink components, test via manual verification

**Commit**: "feat: add retry status and exhaustion handling to UI"


### Task 8: Add Retry Metrics to Turn Tracking
**File**: `src/agents/agent.ts`

**Changes**:
1. Add to `TurnMetrics` interface:
   ```typescript
   retryCount?: number;
   totalRetryDelayMs?: number;
   ```

2. Track retry attempts in turn metrics
3. Update metrics on each retry

**Commit**: "feat: add retry metrics to turn tracking"

### Task 9: Integration Testing
**File**: `src/agents/__tests__/agent-retry-integration.test.ts` (new)

Write end-to-end tests:
1. Mock provider to simulate network errors
2. Test full retry flow with Agent
3. Verify events emitted correctly
4. Test abort scenarios
5. Test streaming vs non-streaming

**Commit**: "test: add retry integration tests"

### Task 10: Documentation
**Files**:
- Update `CLAUDE.md` with retry behavior
- Update inline comments in code

**Commit**: "docs: document retry behavior"

## Testing Guide

### Manual Testing Scenarios

1. **Simulate Network Failure**:
   ```bash
   # Start Lace
   npm start
   
   # In another terminal, block network to API
   # macOS: sudo pfctl -e -f /etc/pf.conf
   # Add rule to block api.anthropic.com
   
   # Send message in Lace - should see retries
   ```

2. **Test with Flaky Local Provider**:
   ```bash
   # Start Ollama/LMStudio
   # Send message
   # Stop server mid-request
   # Should see retry attempts
   ```

3. **Test Abort During Retry**:
   ```bash
   # Trigger network error
   # During retry delay, press Ctrl+C
   # Should cancel cleanly
   ```

### Automated Testing
```bash
# Run specific test suites
npm test retry.test.ts
npm test retry-wrapper.test.ts
npm test agent-retry.test.ts

# Run all tests
npm test
```

## Code Review Checklist
- [ ] All functions have unit tests
- [ ] Retry logic preserves abort functionality
- [ ] No retry after streaming starts
- [ ] UI shows retry status clearly
- [ ] Metrics track retry attempts
- [ ] No hardcoded magic numbers (use constants)
- [ ] Error messages are helpful
- [ ] Memory leaks prevented (cleanup listeners)

## Potential Gotchas
1. **Double retry**: Anthropic/OpenAI SDKs will retry 2 times internally in addition to our 10 retries
2. **Streaming complexity**: Must track if streaming started - only retry before first token
3. **Abort handling**: Check signal.aborted before delays and between retries
4. **Memory leaks**: Clean up event listeners properly (especially streaming listeners)
5. **Total time**: With 10 retries at max 30s delay each, worst case is ~5 minutes of retrying
6. **Error classification**: Some errors may look retryable but aren't (e.g., model not found)

## Design Decisions

### Addressing Key Concerns

1. **Consistent UI Experience**: By implementing retry logic at the provider level with event forwarding, users see retry status consistently across all providers.

2. **Retry Exhaustion UX**: 
   - Clear error message: "Failed after X retry attempts. Check your connection and try again."
   - Error stays visible for 10 seconds
   - User can immediately retry by sending their message again
   - No automatic recovery - user maintains control

3. **User Control During Retries**:
   - "Press Ctrl+C to cancel" shown during retry delays
   - Abort signal checked between each retry
   - Users can cancel at any time without waiting for all retries

4. **Streaming First Token Failure**:
   - Each provider tracks when streaming starts using their specific event patterns
   - Retries work normally until first token arrives
   - Once streaming starts, no retries (to avoid duplicate content)
   - Clean error message if stream fails after starting

5. **Provider-Specific Error Handling**:
   - Each provider can override `isRetryableError()` for their specific error patterns
   - Base class handles common network and HTTP errors
   - Clean separation of concerns

## Success Criteria
1. Network interruptions don't immediately fail conversations
2. Users see clear retry status in UI for all providers
3. Users can cancel retries with Ctrl+C
4. Retry exhaustion shows helpful error messages
5. No performance degradation for successful calls
6. All tests pass