// ABOUTME: Tests for message queue types and validation
// ABOUTME: Ensures QueuedMessage and MessageQueueStats work correctly

import { describe, it, expect } from 'vitest';
import { QueuedMessage, MessageQueueStats } from '../types.js';

describe('QueuedMessage', () => {
  it('should create a valid queued message', () => {
    const message: QueuedMessage = {
      id: 'test-id',
      type: 'user',
      content: 'test message',
      timestamp: new Date(),
    };

    expect(message.id).toBe('test-id');
    expect(message.type).toBe('user');
    expect(message.content).toBe('test message');
    expect(message.timestamp).toBeInstanceOf(Date);
  });

  it('should support all message types', () => {
    const userMessage: QueuedMessage = {
      id: '1',
      type: 'user',
      content: 'user message',
      timestamp: new Date(),
    };

    const systemMessage: QueuedMessage = {
      id: '2', 
      type: 'system',
      content: 'system message',
      timestamp: new Date(),
    };

    const taskMessage: QueuedMessage = {
      id: '3',
      type: 'task_notification',
      content: 'task message',
      timestamp: new Date(),
    };

    expect(userMessage.type).toBe('user');
    expect(systemMessage.type).toBe('system');
    expect(taskMessage.type).toBe('task_notification');
  });

  it('should support optional metadata', () => {
    const messageWithMetadata: QueuedMessage = {
      id: 'test-id',
      type: 'task_notification',
      content: 'task assigned',
      timestamp: new Date(),
      metadata: {
        taskId: 'task-123',
        fromAgent: 'agent-456',
        priority: 'high',
        source: 'task_system',
      },
    };

    expect(messageWithMetadata.metadata?.taskId).toBe('task-123');
    expect(messageWithMetadata.metadata?.fromAgent).toBe('agent-456');
    expect(messageWithMetadata.metadata?.priority).toBe('high');
    expect(messageWithMetadata.metadata?.source).toBe('task_system');
  });

  it('should work without metadata', () => {
    const messageWithoutMetadata: QueuedMessage = {
      id: 'test-id',
      type: 'user',
      content: 'simple message',
      timestamp: new Date(),
    };

    expect(messageWithoutMetadata.metadata).toBeUndefined();
  });
});

describe('MessageQueueStats', () => {
  it('should create valid queue stats', () => {
    const stats: MessageQueueStats = {
      queueLength: 5,
      oldestMessageAge: 30000,
      highPriorityCount: 2,
    };

    expect(stats.queueLength).toBe(5);
    expect(stats.oldestMessageAge).toBe(30000);
    expect(stats.highPriorityCount).toBe(2);
  });

  it('should support empty queue stats', () => {
    const emptyStats: MessageQueueStats = {
      queueLength: 0,
      highPriorityCount: 0,
    };

    expect(emptyStats.queueLength).toBe(0);
    expect(emptyStats.highPriorityCount).toBe(0);
    expect(emptyStats.oldestMessageAge).toBeUndefined();
  });

  it('should support stats with no high priority messages', () => {
    const stats: MessageQueueStats = {
      queueLength: 3,
      oldestMessageAge: 15000,
      highPriorityCount: 0,
    };

    expect(stats.queueLength).toBe(3);
    expect(stats.highPriorityCount).toBe(0);
  });
});