// ABOUTME: Type definitions for agent message queueing system
// ABOUTME: Defines QueuedMessage and MessageQueueStats interfaces

export interface QueuedMessage {
  id: string;
  type: 'user' | 'system';
  content: string;
  timestamp: Date;
  metadata?: {
    fromAgent?: string;
    priority?: 'normal' | 'high';
    source?: 'user_input' | 'agent_message';
  };
}

export interface MessageQueueStats {
  queueLength: number;
  oldestMessageAge?: number;
  highPriorityCount: number;
}
