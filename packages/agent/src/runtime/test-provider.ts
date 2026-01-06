import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
} from '../providers/base-provider';
import type { Tool } from '@lace/agent/tools/tool';
import type { ToolCall, ToolResult } from '@lace/agent/tools/types';

type TestProviderState = {
  phase: 'needs_tool' | 'final';
  nextToolCallId: number;
};

/**
 * Error injection configuration read from environment variables.
 * - LACE_TEST_PROVIDER_FAIL_COUNT: Number of calls to fail before succeeding
 * - LACE_TEST_PROVIDER_ERROR_STATUS: HTTP status code to simulate (429, 500, 400, etc.)
 */
function getErrorInjectionConfig(): { failCount: number; errorStatus: number } | null {
  const failCountStr = process.env.LACE_TEST_PROVIDER_FAIL_COUNT;
  const errorStatusStr = process.env.LACE_TEST_PROVIDER_ERROR_STATUS;

  if (!failCountStr) return null;

  const failCount = parseInt(failCountStr, 10);
  const errorStatus = errorStatusStr ? parseInt(errorStatusStr, 10) : 500;

  if (isNaN(failCount) || failCount < 0) return null;
  if (isNaN(errorStatus)) return null;

  return { failCount, errorStatus };
}

/**
 * Retry configuration read from environment variables for faster test execution.
 * - LACE_TEST_PROVIDER_RETRY_DELAY_MS: Initial retry delay in milliseconds (default: 1000)
 * - LACE_TEST_PROVIDER_MAX_DELAY_MS: Maximum retry delay in milliseconds (default: 30000)
 */
function getRetryConfig(): { initialDelayMs: number; maxDelayMs: number } | null {
  const initialDelayStr = process.env.LACE_TEST_PROVIDER_RETRY_DELAY_MS;
  const maxDelayStr = process.env.LACE_TEST_PROVIDER_MAX_DELAY_MS;

  if (!initialDelayStr && !maxDelayStr) return null;

  const initialDelayMs = initialDelayStr ? parseInt(initialDelayStr, 10) : 1000;
  const maxDelayMs = maxDelayStr ? parseInt(maxDelayStr, 10) : 30000;

  if (isNaN(initialDelayMs) || isNaN(maxDelayMs)) return null;

  return { initialDelayMs, maxDelayMs };
}

/**
 * Streaming delay configuration for abort testing.
 * - LACE_TEST_PROVIDER_STREAM_DELAY_MS: Delay before emitting tokens (default: 0)
 */
function getStreamingDelayMs(): number {
  const delayStr = process.env.LACE_TEST_PROVIDER_STREAM_DELAY_MS;
  if (!delayStr) return 0;
  const delay = parseInt(delayStr, 10);
  return isNaN(delay) || delay < 0 ? 0 : delay;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(new Error('aborted'));
      },
      { once: true }
    );
  });
}

// Track call count across provider instances within same process
// This is necessary because the agent may create new provider instances per turn
let globalCallCount = 0;

export function resetTestProviderCallCount(): void {
  globalCallCount = 0;
}

export function getTestProviderCallCount(): number {
  return globalCallCount;
}

export class TestAgentProvider extends AIProvider {
  private state: TestProviderState = { phase: 'needs_tool', nextToolCallId: 1 };

  /**
   * Get mock pricing for the test provider.
   * Use pricing that makes test budget scenarios work:
   * - 100 input tokens + 50 output tokens = 150 tokens (from mockUsage)
   * - At $10/1M input and $20/1M output: cost = 0.001 + 0.001 = $0.002 per turn
   */
  static getPricing(): { costPer1mIn: number; costPer1mOut: number } {
    return { costPer1mIn: 10.0, costPer1mOut: 20.0 };
  }

  constructor() {
    super();
    // Apply test retry configuration if set via environment variables
    const retryConfig = getRetryConfig();
    if (retryConfig) {
      this.RETRY_CONFIG = retryConfig;
    }
  }

  get providerName(): string {
    return 'test';
  }

  getProviderInfo() {
    return {
      name: 'test',
      displayName: 'Test Provider',
      requiresApiKey: false,
      configurationHint: 'Internal test provider for lace-agent E2E tests.',
    };
  }

  isConfigured(): boolean {
    return true;
  }

  get supportsStreaming(): boolean {
    return true;
  }

  async createResponse(
    messages: ProviderMessage[],
    _tools: Tool[],
    _model: string,
    _signal?: AbortSignal
  ): Promise<ProviderResponse> {
    const response = await this.createStreamingResponse(messages, _tools, _model, _signal);
    return response;
  }

