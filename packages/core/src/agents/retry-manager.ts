// ABOUTME: Backend retry coordination for failed operations
// ABOUTME: Handles agent and tool retry logic with exponential backoff

import type { Agent } from '~/agents/agent';
import type { ToolExecutor } from '~/tools/executor';
import type { ToolCall, ToolResult, ToolContext } from '~/tools/types';
import type { ErrorType } from '~/threads/types';
import { logger } from '~/utils/logger';

export class RetryManager {
  private retryAttempts = new Map<string, number>();
  private readonly MAX_RETRIES = 3;
  private readonly BASE_DELAY = 1000; // 1 second

  async retryAgentOperation(
    agent: Agent,
    errorType: ErrorType
  ): Promise<{ success: boolean; error?: string }> {
    const key = `agent-${agent.threadId}-${errorType}`;
    const currentAttempts = this.retryAttempts.get(key) || 0;
    const newAttempts = currentAttempts + 1;

    if (newAttempts > this.MAX_RETRIES) {
      // Clear retry tracking to prevent map growth
      this.retryAttempts.delete(key);
      return { success: false, error: 'Maximum retry attempts exceeded' };
    }

    // Pre-increment to prevent race conditions
    this.retryAttempts.set(key, newAttempts);

    // Calculate exponential backoff delay using incremented attempts
    const delay = this.BASE_DELAY * Math.pow(2, newAttempts - 1);
    await new Promise((resolve) => setTimeout(resolve, delay));

    logger.debug('RetryManager: Attempting agent retry', {
      threadId: agent.threadId,
      errorType,
      attempt: newAttempts,
      delay,
    });

    try {
      switch (errorType) {
        case 'provider_failure':
          // Retry the last conversation turn by processing queued messages
          await agent.processQueuedMessages();
          break;

        case 'processing_error':
          // Restart conversation processing
          await agent.processQueuedMessages();
          break;

        case 'streaming_error':
          // Retry with non-streaming mode - for now just retry normally
          await agent.processQueuedMessages();
          break;

        case 'timeout':
          // Retry with same configuration - timeout handling is at provider level
          await agent.processQueuedMessages();
          break;

        case 'tool_execution':
          // Tool execution retries handled separately via retryToolOperation
          throw new Error('Tool execution retries should use retryToolOperation method');
      }

      // Reset retry count on success
      this.retryAttempts.delete(key);
      logger.info('RetryManager: Agent retry succeeded', {
        threadId: agent.threadId,
        errorType,
        totalAttempts: newAttempts,
      });
      return { success: true };
    } catch (error) {
      logger.warn('RetryManager: Agent retry failed', {
        threadId: agent.threadId,
        errorType,
        attempt: newAttempts,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Retry failed',
      };
    }
  }

  async retryToolOperation(
    toolExecutor: ToolExecutor,
    toolCall: ToolCall,
    context: ToolContext
  ): Promise<{ success: boolean; result?: ToolResult; error?: string }> {
    const key = `tool-${toolCall.id}`;
    const currentAttempts = this.retryAttempts.get(key) || 0;
    const newAttempts = currentAttempts + 1;

    if (newAttempts > this.MAX_RETRIES) {
      // Clear retry tracking to prevent map growth
      this.retryAttempts.delete(key);
      return { success: false, error: 'Maximum retry attempts exceeded' };
    }

    // Pre-increment to prevent race conditions
    this.retryAttempts.set(key, newAttempts);

    // Calculate exponential backoff delay with jitter
    const baseDelay = this.BASE_DELAY * Math.pow(2, newAttempts - 1);
    const jitter = Math.random() * 0.1 * baseDelay; // 10% jitter
    const delay = Math.floor(baseDelay + jitter);
    await new Promise((resolve) => setTimeout(resolve, delay));

    logger.debug('RetryManager: Attempting tool retry', {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      attempt: newAttempts,
      delay,
    });

    try {
      // Execute the tool again with the same parameters
      const result = await toolExecutor.executeTool(toolCall, context);

      if (result.status === 'failed') {
        // Inspect result for underlying error details from content
        const errorDetails =
          result.content.length > 0 && result.content[0].text
            ? result.content[0].text
            : 'Tool execution failed on retry';
        return { success: false, error: errorDetails };
      }

      this.retryAttempts.delete(key);
      logger.info('RetryManager: Tool retry succeeded', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        totalAttempts: newAttempts,
      });
      return { success: true, result };
    } catch (error) {
      logger.warn('RetryManager: Tool retry failed', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        attempt: newAttempts,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Tool retry failed',
      };
    }
  }

  clearRetryHistory(key?: string): void {
    if (key) {
      this.retryAttempts.delete(key);
    } else {
      this.retryAttempts.clear();
    }
  }

  getRetryCount(key: string): number {
    return this.retryAttempts.get(key) || 0;
  }

  getRetryHistory(): Record<string, number> {
    // Return immutable copy to prevent external mutation
    return Object.fromEntries(this.retryAttempts.entries());
  }
}
