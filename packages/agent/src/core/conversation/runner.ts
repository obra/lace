// ABOUTME: ConversationRunner - the agentic loop for executing prompts
// This is the core conversation engine extracted from rpc/handlers/prompt.ts
// It handles message building, provider calls, tool execution, and event persistence.

import type { RunnerConfig, RunParams, RunResult } from './types';

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
   * @throws Error - Not yet implemented (skeleton only)
   */
  async run(_params: RunParams): Promise<RunResult> {
    // TODO: Implement the agentic loop (Phase 3 continued)
    throw new Error('Not implemented: run() will be implemented in later phases');
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
