import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
} from '../providers/base-provider';
import type { WireTool } from '@lace/agent/providers/base-provider';
import type { ToolCall, ToolResult } from '@lace/agent/tools/types';
import { getTextContent } from '@lace/agent/providers/utils/content-helpers';

type TestProviderState = {
  phase: 'needs_tool' | 'awaiting_retry' | 'final';
  nextToolCallId: number;
  sawErrorInToolResult: boolean; // Track if we saw an error to trigger retry
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

/**
 * Tool error retry configuration for testing error recovery.
 * - LACE_TEST_PROVIDER_RETRY_ON_ERROR: When set to '1', provider will retry file_read
 *   with a fallback file after seeing an error in the tool result.
 */
function isRetryOnErrorEnabled(): boolean {
  return process.env.LACE_TEST_PROVIDER_RETRY_ON_ERROR === '1';
}

/**
 * Intent-text-after-tool-result injection (kata #31 round 2).
 *
 * When LACE_TEST_PROVIDER_INTENT_AFTER_TOOL_RESULT is set to a non-empty string,
 * any turn that comes after a tool result will emit that string as text-only
 * content with no tool calls and stopReason='stop'. This faithfully reproduces
 * the production "I'll add a brief note" pattern, where the model declares
 * future-tense intent but never calls the tool that would do the work.
 *
 * Default unset preserves the existing "Result:\n<tool output>" fixture
 * behaviour the rest of the suite relies on.
 */
function getIntentTextAfterToolResult(): string | null {
  const value = process.env.LACE_TEST_PROVIDER_INTENT_AFTER_TOOL_RESULT;
  return value && value.length > 0 ? value : null;
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
  private state: TestProviderState = {
    phase: 'needs_tool',
    nextToolCallId: 1,
    sawErrorInToolResult: false,
  };

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

  protected async _createResponseImpl(
    messages: ProviderMessage[],
    _tools: WireTool[],
    _model: string,
    _signal?: AbortSignal
  ): Promise<ProviderResponse> {
    const response = await this._createStreamingResponseImpl(messages, _tools, _model, _signal);
    return response;
  }

  protected async _createStreamingResponseImpl(
    messages: ProviderMessage[],
    _tools: WireTool[],
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

        const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
        const lastUserText = lastUserMessage ? getTextContent(lastUserMessage.content) : undefined;

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
          let content: string;
          switch (requested.name) {
            case 'file_read':
              content = `Reading ${(requested.args as Record<string, unknown>).path as string}...`;
              break;
            case 'delegate':
              content = `Delegating ${(requested.args as Record<string, unknown>).prompt as string}...`;
              break;
            case 'bash':
              content = `Running ${(requested.args as Record<string, unknown>).command as string}...`;
              break;
            case 'todo_read':
              content = 'Reading todos...';
              break;
            case 'todo_write': {
              const args = requested.args as Record<string, unknown>;
              if (args.id) {
                content = `Updating todo: ${args.id as string}...`;
              } else {
                content = `Adding todo: ${args.title as string}...`;
              }
              break;
            }
            default:
              content = `Writing ${(requested.args as Record<string, unknown>).path as string}...`;
          }

          // When LACE_TEST_PROVIDER_RESPECT_WIRE_TOOLS=1, faithfully model real
          // provider behavior: a model can only call a tool that the runtime
          // actually advertised in the wire payload. If the persona/toolScope
          // filter removed the requested tool, the model declares intent in
          // text and returns no tool call. Defaults off to preserve the long
          // standing test fixture behavior where TestAgentProvider blindly
          // emits any tool the prompt pattern matches.
          if (process.env.LACE_TEST_PROVIDER_RESPECT_WIRE_TOOLS === '1') {
            const toolIsAvailable = _tools.some((t) => t.name === requested.name);
            if (!toolIsAvailable) {
              this.emit('token', { token: content });
              this.emit('complete', { response: { content, toolCalls: [], stopReason: 'stop' } });
              this.state.phase = 'final';
              return { content, toolCalls: [], stopReason: 'stop', usage: mockUsage };
            }
          }

          const toolCallId = `test_tool_${this.state.nextToolCallId++}`;
          const toolCalls: ToolCall[] = [
            { id: toolCallId, name: requested.name, arguments: requested.args },
          ];
          this.emit('token', { token: content });
          this.emit('complete', { response: { content, toolCalls, stopReason: 'tool_use' } });
          // If retry-on-error is enabled, transition to awaiting_retry so we can retry on failure
          this.state.phase = isRetryOnErrorEnabled() ? 'awaiting_retry' : 'final';
          return { content, toolCalls, stopReason: 'tool_use', usage: mockUsage };
        }

        // Check for tool result (both success and failure)
        const toolResultInfo = this.extractLatestToolResultInfo(messages);

        // If we're in awaiting_retry phase and the last tool result was an error, retry with fallback.txt
        if (this.state.phase === 'awaiting_retry' && toolResultInfo?.isError) {
          const toolCallId = `test_tool_${this.state.nextToolCallId++}`;
          const toolCalls: ToolCall[] = [
            { id: toolCallId, name: 'file_read', arguments: { path: 'fallback.txt' } },
          ];
          const content = `Previous file not found. Retrying with fallback.txt...`;
          this.emit('token', { token: content });
          this.emit('complete', { response: { content, toolCalls, stopReason: 'tool_use' } });
          this.state.phase = 'final'; // Don't retry again
          return { content, toolCalls, stopReason: 'tool_use', usage: mockUsage };
        }

        const toolResultText = toolResultInfo?.text ?? null;

        // Kata #31 round 2: when an intent-text injection is configured AND
        // the current turn follows a tool result, return that intent text
        // instead of the usual "Result:\n…" summary. This reproduces the
        // production therapist trace where the model declared "I'll add a
        // brief note" without calling the tool that would do the work.
        const intentText = getIntentTextAfterToolResult();
        if (intentText && toolResultInfo) {
          this.emit('token', { token: intentText });
          this.emit('complete', {
            response: { content: intentText, toolCalls: [], stopReason: 'stop' },
          });
          return { content: intentText, toolCalls: [], stopReason: 'stop', usage: mockUsage };
        }

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

  private extractRequestedTool(text: string): null | {
    name: 'delegate' | 'file_read' | 'file_write' | 'bash' | 'todo_read' | 'todo_write';
    args: Record<string, unknown>;
  } {
    // Handle "add todo: <title>" or "todo add: <title>" pattern
    const todoAddMatch = text.match(/(?:add\s+todo|todo\s+add)[:\s]\s*(.+)\s*$/i);
    const todoTitle = todoAddMatch?.[1]?.trim();
    if (todoTitle) return { name: 'todo_write', args: { title: todoTitle } };

    // Handle "read todos" or "list todos" or "show todos" pattern
    const todoReadMatch = text.match(/(?:read|list|show)\s+todos?\s*$/i);
    if (todoReadMatch) return { name: 'todo_read', args: {} };

    // Handle "mark done: <id>" or "complete todo: <id>" pattern
    const todoUpdateMatch = text.match(/(?:mark\s+done|complete\s+todo)[:\s]\s*(t_\w+)\s*$/i);
    const todoId = todoUpdateMatch?.[1]?.trim();
    if (todoId) return { name: 'todo_write', args: { id: todoId, status: 'done' } };

    // Handle "remove todo: <id>" or "delete todo: <id>" pattern
    const todoRemoveMatch = text.match(/(?:remove|delete)\s+todo[:\s]\s*(t_\w+)\s*$/i);
    const removeId = todoRemoveMatch?.[1]?.trim();
    if (removeId) return { name: 'todo_write', args: { id: removeId, status: 'removed' } };

    const delegateMatch = text.match(/delegate\s+(.+)\s*$/i);
    const delegatePrompt = delegateMatch?.[1]?.trim();
    if (delegatePrompt) return { name: 'delegate', args: { prompt: delegatePrompt } };

    // Handle "subagent persona=name: prompt" pattern (persona thread to delegate)
    const subagentPersonaMatch = text.match(/subagent\s+persona=([^\s:]+)\s*:\s*(.+)\s*$/i);
    if (subagentPersonaMatch) {
      const persona = subagentPersonaMatch[1]?.trim() || undefined;
      const prompt = subagentPersonaMatch[2]?.trim();
      if (prompt && persona) {
        return {
          name: 'delegate',
          args: { prompt, persona },
        };
      }
    }

    // Handle "subagent config=connId,modelId: prompt" or "subagent: prompt" pattern
    const subagentMatch = text.match(
      /subagent(?:\s+config=([^,\s]+)?,([^\s:]+)?)?\s*:\s*(.+)\s*$/i
    );
    if (subagentMatch) {
      const connectionId = subagentMatch[1]?.trim() || undefined;
      const modelId = subagentMatch[2]?.trim() || undefined;
      const prompt = subagentMatch[3]?.trim();
      if (prompt) {
        return {
          name: 'delegate',
          args: { prompt, connectionId, modelId },
        };
      }
    }

    // Handle "job: <command>" pattern for background shell jobs
    const jobMatch = text.match(/job[:\s]\s*(.+)\s*$/i);
    const jobCommand = jobMatch?.[1]?.trim();
    if (jobCommand) return { name: 'bash', args: { command: jobCommand, background: true } };

    // Handle "run: <command>" or "run <command>" pattern for bash
    const runMatch = text.match(/run[:\s]\s*(.+)\s*$/i);
    const runCommand = runMatch?.[1]?.trim();
    if (runCommand) return { name: 'bash', args: { command: runCommand } };

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

  private extractLatestToolResultInfo(
    messages: ProviderMessage[]
  ): { text: string; isError: boolean } | null {
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
      if (content.length > 0) {
        // Check if the tool result indicates an error (status is not 'completed')
        const isError = last.status !== 'completed';
        return { text: content, isError };
      }
      return null;
    }
    return null;
  }
}
