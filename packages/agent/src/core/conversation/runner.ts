// ABOUTME: ConversationRunner - the agentic loop for executing prompts
// This is the core conversation engine extracted from rpc/handlers/prompt.ts
// It handles message building, provider calls, tool execution, and event persistence.

import { randomUUID } from 'node:crypto';
import type { RunnerConfig, RunParams, RunResult } from './types';
import { readSessionState, writeSessionState, type SessionState } from '@lace/agent/storage/session-store';
import { appendDurableEvent } from '@lace/agent/storage/event-log';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';

/**
 * ConversationRunner executes prompts through the agentic loop.
 *
 * It handles:
 * - Building provider messages from durable events
 * - Making streaming provider calls
 * - Executing tool calls with approval workflow
 * - Writing durable events for persistence
 * - Emitting session updates for UI streaming
 *
 * This class is the core of the agent's conversation engine, extracted
 * from the RPC handler to enable direct library usage without JSON-RPC.
 */
export class ConversationRunner {
  private readonly config: RunnerConfig;

  constructor(config: RunnerConfig) {
    this.config = config;
  }

  /**
   * The session directory where events are persisted.
   */
  get sessionDir(): string {
    return this.config.sessionDir;
  }

  /**
   * Run a prompt through the agentic loop.
   *
   * This will:
   * 1. Write the prompt as a durable event
   * 2. Build provider messages from event history
   * 3. Make provider call(s) with tool execution loop
   * 4. Write results as durable events
   * 5. Emit session updates throughout
   *
   * Currently implements single-turn conversation only (no tool execution).
   */
  async run(params: RunParams): Promise<RunResult> {
    const { content, provider } = params;
    const { sessionDir, modelId } = this.config;

    // 1. Create turn ID
    const turnId = `turn_${randomUUID()}`;

    // 2. Read session state
    let sessionState: SessionState = readSessionState(sessionDir);

    // Helper to write a durable event and advance state
    let durableTurnSeq = 0;
    const writeAndAdvance = (event: { type: string; data: Record<string, unknown> }) => {
      const { nextState } = appendDurableEvent(sessionDir, sessionState, {
        type: event.type,
        data: event.data,
        turnId,
        turnSeq: durableTurnSeq++,
      });
      sessionState = nextState;
      writeSessionState(sessionDir, sessionState);
    };

    // 3. Write prompt event
    writeAndAdvance({ type: 'prompt', data: { content } });
    writeAndAdvance({ type: 'turn_start', data: {} });

    // Emit turn_start update
    this.config.onUpdate({ type: 'turn_start' });

    // 4. Build provider messages from durable events
    const providerMessages = buildProviderMessagesFromDurableEvents(sessionDir);

    // 5. Call provider
    const response = await provider.createStreamingResponse(
      providerMessages,
      [], // No tools for single-turn (skipping tool execution for now)
      modelId ?? 'unknown-model',
      undefined // No abort signal for now
    );

    // Extract assistant text content
    const assistantText = typeof response.content === 'string' ? response.content : '';

    // Emit text delta update if there's content
    if (assistantText.length > 0) {
      this.config.onUpdate({ type: 'text_delta', text: assistantText });
    }

    // 6. Write response event
    writeAndAdvance({ type: 'message', data: { content: assistantText } });

    // Determine stop reason
    const stopReason: RunResult['stopReason'] =
      response.stopReason === 'max_tokens' ? 'max_tokens' : 'end_turn';

    // Write turn_end event
    writeAndAdvance({ type: 'turn_end', data: { stopReason } });

    // Track token usage
    const inputTokens = response.usage?.promptTokens ?? 0;
    const outputTokens = response.usage?.completionTokens ?? 0;

    // 7. Build and return result
    const result: RunResult = {
      turnId,
      stopReason,
      content: assistantText.length > 0
        ? [{ type: 'text', text: assistantText }]
        : [],
      usage: { inputTokens, outputTokens },
    };

    // Emit turn_end update
    this.config.onUpdate({
      type: 'turn_end',
      stopReason: result.stopReason,
      content: result.content,
      usage: result.usage,
    });

    return result;
  }

  /**
   * Cancel any in-progress operation.
   *
   * @throws Error - Not yet implemented (skeleton only)
   */
  cancel(): void {
    // TODO: Implement abort controller logic
    throw new Error('Not implemented: cancel() will be implemented in later phases');
  }
}
