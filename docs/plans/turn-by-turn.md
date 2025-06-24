# Turn-by-Turn Progress Tracking and Abort Mechanism

## Overview

This spec defines improvements to the user experience during model processing by adding:
- Real-time progress tracking for the current turn (time elapsed, tokens in/out)
- Immediate abort capability with Ctrl+C
- Input protection during model processing
- Provider-agnostic token counting with estimation fallback

## Current Architecture Analysis (Updated)

The existing codebase provides excellent foundations:
- **Agent class** (`src/agents/agent.ts`): Event-driven with state management (idle, thinking, streaming, tool_execution)
- **Provider abstraction** (`src/providers/types.ts`): Supports streaming via EventEmitter
- **Terminal interface** (`src/interfaces/terminal/terminal-interface.tsx`): Ink-based React UI with existing token tracking and processing states

### ✅ What Already Exists:
- Event-driven Agent architecture with states and _setState() method
- Token usage tracking in terminal interface (tokenUsage state, handleTokenUsageUpdate)
- Streaming token events (agent_token, token_usage_update) 
- Basic SIGINT handling for graceful shutdown
- React-based input management with isProcessing state
- Agent._processConversation() method ready for enhancement

### 🚀 Ready to Build:
- Turn-based metrics tracking (new concept for Agent)
- AbortController integration in providers (all providers confirmed compatible)
- Enhanced Ctrl+C handling (abort vs exit distinction)
- Progress timer for elapsed time tracking
- React-based input protection during processing

### 📋 Provider AbortSignal Support Status:
- **Anthropic SDK v0.54.0**: ✅ Confirmed (signal?: AbortSignal in RequestOptions)
- **OpenAI SDK v4.104.0**: ✅ Confirmed (signal?: AbortSignal in RequestOptions)
- **LMStudio SDK v1.2.1**: ✅ Confirmed (signal?: AbortSignal in multiple interfaces + cancel() methods)
- **Ollama SDK v0.5.16**: ✅ Confirmed (AbortableAsyncIterator with abort() method)

## Requirements

### Progress Tracking
- Track metrics from start of user input through all model calls and tool executions
- Show elapsed time, tokens sent up, tokens sent down for current turn only
- Update at least every second, more frequently during token streaming
- Reset counters on each new user input

### Abort Mechanism
- Single Ctrl+C aborts current operation immediately
- Save partial results obtained so far (don't discard progress)
- Double Ctrl+C exits Lace gracefully when no operation is running

### Input Protection
- Prevent new input submission while model is processing
- Queue input in readline buffer automatically
- Return/Enter should not work during processing

### Token Counting
- Use provider-native token counts when available
- Fall back to character-based estimation (~4 chars per token)
- Track both input and output tokens for current turn

## Implementation Design (Updated for React/Ink Interface)

**IMPORTANT**: This implementation targets the React/Ink-based terminal interface at `src/interfaces/terminal/terminal-interface.tsx`, not a readline-based CLI. All input protection and UI updates use React state management.

### 1. Turn-Based Progress Tracking

Extend the Agent class to track metrics per user turn:

```typescript
// src/agents/agent.ts
export interface CurrentTurnMetrics {
  startTime: Date;
  elapsedMs: number;
  tokensIn: number;     // User input + tool results + model context
  tokensOut: number;    // Model responses + tool calls
  turnId: string;       // Unique ID for this user turn
}

export interface AgentEvents {
  // Existing events...
  turn_start: [{ turnId: string; userInput: string }];
  turn_progress: [{ metrics: CurrentTurnMetrics }];
  turn_complete: [{ turnId: string; metrics: CurrentTurnMetrics }];
  turn_aborted: [{ turnId: string; metrics: CurrentTurnMetrics }];
}

export class Agent extends EventEmitter {
  private _currentTurnMetrics: CurrentTurnMetrics | null = null;
  private _progressTimer: NodeJS.Timeout | null = null;
  
  async sendMessage(content: string): Promise<void> {
    // Start new turn tracking
    this._startTurnTracking(content);
    
    // Add user message tokens to current turn
    this._addTokensToCurrentTurn('in', this._estimateTokens(content));
    
    await this._processConversation();
  }
  
  private _startTurnTracking(userInput: string): void {
    const turnId = `turn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this._currentTurnMetrics = {
      startTime: new Date(),
      elapsedMs: 0,
      tokensIn: 0,
      tokensOut: 0,
      turnId
    };
    
    this.emit('turn_start', { turnId, userInput });
    this._startProgressTimer();
  }
  
  private _startProgressTimer(): void {
    this._progressTimer = setInterval(() => {
      if (this._currentTurnMetrics) {
        this._currentTurnMetrics.elapsedMs = Date.now() - this._currentTurnMetrics.startTime.getTime();
        this.emit('turn_progress', { metrics: { ...this._currentTurnMetrics } });
      }
    }, 1000); // Every second
  }
  
  private _addTokensToCurrentTurn(direction: 'in' | 'out', tokens: number): void {
    if (this._currentTurnMetrics) {
      if (direction === 'in') {
        this._currentTurnMetrics.tokensIn += tokens;
      } else {
        this._currentTurnMetrics.tokensOut += tokens;
      }
      
      // Emit immediate progress update on token changes
      this._currentTurnMetrics.elapsedMs = Date.now() - this._currentTurnMetrics.startTime.getTime();
      this.emit('turn_progress', { metrics: { ...this._currentTurnMetrics } });
    }
  }
  
  private _clearProgressTimer(): void {
    if (this._progressTimer) {
      clearInterval(this._progressTimer);
      this._progressTimer = null;
    }
  }
}
```

### 2. Abort Mechanism with Ctrl+C Handling

Add abort capability to Agent and smart Ctrl+C handling to CLI:

```typescript
// src/agents/agent.ts
export class Agent extends EventEmitter {
  private _abortController: AbortController | null = null;
  
