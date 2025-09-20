# Google Gemini Provider Implementation Plan - TDD/DRY/YAGNI

**Date:** 2025-09-16 **Status:** Planning **Scope:** Gemini API only (no Vertex
AI), Web UI configuration (no env vars)

## Project Overview

Implement native Google Gemini API support for Lace following strict Test-Driven
Development, keeping code DRY, and building only what's needed (YAGNI).

## Implementation Steps (TDD Order)

### Step 1: Update Catalog Data

**Files:** `packages/core/src/providers/catalog/data/gemini.json`

**Changes:**

- Update to current Gemini models (2.0-flash, 1.5-pro, 1.5-flash)
- Correct pricing and capabilities
- Set proper defaults

**Expected Models:**

```json
{
  "name": "Google Gemini",
  "id": "gemini",
  "type": "gemini",
  "api_key": "$GEMINI_API_KEY",
  "default_large_model_id": "gemini-1.5-pro",
  "default_small_model_id": "gemini-2.0-flash",
  "models": [
    {
      "id": "gemini-2.0-flash",
      "name": "Gemini 2.0 Flash",
      "context_window": 1000000,
      "default_max_tokens": 8192,
      "supports_attachments": false
    },
    {
      "id": "gemini-1.5-pro",
      "name": "Gemini 1.5 Pro",
      "context_window": 2000000,
      "default_max_tokens": 8192,
      "supports_attachments": true
    }
  ]
}
```

### Step 2: Write Failing Tests First (TDD)

**File:** `packages/core/src/providers/gemini-provider.test.ts`

**Test Suite Structure:**

```typescript
describe('GeminiProvider', () => {
  describe('Configuration', () => {
    it('should require API key');
    it('should return provider info');
    it('should validate configuration');
  });

  describe('Format Conversion', () => {
    it('should convert simple text messages');
    it('should handle tool calls in messages');
    it('should handle tool results in messages');
    it('should filter system messages correctly');
  });

  describe('Response Creation', () => {
    it('should handle basic text response');
    it('should parse tool calls from response');
    it('should extract usage metadata');
    it('should normalize stop reasons');
  });

  describe('Streaming', () => {
    it('should emit token events');
    it('should handle streaming response');
    it('should emit usage updates');
    it('should provide final response');
  });

  describe('Error Handling', () => {
    it('should handle API authentication errors');
    it('should retry on transient failures');
    it('should normalize error messages');
  });

  describe('Tool Integration', () => {
    it('should convert Lace tools to Gemini format');
    it('should handle function calling end-to-end');
    it('should parse function responses');
  });
});
```

### Step 3: Add Dependencies

**File:** `packages/core/package.json`

```bash
npm install @google/genai
```

### Step 4: Add Format Converter (TDD)

**File:** `packages/core/src/providers/format-converters.ts`

**Implementation:**

```typescript
/**
 * Converts enhanced ProviderMessage format to Gemini Content/Part format
 */
export function convertToGeminiFormat(messages: ProviderMessage[]): Content[] {
  return messages
    .filter((msg) => msg.role !== 'system') // System handled separately
    .map((msg): Content => {
      const parts: Part[] = [];

      // Add text content if present
      if (msg.content && msg.content.trim()) {
        parts.push({ text: msg.content });
      }

      if (msg.role === 'assistant' && msg.toolCalls) {
        // Add function calls
        msg.toolCalls.forEach((toolCall) => {
          parts.push({
            functionCall: {
              name: toolCall.name,
              args: toolCall.arguments,
            },
          });
        });
      }

      if (msg.role === 'user' && msg.toolResults) {
        // Add function responses
        msg.toolResults.forEach((result) => {
          parts.push({
            functionResponse: {
              name: result.toolName || '',
              response: {
                output: result.content.map((c) => c.text).join('\n'),
                ...(result.status !== 'completed'
                  ? { error: 'Tool execution failed' }
                  : {}),
              },
            },
          });
        });
      }

      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts,
      };
    });
}
```

**DRY Principles:**

- Reuse existing patterns from `convertToAnthropicFormat`
- Extract common message filtering logic
- Share tool conversion patterns

### Step 5: Implement Core Provider (TDD)

**File:** `packages/core/src/providers/gemini-provider.ts`

**Interface:**

```typescript
interface GeminiProviderConfig extends ProviderConfig {
  apiKey: string | null;
  [key: string]: unknown;
}
```

**Minimal Implementation (YAGNI):**

