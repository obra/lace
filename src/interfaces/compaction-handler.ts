// ABOUTME: Handler for displaying compaction status in interfaces
// ABOUTME: Provides visual feedback when conversation compaction occurs

import type { Agent } from '~/agents/agent';
import type { ThreadEvent } from '~/threads/types';

export interface CompactionDisplay {
  onCompactionStart(): void;
  onCompactionComplete(event?: ThreadEvent): void;
  onCompactionError(error: Error): void;
}

/**
 * Attaches compaction event handlers to an agent
 * Used by interfaces to provide compaction feedback to users
 */
export class CompactionHandler {
  private agent: Agent;
  private display: CompactionDisplay;
  private isCompacting = false;

  constructor(agent: Agent, display: CompactionDisplay) {
    this.agent = agent;
    this.display = display;
    this.attachEventHandlers();
  }

  private attachEventHandlers(): void {
    // Listen for compaction start (indicated by thinking events with compaction context)
    this.agent.on('agent_thinking_start', () => {
      // Check if this is a compaction by looking at recent events
      const events = this.agent['_threadManager'].getEvents(this.agent['_threadId']);
      const lastUserMessage = events.filter((e) => e.type === 'USER_MESSAGE').pop();

      if (
        lastUserMessage &&
        typeof lastUserMessage.data === 'string' &&
        lastUserMessage.data.startsWith('/compact')
      ) {
        this.isCompacting = true;
        this.display.onCompactionStart();
      }
    });

    // Listen for compaction complete
    this.agent.on('agent_thinking_complete', () => {
      if (this.isCompacting) {
        // Check for compaction event in thread
        const events = this.agent['_threadManager'].getEvents(this.agent['_threadId']);
        const compactionEvent = events.filter((e) => e.type === 'COMPACTION').pop();

        this.display.onCompactionComplete(compactionEvent);
        this.isCompacting = false;
      }
    });

    // Listen for errors during compaction
    this.agent.on('error', ({ error }: { error: Error; context?: unknown }) => {
      if (this.isCompacting) {
        this.display.onCompactionError(error);
        this.isCompacting = false;
      }
    });
  }

  /**
   * Clean up event listeners
   */
  cleanup(): void {
    // Only remove listeners if the agent has the removeAllListeners method
    if (typeof this.agent.removeAllListeners === 'function') {
      this.agent.removeAllListeners('agent_thinking_start');
      this.agent.removeAllListeners('agent_thinking_complete');
      this.agent.removeAllListeners('error');
    }
  }
}

/**
 * Console-based compaction display for CLI interfaces
 */
export class ConsoleCompactionDisplay implements CompactionDisplay {
  onCompactionStart(): void {
    console.log('\n🔄 Compacting conversation to reduce size...');
  }

  onCompactionComplete(event?: ThreadEvent): void {
    if (event && event.type === 'COMPACTION') {
      const data = event.data;
      const originalCount = data.originalEventCount;
      const compactedCount = data.compactedEvents.length;
      const reduction = Math.round((1 - compactedCount / originalCount) * 100);

      console.log(
        `✅ Compaction complete! Reduced from ${originalCount} to ${compactedCount} events (${reduction}% reduction)\n`
      );
    } else {
      console.log('✅ Compaction complete!\n');
    }
  }

  onCompactionError(error: Error): void {
    console.error(`❌ Compaction failed: ${error.message}\n`);
  }
}