  abort(): boolean {
    if (this._abortController && this._currentTurnMetrics) {
      this._abortController.abort();
      this._clearProgressTimer();
      
      // Emit abort event with current metrics
      this.emit('turn_aborted', { 
        turnId: this._currentTurnMetrics.turnId, 
        metrics: { ...this._currentTurnMetrics } 
      });
      
      this._currentTurnMetrics = null;
      this._setState('idle');
      return true; // Successfully aborted
    }
    return false; // Nothing to abort
  }
  
  private async _processConversation(): Promise<void> {
    this._abortController = new AbortController();
    
    try {
      const response = await this._createResponse(
        conversation, 
        this._tools, 
        this._abortController.signal
      );
      
      // Track response tokens
      const tokenMetrics = this._extractTokenMetrics(response);
      this._addTokensToCurrentTurn('out', tokenMetrics.outputTokens || this._estimateTokens(response.content));
      
    } catch (error) {
      if (error.name === 'AbortError') {
        // Abort was called - don't treat as error, metrics already emitted
        return;
      }
      throw error;
    } finally {
      this._abortController = null;
    }
  }
}

// src/interfaces/terminal/terminal-interface.tsx (TerminalInterface class)
export class TerminalInterface implements ApprovalCallback {
  private agent: Agent;
  private isRunning = false;
  private _ctrlCCount = 0;
  private _ctrlCTimer: NodeJS.Timeout | null = null;

  constructor(agent: Agent) {
    this.agent = agent;
  }