  async createStreamingResponse(
    messages: ProviderMessage[],
    _tools: Tool[],
    _model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    if (signal?.aborted) {
      return { content: '', toolCalls: [], stopReason: 'error' };
    }

    // Wrap in withRetry to test retry behavior, matching how real providers work
    return this.withRetry(
      async () => {
        // Check for error injection before processing
        const errorConfig = getErrorInjectionConfig();
        if (errorConfig) {
          globalCallCount++;
          if (globalCallCount <= errorConfig.failCount) {
            const error = new Error(
              `Test provider simulated error (status ${errorConfig.errorStatus})`
            ) as Error & { status: number; code?: string };
            error.status = errorConfig.errorStatus;

            // Add code for rate limit errors to help retry logic identify them
            if (errorConfig.errorStatus === 429) {
              error.code = 'rate_limit_exceeded';
            }

            throw error;
          }
        }

        // Apply streaming delay if configured (for abort testing)
        const streamingDelayMs = getStreamingDelayMs();
        if (streamingDelayMs > 0) {
          try {
            await sleep(streamingDelayMs, signal);
          } catch {
            // Aborted during delay
            return { content: '', toolCalls: [], stopReason: 'error' };
          }
        }

        const lastUserText = [...messages]
          .reverse()
          .find((m) => m.role === 'user' && typeof m.content === 'string')?.content;

        // Generate mock token usage based on message length
        // Use fixed values for predictable cost calculations in tests
        const mockUsage = {
          promptTokens: 100, // Fixed input tokens for predictability
          completionTokens: 50, // Fixed output tokens for predictability
          totalTokens: 150,
        };

        if (lastUserText?.includes('Conversation Compaction Required')) {
          const content = 'Summary of conversation (test provider).';
          this.emit('token', { token: content });
          this.emit('complete', { response: { content, toolCalls: [], stopReason: 'stop' } });
          return { content, toolCalls: [], stopReason: 'stop', usage: mockUsage };
        }

        const requested = this.extractRequestedTool(lastUserText ?? '');

        if (this.state.phase === 'needs_tool' && requested) {
          const toolCallId = `test_tool_${this.state.nextToolCallId++}`;
          const toolCalls: ToolCall[] = [
            { id: toolCallId, name: requested.name, arguments: requested.args },
          ];
          const content =
            requested.name === 'file_read'
              ? `Reading ${(requested.args as any).path}...`
              : requested.name === 'delegate'
                ? `Delegating ${(requested.args as any).prompt}...`
                : `Writing ${(requested.args as any).path}...`;
          this.emit('token', { token: content });
          this.emit('complete', { response: { content, toolCalls, stopReason: 'tool_use' } });
          this.state.phase = 'final';
          return { content, toolCalls, stopReason: 'tool_use', usage: mockUsage };
        }

        const toolResultText = this.extractLatestToolResultText(messages);
        const content = toolResultText ? `Result:\n${toolResultText}` : 'No tool result found.';
        this.emit('token', { token: content });
        this.emit('complete', { response: { content, toolCalls: [], stopReason: 'stop' } });
        return { content, toolCalls: [], stopReason: 'stop', usage: mockUsage };
      },
      { signal }
    );
  }

  private extractRequestedPath(text: string): string | null {
    const match = text.match(/read\s+file\s+(.+)\s*$/i);
    const raw = match?.[1]?.trim();
    return raw && raw.length > 0 ? raw : null;
  }

  private extractRequestedTool(
    text: string
  ): null | { name: 'delegate' | 'file_read' | 'file_write'; args: Record<string, unknown> } {
    const delegateMatch = text.match(/delegate\s+(.+)\s*$/i);
    const delegatePrompt = delegateMatch?.[1]?.trim();
    if (delegatePrompt) return { name: 'delegate', args: { prompt: delegatePrompt } };

    const readPath = this.extractRequestedPath(text);
    if (readPath) return { name: 'file_read', args: { path: readPath } };

    const writeMatch = text.match(/write\s+file\s+(.+)\s*$/i);
    const writePath = writeMatch?.[1]?.trim();
    if (writePath && writePath.length > 0) {
      return {
        name: 'file_write',
        args: { path: writePath, content: 'written by test provider\n' },
      };
    }

    return null;
  }

  private extractLatestToolResultText(messages: ProviderMessage[]): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'user') continue;
      const results = msg.toolResults;
      if (!results || results.length === 0) continue;
      const last = results[results.length - 1] as ToolResult;
      const content = (last.content ?? [])
        .map((c) => (c.type === 'text' ? (c.text ?? '') : ''))
        .filter((t) => t.length > 0)
        .join('\n');
      return content.length > 0 ? content : null;
    }
    return null;
  }
}