```typescript
export class GeminiProvider extends AIProvider {
  private _gemini: GoogleGenAI | null = null;

  constructor(config: GeminiProviderConfig) {
    super(config);
  }

  private getGeminiClient(): GoogleGenAI {
    if (!this._gemini) {
      const config = this._config as GeminiProviderConfig;
      if (!config.apiKey) {
        throw new Error('Missing API key for Gemini provider');
      }

      this._gemini = new GoogleGenAI({
        apiKey: config.apiKey,
        vertexai: false, // Gemini API only
      });
    }
    return this._gemini;
  }

  get providerName(): string {
    return 'gemini';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return this.withRetry(
      async () => {
        const requestPayload = this._createRequestPayload(
          messages,
          tools,
          model
        );

        const response =
          await this.getGeminiClient().models.generateContent(requestPayload);

        return this._parseResponse(response);
      },
      { signal }
    );
  }

  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return this.withRetry(
      async () => {
        const requestPayload = this._createRequestPayload(
          messages,
          tools,
          model,
          true
        );

        const stream =
          this.getGeminiClient().models.generateContentStream(requestPayload);

        return this._handleStreamingResponse(stream);
      },
      { signal, isStreaming: true }
    );
  }

  private _createRequestPayload(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    streaming = false
  ) {
    const contents = convertToGeminiFormat(messages);
    const systemInstruction = this.getEffectiveSystemPrompt(messages);

    const geminiTools = tools.map((tool) => ({
      functionDeclarations: [
        {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      ],
    }));

    return {
      model,
      contents,
      systemInstruction,
      tools: geminiTools.length > 0 ? geminiTools : undefined,
      config: {
        maxOutputTokens: this._config.maxTokens || 4000,
      },
    };
  }

  private _parseResponse(response: any): ProviderResponse {
    const candidate = response.candidates?.[0];
    if (!candidate) {
      throw new Error('No candidate in Gemini response');
    }

    const parts = candidate.content?.parts || [];

    // Extract text content
    const textParts = parts.filter((part) => part.text);
    const content = textParts.map((part) => part.text).join('');

    // Extract tool calls
    const toolCalls = parts
      .filter((part) => part.functionCall)
      .map((part) => ({
        id: `gemini_${Date.now()}_${Math.random()}`, // Gemini doesn't provide IDs
        name: part.functionCall.name,
        arguments: part.functionCall.args || {},
      }));

    // Extract usage
    const usage = response.usageMetadata
      ? {
          promptTokens: response.usageMetadata.promptTokens || 0,
          completionTokens: response.usageMetadata.candidatesTokens || 0,
          totalTokens: response.usageMetadata.totalTokens || 0,
        }
      : undefined;

    return {
      content,
      toolCalls,
      stopReason: this.normalizeStopReason(candidate.finishReason),
      usage,
    };
  }

  private async _handleStreamingResponse(
    stream: any
  ): Promise<ProviderResponse> {
    let content = '';
    let toolCalls: ToolCall[] = [];
    let usage: any = undefined;

    // Handle streaming events
    stream.on('text', (text: string) => {
      content += text;
      this.emit('token', { token: text });
    });

    // Wait for final message
    const finalMessage = await stream.finalMessage();

    const response = this._parseResponse({
      candidates: [
        {
          content: finalMessage.content,
          finishReason: finalMessage.finishReason,
        },
      ],
      usageMetadata: finalMessage.usageMetadata,
    });

    this.emit('complete', { response });
    return response;
  }

  protected normalizeStopReason(
    stopReason: string | null | undefined
  ): string | undefined {
    if (!stopReason) return undefined;

    switch (stopReason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'max_tokens';
      case 'FINISH_REASON_UNSPECIFIED':
        return 'stop';
      default:
        return 'stop';
    }
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'gemini',
      displayName: 'Google Gemini',
      requiresApiKey: true,
      configurationHint: 'Set API key in provider settings',
    };
  }

  isConfigured(): boolean {
    const config = this._config as GeminiProviderConfig;
    return !!config.apiKey && config.apiKey.length > 0;
  }
}
```

**DRY Patterns:**

- Reuse retry logic from base class (`withRetry`)
- Reuse token estimation from base class
- Reuse event emission patterns from other providers
- Reuse error handling patterns

### Step 6: Provider Registration (YAGNI)

**File:** `packages/core/src/providers/index.ts`

```typescript
// Add to existing exports
export { GeminiProvider } from './gemini-provider';
```

**No complex registry changes until needed.**

### Step 7: Integration Testing

**File:** `packages/core/src/providers/gemini-integration.test.ts`

Test with real API (when API key available):

- Basic conversation flow
- Tool calling end-to-end
- Streaming functionality

## TDD Cycle for Each Feature

### Red-Green-Refactor Pattern:

1. **RED:** Write failing test for specific functionality
2. **GREEN:** Write minimal code to make test pass
3. **REFACTOR:** Clean up code while keeping tests green

### Example TDD Cycle - Basic Response:

```typescript
// 1. RED - Write failing test
it('should handle basic text response', async () => {
  const provider = new GeminiProvider({ apiKey: 'test-key' });
  const messages = [{ role: 'user', content: 'Hello' }];

  // Mock Gemini SDK response
  mockGenerateContent.mockResolvedValue({
    candidates: [
      {
        content: { parts: [{ text: 'Hi there!' }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokens: 5, totalTokens: 10, candidatesTokens: 5 },
  });

  const response = await provider.createResponse(
    messages,
    [],
    'gemini-2.0-flash'
  );

  expect(response.content).toBe('Hi there!');
  expect(response.usage?.promptTokens).toBe(5);
  expect(response.stopReason).toBe('stop');
});

// 2. GREEN - Minimal implementation to pass test
// 3. REFACTOR - Clean up after test passes
```

## DRY Implementation Strategy

### Reuse Existing Patterns:

1. **Configuration:** Same as OpenAI/Anthropic providers
2. **Error Handling:** Use base class retry mechanisms
3. **Tool Conversion:** Follow established schema patterns
4. **Event Emission:** Copy streaming event patterns
5. **Response Parsing:** Extract common parsing utilities

### Extract Common Code:

```typescript
// If we see duplication across providers, extract to base class
export abstract class StreamingProvider extends AIProvider {
  protected emitTokenEvent(token: string) {
    this.emit('token', { token });
  }

  protected emitUsageUpdate(usage: ProviderResponse['usage']) {
    this.emit('token_usage_update', { usage });
  }
}
```

## YAGNI Principles

### Don't Build Until Needed:

- ❌ No Vertex AI support (not requested)
- ❌ No vision/multimodal (not in current scope)
- ❌ No advanced streaming features (unless basic streaming insufficient)
- ❌ No complex configuration (just API key)
- ❌ No custom model management (catalog handles this)
- ❌ No environment variable support (web UI only)

### Build Only When Tests Require:

- ✅ Basic text generation (core requirement)
- ✅ Tool calling (required by base interface)
- ✅ Streaming (required by base interface)
- ✅ Error handling (required for production)

### Minimal File Structure:

```
packages/core/src/providers/
├── gemini-provider.ts           # ~250 lines initially
├── format-converters.ts         # Add convertToGeminiFormat (~80 lines)
├── catalog/data/gemini.json     # Update existing
└── __tests__/
    ├── gemini-provider.test.ts  # Comprehensive unit tests
    └── gemini-integration.test.ts # Real API tests (optional)
```

## Success Criteria

1. **All tests pass** (TDD requirement)
2. **Web UI shows Gemini provider** with API key input
3. **Basic conversation works** with text generation
4. **Tool calling works** end-to-end
5. **Streaming works** with token emission
6. **No code duplication** (DRY compliance)
7. **No unused features** (YAGNI compliance)

## Development Order

1. **Update gemini.json** with current models
2. **Write failing test** for provider instantiation → implement minimal
   constructor
3. **Write failing test** for basic response → implement `createResponse`
4. **Write failing test** for format conversion → implement
   `convertToGeminiFormat`
5. **Write failing test** for tool calling → extend format converter and
   response parser
6. **Write failing test** for streaming → implement `createStreamingResponse`
7. **Write failing test** for error cases → add error handling
8. **Integration test** with real API
9. **Add provider registration** for web UI discovery

Each step follows strict TDD: **Red → Green → Refactor**.

## Technical Considerations

### Format Conversion Challenges:

- Gemini uses `Content/Part` structure vs simple strings
- Tool calls become `functionCall` parts
- Tool results become `functionResponse` parts
- System messages handled via `systemInstruction` parameter

### Streaming Differences:

- Gemini streams via events (`text`, `finalMessage`)
- Different from OpenAI chunks and Anthropic events
- Need to adapt to common streaming interface

### Error Handling:

- Map Gemini-specific errors to normalized format
- Handle authentication, rate limiting, model errors
- Use existing retry mechanisms from base class

## Dependencies

- `@google/genai`: ^1.19.0 (official Google SDK)
- Existing Lace provider infrastructure
- Test framework (vitest)

## Risk Mitigation

1. **API Changes:** Use official SDK to minimize API compatibility issues
2. **Rate Limits:** Implement standard retry logic with backoff
3. **Model Updates:** Use catalog system for easy model management
4. **Testing:** Comprehensive unit tests reduce integration risk

## Future Extensions (Not in Scope)

- Vertex AI support
- Vision/multimodal capabilities
- Advanced streaming features
- Custom authentication methods
- Environment variable configuration

---

**Next Steps:**

1. Begin with Step 1 (update gemini.json)
2. Follow TDD cycle strictly
3. Review at each major milestone
4. Integration test before declaring complete
