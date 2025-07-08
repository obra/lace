// ABOUTME: Type definitions for agent message queueing system
// ABOUTME: Defines QueuedMessage and MessageQueueStats interfaces

export interface QueuedMessage {
  id: string;
  type: 'user' | 'system' | 'task_notification';
  content: string;
  timestamp: Date;
  metadata?: {
    taskId?: string;
    fromAgent?: string;
    priority?: 'normal' | 'high';
    source?: 'task_system' | 'user_input' | 'agent_message';
  };
}

export interface MessageQueueStats {
  queueLength: number;
  oldestMessageAge?: number;
  highPriorityCount: number;
}