  async startInteractive(): Promise<void> {
    if (this.isRunning) {
      throw new Error("Terminal interface is already running");
    }

    this.isRunning = true;

    // Enhanced SIGINT handling for abort vs exit
    process.on("SIGINT", () => {
      // Try to abort current operation first
      const wasAborted = this.agent.abort();
      
      if (wasAborted) {
        console.log('\n⚠️  Operation aborted. Progress saved.');
        this._ctrlCCount = 0; // Reset double-ctrl-c counter
        return;
      }
      
      // No operation to abort - handle double Ctrl+C for exit
      this._ctrlCCount++;
      
      if (this._ctrlCCount === 1) {
        console.log('\n⚠️  Press Ctrl+C again to exit Lace.');
        this._ctrlCTimer = setTimeout(() => {
          this._ctrlCCount = 0; // Reset after 2 seconds
        }, 2000);
      } else if (this._ctrlCCount >= 2) {
        console.log('\n👋 Exiting Lace...');
        this.stop().then(() => process.exit(0));
      }
    });

    // Render the Ink app with fullscreen support
    withFullScreen(
      <TerminalInterfaceComponent
        agent={this.agent}
        approvalCallback={this}
      />
    ).start();

    // Keep the process running
    await new Promise<void>((resolve) => {
      // The interface will exit via process.exit() or SIGINT
    });
  }
}
```

### 3. Input Protection During Processing (React/Ink Based)

Use React state management to prevent input during processing:

```typescript
// src/interfaces/terminal/terminal-interface.tsx
const TerminalInterfaceComponent: React.FC<TerminalInterfaceProps> = ({
  agent,
  approvalCallback,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTurnActive, setIsTurnActive] = useState(false);
  
  // Handle turn lifecycle events
  useEffect(() => {
    const handleTurnStart = () => {
      setIsTurnActive(true);
      setIsProcessing(true);
    };
    
    const handleTurnComplete = () => {
      setIsTurnActive(false);
      setIsProcessing(false);
    };
    
    const handleTurnAborted = () => {
      setIsTurnActive(false);
      setIsProcessing(false);
    };
    
    agent.on('turn_start', handleTurnStart);
    agent.on('turn_complete', handleTurnComplete);
    agent.on('turn_aborted', handleTurnAborted);
    
    return () => {
      agent.off('turn_start', handleTurnStart);
      agent.off('turn_complete', handleTurnComplete);
      agent.off('turn_aborted', handleTurnAborted);
    };
  }, [agent]);
  
  return (
    <Box flexDirection="column" height="100%">
      {/* ... timeline display ... */}
      
      {/* Input area - disabled during turn processing */}
      <Box padding={1}>
        <ShellInput
          value={currentInput}
          placeholder={isTurnActive ? "Processing... Press Ctrl+C to abort" : "Type your message..."}
          onSubmit={handleSubmit}
          onChange={setCurrentInput}
          focusId="shell-input"
          disabled={isTurnActive} // Disable input during active turn
        />
      </Box>
    </Box>
  );
};
```

### 4. Provider-Specific AbortSignal Integration

Update each provider to support AbortSignal (all confirmed compatible):

```typescript
// src/providers/anthropic-provider.ts  
async createResponse(messages: ProviderMessage[], tools: Tool[] = [], signal?: AbortSignal): Promise<ProviderResponse> {
  const requestPayload = {
    // ... existing payload
  };

  const response = await this._anthropic.messages.create(requestPayload, {
    signal, // Pass AbortSignal to Anthropic SDK
  });
  
  return response;
}

// src/providers/openai-provider.ts
async createResponse(messages: ProviderMessage[], tools: Tool[] = [], signal?: AbortSignal): Promise<ProviderResponse> {
  const requestPayload = {
    // ... existing payload  
  };

  const response = await this._openai.chat.completions.create(requestPayload, {
    signal, // Pass AbortSignal to OpenAI SDK
  });
  
  return response;
}

// src/providers/lmstudio-provider.ts
async _createResponseWithNativeToolCalling(
  messages: ProviderMessage[],
  tools: Tool[],
  modelId: string,
  signal?: AbortSignal
): Promise<ProviderResponse> {
  return new Promise((resolve, reject) => {
    // LMStudio SDK supports signal in prediction config
    const predictionConfig = {
      // ... existing config
      signal, // Pass AbortSignal to LMStudio SDK
    };
    
    // ... rest of implementation
  });
}

// src/providers/ollama-provider.ts  
async createStreamingResponse(
  messages: ProviderMessage[],
  tools: Tool[] = [],
  signal?: AbortSignal
): Promise<ProviderResponse> {
  const response = await this._ollama.chat(requestPayload);
  
  // Handle abort via AbortableAsyncIterator
  if (signal) {
    signal.addEventListener('abort', () => {
      if (response && typeof response.abort === 'function') {
        response.abort(); // Use Ollama's AbortableAsyncIterator.abort()
      }
    });
  }
  
  // ... rest of implementation
}
```

### 5. Token Counting with Estimation Fallback

Extend provider abstraction to handle token counting (already partially exists):

```typescript
// src/providers/types.ts
export interface TokenMetrics {
  inputTokens?: number;
  outputTokens?: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
}

export abstract class AIProvider extends EventEmitter {
  // Token estimation for providers without native counting
  protected estimateTokens(text: string): number {
    // Rough approximation: 1 token ≈ 4 characters for most models
    return Math.ceil(text.length / 4);
  }
  
  protected extractTokenMetrics(response: any): TokenMetrics {
    // Default implementation - providers override for native token counts
    return {
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0
    };
  }
}

