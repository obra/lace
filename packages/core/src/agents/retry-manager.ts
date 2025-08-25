// ABOUTME: Backend retry coordination for failed operations
// ABOUTME: Handles agent and tool retry logic with exponential backoff

import type { Agent } from './agent';
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

    if (currentAttempts >= this.MAX_RETRIES) {
      return { success: false, error: 'Maximum retry attempts exceeded' };
    }

    // Calculate exponential backoff delay
    const delay = this.BASE_DELAY * Math.pow(2, currentAttempts);
    await new Promise(resolve => setTimeout(resolve, delay));

    this.retryAttempts.set(key, currentAttempts + 1);

    logger.debug('RetryManager: Attempting agent retry', {
      threadId: agent.threadId,
      errorType,
      attempt: currentAttempts + 1,
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
        totalAttempts: currentAttempts + 1,
      });
      return { success: true };
    } catch (error) {
      logger.warn('RetryManager: Agent retry failed', {
        threadId: agent.threadId,
        errorType,
        attempt: currentAttempts + 1,
        error: error instanceof Error ? error.message : String(error),
      });
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Retry failed' 
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

    if (currentAttempts >= this.MAX_RETRIES) {
      return { success: false, error: 'Maximum retry attempts exceeded' };
    }

    const delay = this.BASE_DELAY * Math.pow(2, currentAttempts);
    await new Promise(resolve => setTimeout(resolve, delay));

    this.retryAttempts.set(key, currentAttempts + 1);

    logger.debug('RetryManager: Attempting tool retry', {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      attempt: currentAttempts + 1,
      delay,
    });

    try {
      // Execute the tool again with the same parameters
      const result = await toolExecutor.executeTool(toolCall, context);
      
      if (result.status === 'failed') {
        return { success: false, error: 'Tool execution failed on retry' };
      }

      this.retryAttempts.delete(key);
      logger.info('RetryManager: Tool retry succeeded', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        totalAttempts: currentAttempts + 1,
      });
      return { success: true, result };
    } catch (error) {
      logger.warn('RetryManager: Tool retry failed', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        attempt: currentAttempts + 1,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Tool retry failed'
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
    return Object.fromEntries(this.retryAttempts);
  }
}