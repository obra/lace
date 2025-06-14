// ABOUTME: Thread management for storing and retrieving conversation events
// ABOUTME: Pure data layer - no business logic about conversation state

import { Thread, ThreadEvent, EventType, ToolCallData, ToolResultData } from './types.js';

export class ThreadManager {
  private _threads = new Map<string, Thread>();

  createThread(threadId: string): Thread {
    const thread: Thread = {
      id: threadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
    };
    this._threads.set(threadId, thread);
    return thread;
  }

  getThread(threadId: string): Thread | undefined {
    return this._threads.get(threadId);
  }

  addEvent(
    threadId: string,
    type: EventType,
    data: string | ToolCallData | ToolResultData
  ): ThreadEvent {
    const thread = this._threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    const event: ThreadEvent = {
      id: generateEventId(),
      threadId,
      type,
      timestamp: new Date(),
      data,
    };

    thread.events.push(event);
    thread.updatedAt = new Date();

    return event;
  }

  getEvents(threadId: string): ThreadEvent[] {
    const thread = this._threads.get(threadId);
    return thread?.events || [];
  }
}

function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
