# Responses API: Implement previous_response_id Chaining

## Problem

We're currently sending the ENTIRE conversation history (500+ events, ~108K tokens) with every Responses API request. This:
- Wastes bandwidth sending 108K tokens over the wire
- Causes rate limit errors (124K tokens requested per call)
- Prevents prompt caching from working effectively
- Makes every request slow and expensive

## Root Cause

The Responses API supports stateful conversations via `previous_response_id`, but we're not using it. Instead, we're treating it like Chat Completions and sending full history.

## How Responses API Should Work

```typescript
// First turn
const response1 = await openai.responses.create({
  model: "gpt-5-codex",
  instructions: "system prompt",
  input: "user message",
  tools: [...],
  store: true
});

// Save response1.id

// Subsequent turns - DON'T send full history!
const response2 = await openai.responses.create({
  model: "gpt-5-codex",
  previous_response_id: response1.id,  // ← Links to previous state
  input: [
    { role: "user", content: "next message" }
    // Only NEW input - OpenAI has the rest server-side
  ],
  tools: [...],  // Tools must be resent
  store: true
});
```

## Key Insights from Docs

1. **previous_response_id chains responses** - OpenAI stores state server-side
2. **You still get billed for all chained tokens** - but you don't SEND them over wire
3. **Prompt caching works automatically** - 50-90% discount on cached tokens
4. **Tool calls/results in current turn must be included** in input
5. **Responses stored for 30 days** (unless store=false)
6. **Instructions NOT carried over** - must resend if changed

## Implementation Plan

### 1. Thread Metadata Storage

Add to thread metadata:
```typescript
interface ThreadMetadata {
  // ... existing fields
  openaiResponseId?: string;  // Last response.id from OpenAI Responses API
  openaiLastInstructions?: string;  // Last system prompt sent
}
```

### 2. Update `_createResponsesAPIPayload`

Current behavior:
```typescript
// Converts ALL messages to input items
for (const msg of messages.filter((m) => m.role !== 'system')) {
  // Add ALL history
}
```

New behavior:
```typescript
private _createResponsesAPIPayload(
  messages: ProviderMessage[],
  tools: Tool[],
  model: string,
  stream: boolean,
  previousResponseId?: string  // ← New parameter
): {
  payload: ResponseCreateParams;
  toolNameMapping: Map<string, string>;
} {
  // ... tool setup ...

  let inputItems: Array<unknown> = [];

  if (previousResponseId) {
    // ONLY include messages since last response
    // Find the last AGENT_MESSAGE event and take everything after
    const lastAgentMessageIndex = messages.findLastIndex(m => m.role === 'assistant');
    const newMessages = messages.slice(lastAgentMessageIndex + 1);

    // Convert only NEW messages to input items
    inputItems = this._convertMessagesToInputItems(newMessages, mapping);
  } else {
    // First turn - include all history
    inputItems = this._convertMessagesToInputItems(
      messages.filter(m => m.role !== 'system'),
      mapping
    );
  }

  return {
    payload: {
      model,
      instructions,
      input: inputItems,
      max_output_tokens: this._config.maxTokens || this.getModelMaxOutputTokens(model, 16384),
      stream,
      ...(previousResponseId && { previous_response_id: previousResponseId }),
      ...(tools.length > 0 && { tools: responsesTools }),
      store: true,  // ← Enable server-side storage
    },
    toolNameMapping: mapping
  };
}
```

### 3. Extract Message Conversion Logic

```typescript
private _convertMessagesToInputItems(
  messages: ProviderMessage[],
  toolNameMapping: Map<string, string>
): Array<unknown> {
  const inputItems: Array<unknown> = [];

  for (const msg of messages) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      // Add text message if present
      if (msg.content && msg.content.trim()) {
        inputItems.push({
          role: msg.role,
          content: msg.content,
        });
      }

      // Add tool calls as separate items
      if (msg.toolCalls) {
        for (const toolCall of msg.toolCalls) {
          const sanitizedName =
            Array.from(toolNameMapping.entries())
              .find(([_, orig]) => orig === toolCall.name)?.[0] || toolCall.name;
          inputItems.push({
            type: 'function_call',
            call_id: toolCall.id,
            name: sanitizedName,
            arguments: JSON.stringify(toolCall.arguments),
          });
        }
      }

      // Add tool results as separate items
      if (msg.toolResults) {
        for (const result of msg.toolResults) {
          inputItems.push({
            type: 'function_call_output',
            call_id: result.id,
            output: result.content.map(c => c.text || '').join('\n'),
          });
        }
      }
    }
  }

  return inputItems;
}
```

