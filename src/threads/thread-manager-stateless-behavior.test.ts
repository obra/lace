import { describe, it, expect } from 'vitest';
import { ThreadManager } from '~/threads/thread-manager';

describe('ThreadManager - Stateless Behavior', () => {
  it('should share data across instances via shared cache', () => {
    const manager1 = new ThreadManager();
    const threadId = manager1.createThread();
    manager1.addEvent(threadId, 'USER_MESSAGE', 'Test message');

    // Different instance should see same data
    const manager2 = new ThreadManager();
    const events = manager2.getEvents(threadId);

    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('Test message');
  });

  it('should handle concurrent operations correctly', () => {
    const manager1 = new ThreadManager();
    const manager2 = new ThreadManager();

    const threadId = manager1.createThread();

    // Both managers add events
    manager1.addEvent(threadId, 'USER_MESSAGE', 'From manager 1');
    manager2.addEvent(threadId, 'USER_MESSAGE', 'From manager 2');

    // Both should see all events
    const events1 = manager1.getEvents(threadId);
    const events2 = manager2.getEvents(threadId);

    expect(events1).toHaveLength(2);
    expect(events2).toHaveLength(2);
    expect(events1).toEqual(events2);
  });

  it('should not have any instance-specific state', () => {
    const manager = new ThreadManager();

    // Create threads
    const thread1 = manager.createThread();
    const thread2 = manager.createThread();

    // Add events to different threads
    manager.addEvent(thread1, 'USER_MESSAGE', 'Message 1');
    manager.addEvent(thread2, 'USER_MESSAGE', 'Message 2');

    // Each thread should have only its own events
    expect(manager.getEvents(thread1)).toHaveLength(1);
    expect(manager.getEvents(thread2)).toHaveLength(1);
  });
});