// src/providers/anthropic-provider.ts
export class AnthropicProvider extends AIProvider {
  protected extractTokenMetrics(response: Anthropic.Message): TokenMetrics {
    return {
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      // Fallback to estimation if usage data missing
      estimatedInputTokens: response.usage?.input_tokens || 0,
      estimatedOutputTokens: response.usage?.output_tokens || this.estimateTokens(
        response.content.filter(c => c.type === 'text').map(c => c.text).join('')
      )
    };
  }
}

// src/agents/agent.ts
export class Agent extends EventEmitter {
  private _estimateTokens(text: string): number {
    return this._provider.estimateTokens ? this._provider.estimateTokens(text) : Math.ceil(text.length / 4);
  }
  
  private _extractTokenMetrics(response: any): TokenMetrics {
    return this._provider.extractTokenMetrics(response);
  }
}
```

### 6. Enhanced Terminal Interface Progress Display

Enhanced React/Ink terminal interface with real-time turn progress:

```typescript
// src/interfaces/terminal/terminal-interface.tsx
const TerminalInterfaceComponent: React.FC<TerminalInterfaceProps> = ({
  agent,
  approvalCallback,
}) => {
  const [currentTurnMetrics, setCurrentTurnMetrics] = useState<CurrentTurnMetrics | null>(null);
  const [isTurnActive, setIsTurnActive] = useState(false);
  
  // Handle turn lifecycle events for progress tracking
  useEffect(() => {
    const handleTurnStart = ({ turnId, userInput, metrics }: { turnId: string; userInput: string; metrics: CurrentTurnMetrics }) => {
      setCurrentTurnMetrics(metrics);
      setIsTurnActive(true);
      setIsProcessing(true);
    };
    
    const handleTurnProgress = ({ metrics }: { metrics: CurrentTurnMetrics }) => {
      setCurrentTurnMetrics(metrics);
    };
    
    const handleTurnComplete = ({ turnId, metrics }: { turnId: string; metrics: CurrentTurnMetrics }) => {
      setCurrentTurnMetrics(null);
      setIsTurnActive(false);
      setIsProcessing(false);
      // Show completion message
      addMessage({
        type: "system",
        content: `✅ Turn completed in ${Math.floor(metrics.elapsedMs / 1000)}s (↑${metrics.tokensIn} ↓${metrics.tokensOut} tokens)`,
        timestamp: new Date(),
      });
    };
    
    const handleTurnAborted = ({ turnId, metrics }: { turnId: string; metrics: CurrentTurnMetrics }) => {
      setCurrentTurnMetrics(null);
      setIsTurnActive(false);
      setIsProcessing(false);
      // Show abort message
      addMessage({
        type: "system",
        content: `⚠️  Turn aborted after ${Math.floor(metrics.elapsedMs / 1000)}s (↑${metrics.tokensIn} ↓${metrics.tokensOut} tokens)`,
        timestamp: new Date(),
      });
    };
    
    agent.on('turn_start', handleTurnStart);
    agent.on('turn_progress', handleTurnProgress);
    agent.on('turn_complete', handleTurnComplete);
    agent.on('turn_aborted', handleTurnAborted);
    
    return () => {
      agent.off('turn_start', handleTurnStart);
      agent.off('turn_progress', handleTurnProgress);
      agent.off('turn_complete', handleTurnComplete);
      agent.off('turn_aborted', handleTurnAborted);
    };
  }, [agent, addMessage]);

  return (
    <Box flexDirection="column" height="100%">
      {/* Timeline - takes remaining space */}
      <Box flexGrow={1}>
        <ConversationDisplay 
          events={events}
          ephemeralMessages={ephemeralMessages}
          focusId="timeline"
          bottomSectionHeight={bottomSectionHeight}
        />
      </Box>

      {/* Bottom section with turn progress */}
      <Box flexDirection="column" flexShrink={0}>
        {/* Status bar with turn progress */}
        <StatusBar 
          providerName={agent.providerName || 'unknown'}
          modelName={(agent as any)._provider?.defaultModel || undefined}
          threadId={agent.threadManager.getCurrentThreadId() || undefined}
          tokenUsage={tokenUsage}
          isProcessing={isProcessing}
          messageCount={events.length + ephemeralMessages.length}
          turnMetrics={currentTurnMetrics} // Add turn progress to status bar
        />

        {/* Input area - disabled during active turn */}
        <Box padding={1}>
          <ShellInput
            value={currentInput}
            placeholder={
              isTurnActive 
                ? `Processing... ⏱️ ${currentTurnMetrics ? Math.floor(currentTurnMetrics.elapsedMs / 1000) : 0}s | Press Ctrl+C to abort`
                : "Type your message..."
            }
            onSubmit={handleSubmit}
            onChange={setCurrentInput}
            focusId="shell-input"
            disabled={isTurnActive} // Disable input during active turn
          />
        </Box>
      </Box>
    </Box>
  );
};