### 4. Update Provider Methods

Both streaming and non-streaming need to:
1. Get `previousResponseId` from somewhere (thread metadata? passed as param?)
2. Pass it to `_createResponsesAPIPayload`
3. Store the new `response.id` after successful response

### 5. Thread Integration

The challenge: Providers are stateless, but we need to track response IDs per thread.

**Option A: Pass via ProviderMessage metadata**
```typescript
interface ProviderMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  metadata?: {
    openaiResponseId?: string;  // For Responses API chaining
  };
}
```

**Option B: Pass as method parameter**
```typescript
async createStreamingResponse(
  messages: ProviderMessage[],
  tools: Tool[],
  model: string,
  signal?: AbortSignal,
  conversationState?: {  // ← New parameter
    openaiResponseId?: string;
  }
): Promise<ProviderResponse & { responseId?: string }>
```

**Option C: Store in ProviderConfig (problematic - shared across calls)**

**Recommendation: Option B** - explicit parameter, clear semantics

### 6. Agent Integration

Agent needs to:
1. Track last `openaiResponseId` in thread metadata
2. Pass it to provider when calling Responses API models
3. Update it after each successful response

```typescript
// In Agent._createStreamingResponse or _createNonStreamingResponse
private async _createStreamingResponse(): Promise<ProviderResponse> {
  // ... existing code ...

  // Get conversation state for Responses API
  const thread = this._threadManager.getThread(this._threadId);
  const conversationState = thread?.metadata?.openaiResponseId
    ? { openaiResponseId: thread.metadata.openaiResponseId }
    : undefined;

  const response = this._providerInstance.supportsStreaming
    ? await this._providerInstance.createStreamingResponse(
        conversation,
        this._toolExecutor.getAllTools(),
        modelId,
        this._abortController?.signal,
        conversationState  // ← Pass state
      )
    : await this._providerInstance.createResponse(
        conversation,
        this._toolExecutor.getAllTools(),
        modelId,
        this._abortController?.signal,
        conversationState  // ← Pass state
      );

  // Store new response ID if provider returned one
  if ('responseId' in response && response.responseId) {
    // Update thread metadata with new response ID
    this._threadManager.updateThreadMetadata(this._threadId, {
      ...thread?.metadata,
      openaiResponseId: response.responseId
    });
  }

  return response;
}
```

### 7. Return Response ID

Update ProviderResponse type:
```typescript
export interface ProviderResponse {
  content: string;
  toolCalls: ToolCall[];
  stopReason?: string;
  usage?: { ... };
  performance?: { ... };
  responseId?: string;  // ← Add for Responses API
}
```

## Implementation Steps

1. **Update ProviderMessage type** to support conversation state parameter
2. **Extract `_convertMessagesToInputItems` helper** from current inline logic
3. **Update `_createResponsesAPIPayload`** to:
   - Accept `previousResponseId` parameter
   - Only convert messages after last agent response when chaining
   - Add `previous_response_id` and `store: true` to payload
4. **Update `_parseResponsesAPIResponse`** to return `response.id`
5. **Update both streaming and non-streaming** Responses API methods
6. **Add Agent integration** to track and pass response IDs
7. **Test with long conversation** to verify token reduction

## Expected Results

**Before:**
- Sending: 108K tokens over wire per request
- Billed: 124K tokens (108K input + 16K max output)
- Rate limit: Hit after 4 requests

**After:**
- Sending: ~500-2000 tokens over wire (just new messages + tool results)
- Billed: 124K tokens (full chain, but 90% cached = ~12K effective cost)
- Rate limit: Much less likely, and when hit, properly retried

## Testing Strategy

1. Create test with mock Responses API that tracks input size
2. Verify first call includes full history
3. Verify second call only includes new input + has previous_response_id
4. Verify thread metadata stores response IDs correctly
5. Integration test with real conversation flow

## Risks & Considerations

- **Breaking change** to provider interface (new optional parameter)
- **Thread metadata** needs migration if we change structure
- **Response ID cleanup** - 30 day TTL, what happens after?
- **Model switches mid-conversation** - need to restart chain
- **Error handling** - if previous_response_id is invalid, fall back to full history
