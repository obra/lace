
# BaseProvider Refactoring Plan

**Objective:** Refactor the provider implementations to use a `BaseProvider` class, reducing code duplication and improving maintainability.

## 1. Analysis of Redundancy

Based on the architectural audit, the following areas have been identified as having significant code duplication across the existing provider implementations (`AnthropicProvider`, `LMStudioProvider`, `OllamaProvider`, and `OpenAIProvider`):

- **Configuration Handling:** Each provider has similar logic for handling `ProviderConfig` options like `model`, `maxTokens`, and `systemPrompt`.
- **Streaming Logic:** The `createStreamingResponse` methods in each provider share a lot of boilerplate for handling streaming events, tokenizing, and managing the response lifecycle.
- **Error Handling:** While the specific errors differ, the general structure for catching and reporting errors is similar.
- **Message Formatting:** There is some duplication in how messages are prepared before being sent to the provider's API, although this is also a point of provider-specific logic.

## 2. `BaseProvider` Class Design

I will create a new `BaseProvider` class in `src/providers/base-provider.ts`. This class will serve as the foundation for all other providers and will contain the following common logic:

- **Constructor:** The constructor will accept a `ProviderConfig` object and store it.
- **`systemPrompt` Management:** It will include the `setSystemPrompt` and `get systemPrompt` methods.
- **Streaming Fallback:** The `createStreamingResponse` method will, by default, fall back to the non-streaming `createResponse` method, which individual providers can override if they support streaming.
- **Abstract Methods:** The `providerName` and `defaultModel` properties will be abstract, forcing each concrete provider to implement them.
- **Common Utilities:** I'll add protected utility methods for common tasks, such as token estimation.

```typescript
// src/providers/base-provider.ts
import { AIProvider, ProviderMessage, ProviderResponse, ProviderConfig } from './types.js';
import { Tool } from '../tools/types.js';

export abstract class BaseProvider extends AIProvider {
  constructor(config: ProviderConfig) {
    super(config);
  }

  // Common implementation for system prompt
  setSystemPrompt(systemPrompt: string): void {
    this._systemPrompt = systemPrompt;
  }

  get systemPrompt(): string {
    return this._systemPrompt;
  }

  // Common fallback for streaming
  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return this.createResponse(messages, tools, signal);
  }

  // Abstract properties to be implemented by subclasses
  abstract get providerName(): string;
  abstract get defaultModel(): string;

  // Abstract method for the primary response creation
  abstract createResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    signal?: AbortSignal
  ): Promise<ProviderResponse>;
}
```

## 3. Refactoring Existing Providers

I will refactor each of the existing provider classes to extend the new `BaseProvider` class. This will involve the following steps for each provider:

1.  **Update Class Definition:** Change the class definition to `export class [ProviderName] extends BaseProvider`.
2.  **Remove Duplicated Logic:** Remove the `setSystemPrompt` and `get systemPrompt` methods, as well as any other logic that is now handled by the `BaseProvider`.
3.  **Update Constructor:** The constructor will call `super(config)` and will only contain logic specific to that provider.
4.  **Implement Abstract Methods:** Ensure that the `providerName` and `defaultModel` properties are correctly implemented.
5.  **Keep Provider-Specific Logic:** The `createResponse` and (if applicable) `createStreamingResponse` methods will be updated to only contain the logic that is specific to that provider's API.

## 4. Implementation and Testing Strategy

I will follow a test-driven development (TDD) approach to ensure that the refactoring does not introduce any regressions.

1.  **Create `base-provider.test.ts`:** I'll start by creating a new test file for the `BaseProvider` class to test its core functionality.
2.  **Refactor One Provider at a Time:** I will refactor one provider at a time, starting with `AnthropicProvider`.
3.  **Run Existing Tests:** After refactoring each provider, I will run its existing test suite to ensure that all tests still pass.
4.  **Update Tests as Needed:** If any tests need to be updated to reflect the new class structure, I will do so.
5.  **Integration Tests:** Once all providers have been refactored, I will run the full integration test suite to ensure that the entire application works as expected.

## 5. File-by-File Plan

1.  **Create `src/providers/base-provider.ts`:** Implement the `BaseProvider` class as designed above.
2.  **Create `src/providers/__tests__/base-provider.test.ts`:** Write unit tests for the `BaseProvider` class.
3.  **Modify `src/providers/anthropic-provider.ts`:**
    -   Extend `BaseProvider`.
    -   Remove duplicated code.
    -   Update constructor.
4.  **Modify `src/providers/__tests__/anthropic-provider.test.ts`:**
    -   Update tests to reflect the new class structure.
    -   Ensure all tests pass.
5.  **Modify `src/providers/openai-provider.ts`:**
    -   Extend `BaseProvider`.
    -   Remove duplicated code.
    -   Update constructor.
6.  **Modify `src/providers/__tests__/openai-provider.test.ts`:**
    -   Update tests to reflect the new class structure.
    -   Ensure all tests pass.
7.  **Modify `src/providers/lmstudio-provider.ts`:**
    -   Extend `BaseProvider`.
    -   Remove duplicated code.
    -   Update constructor.
8.  **Modify `src/providers/__tests__/lmstudio-provider.test.ts`:**
    -   Update tests to reflect the new class structure.
    -   Ensure all tests pass.
9.  **Modify `src/providers/ollama-provider.ts`:**
    -   Extend `BaseProvider`.
    -   Remove duplicated code.
    -   Update constructor.
10. **Modify `src/providers/__tests__/ollama-provider.test.ts`:**
    -   Update tests to reflect the new class structure.
    -   Ensure all tests pass.
11. **Run all tests:** Run the entire test suite, including integration tests, to ensure that the refactoring is complete and successful.

## 6. Conclusion

This refactoring will significantly improve the maintainability and extensibility of the provider system. By centralizing the common logic in a `BaseProvider` class, we will reduce code duplication, make it easier to add new providers in the future, and ensure that all providers adhere to a consistent set of core behaviors.