// Enhanced agent streaming to update progress more frequently
// src/agents/agent.ts
export class Agent extends EventEmitter {
  private async _createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[]
  ): Promise<AgentResponse> {
    this._setState('streaming');
    
    const tokenListener = ({ token }: { token: string }) => {
      // Add each token to current turn metrics for live updates
      this._addTokensToCurrentTurn('out', this._estimateTokens(token));
      this.emit('agent_token', { token });
    };
    
    this._provider.on('token', tokenListener);
    
    try {
      const response = await this._provider.createStreamingResponse(messages, tools, this._abortController?.signal);
      return response;
    } finally {
      this._provider.removeListener('token', tokenListener);
    }
  }
}
```

## Implementation Plan

**CRITICAL: Follow TDD for every phase. Write failing tests first, then implement just enough to make them pass.**

**STATUS: ✅ PLAN VALIDATED - ALL DEPENDENCIES CONFIRMED**
- All provider SDKs support AbortSignal/cancellation
- React/Ink terminal interface architecture understood  
- Existing event-driven foundation ready for extension
- Token tracking infrastructure already in place

### Phase 1: Core Progress Tracking

**Tests First:**
1. Write test: Agent emits `turn_start` event when `sendMessage()` called
2. Write test: Agent emits `turn_progress` events every ~1 second during processing
3. Write test: Agent emits `turn_complete` event with correct metrics
4. Write test: Turn metrics reset on each new user input
5. Write test: Turn ID is unique for each turn

**Implementation:**
1. Add `CurrentTurnMetrics` interface and tracking to Agent class
2. Implement turn start/progress/complete events
3. Add progress timer with 1-second updates

**Verify:** All progress tracking tests pass, existing Agent tests still pass

### Phase 2: Provider AbortSignal Integration

**Tests First:**
1. Write test: Anthropic provider accepts and uses AbortSignal
2. Write test: OpenAI provider accepts and uses AbortSignal  
3. Write test: LMStudio provider accepts and uses AbortSignal
4. Write test: Ollama provider handles abort via AbortableAsyncIterator
5. Write test: Provider calls are cancelled when signal is aborted

**Implementation:**
1. Update provider method signatures to accept optional AbortSignal
2. Pass AbortSignal to each SDK's request methods
3. Handle Ollama's AbortableAsyncIterator pattern
4. Update Agent to create and pass AbortController.signal

**Verify:** All provider abort tests pass, can cancel provider requests

### Phase 3: Token Counting Integration

**Tests First:**
1. Write test: Agent tracks input tokens from user message and context
2. Write test: Agent tracks output tokens from provider responses
3. Write test: Token counts update in real-time during streaming
4. Write test: Token estimation fallback works when usage data unavailable
5. Write test: Token metrics reset between turns

**Implementation:**
1. Use existing token tracking infrastructure in providers
2. Wire provider token usage into turn metrics
3. Add token estimation for providers without native counts
4. Update streaming token handlers

**Verify:** All token tracking tests pass, turn metrics show accurate counts

### Phase 4: Abort Mechanism

**Tests First:**
1. Write test: Agent.abort() returns true when operation is running
2. Write test: Agent.abort() returns false when no operation running
3. Write test: Agent emits `turn_aborted` event with partial metrics
4. Write test: Aborted operations don't emit `turn_complete`
5. Write test: Agent state returns to 'idle' after abort
6. Write test: AbortController.signal integrates with providers

**Implementation:**
1. Add AbortController support to Agent._processConversation
2. Implement Agent.abort() method
3. Wire abort signals through to providers (using Phase 2 work)
4. Add enhanced Ctrl+C handling to TerminalInterface

**Verify:** All abort tests pass, can manually abort long operations with Ctrl+C

### Phase 5: React/Ink Interface Integration

**Tests First:**
1. Write test: Terminal interface disables input when turn is active
2. Write test: Terminal interface re-enables input when turn completes/aborts
3. Write test: Progress display updates show correct elapsed time and tokens
4. Write test: Double Ctrl+C exits when no operation running
5. Write test: Single Ctrl+C aborts operation, double Ctrl+C exits after abort

**Implementation:**
1. Add React state management for turn-based input protection
2. Implement turn progress display in StatusBar component
3. Wire turn events to terminal interface state updates
4. Add turn completion/abort messaging as ephemeral messages
5. Update ShellInput placeholder to show turn progress

**Verify:** All terminal interface tests pass, manual testing shows input is disabled during processing

### Phase 6: Integration Testing & Polish

**Tests First:**
1. Write integration test: Complete turn with Anthropic provider
2. Write integration test: Complete turn with OpenAI provider  
3. Write integration test: Complete turn with LMStudio provider
4. Write integration test: Complete turn with Ollama provider
5. Write integration test: Abort during streaming response
6. Write integration test: Abort during tool execution
7. Write performance test: High-frequency progress updates don't degrade performance

**Implementation:**
1. Fix any issues found in integration tests
2. Performance optimizations if needed
3. Polish progress display formatting in terminal interface
4. Add any missing error handling
5. Test abort functionality across all providers

**Verify:** All integration tests pass, manual testing across all providers works smoothly

### Phase 7: Enhanced Token Tracking

**Goals:**
- Show cumulative session token counts in status bar 
- Display per-agent token totals in delegate boxes
- Add progressive token estimation for all providers during streaming

**Implementation:**
1. Update status bar to show cumulative ↑↓ tokens across all turns
2. Add token calculation and display to delegation boxes  
3. Implement progressive token estimation in Anthropic provider
4. Implement progressive token estimation in OpenAI provider
5. Implement progressive token estimation in LMStudio provider
6. Implement progressive token estimation in Ollama provider

**Technical Details:**
- Status bar tracks cumulative session tokens, updated on turn completion
- Delegation boxes estimate tokens from timeline content (~4 chars per token)
- Progressive estimation provides real-time ↑↓ updates during streaming
- Final provider token counts correct estimates when available
- All providers now emit `token_usage_update` events progressively

**Verify:** Real-time token updates work across all providers, cumulative counts persist across turns, delegate boxes show accurate per-agent totals

## Testing Requirements

- **Unit tests**: Every new method and event must have corresponding tests
- **Integration tests**: End-to-end testing of complete user interaction flows
- **Manual testing**: Verify UX improvements work as intended across all providers
- **Performance testing**: Ensure progress updates don't impact model response times
- **Error handling**: Test abort scenarios, network failures, and edge cases

Each phase must have 100% test coverage before moving to implementation. All existing tests must continue to pass throughout development.

## Benefits

- **Eliminates "wedged" feeling**: Clear indication that system is working
- **Immediate abort capability**: User can cancel long-running operations
- **Consistent UX**: Same progress tracking across all providers
- **Non-breaking changes**: Extends existing event-driven architecture
- **Graceful error handling**: Aborts save partial progress, no data loss

## Compatibility

This implementation:
- ✅ **Works with all existing providers**: Anthropic v0.54.0, OpenAI v4.104.0, LMStudio v1.2.1, Ollama v0.5.16
- ✅ **Maintains backward compatibility**: No breaking changes to existing interfaces
- ✅ **Requires no changes to tool implementations**: Tools continue to work unchanged
- ✅ **Extends existing event interfaces**: Builds on Agent's event-driven architecture
- ✅ **React/Ink compatible**: Designed for the existing terminal interface architecture

## Summary

**STATUS: ✅ READY FOR IMPLEMENTATION**

This comprehensive plan provides turn-by-turn progress tracking and abort capabilities for Lace's Agent system. Key achievements:

- **All provider SDKs confirmed compatible** with AbortSignal/cancellation
- **Existing architecture perfectly positioned** for turn tracking extension
- **React/Ink terminal interface** ready for input protection and progress display
- **Event-driven foundation** supports real-time progress updates
- **TDD approach** ensures robust implementation across 6 phases

The implementation will deliver immediate user value by eliminating the "wedged" feeling during long operations and providing instant abort capability with Ctrl+C.