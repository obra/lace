// ABOUTME: Test suite for EventStreamFirehose singleton implementation
// ABOUTME: Validates base structure, subscription management, and connection handling

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { EventStreamFirehose } from './event-stream-firehose';

describe('EventStreamFirehose', () => {
  beforeEach(() => {
    // Reset singleton between tests
    (EventStreamFirehose as any).instance = null;
  });

  test('should return the same instance when called multiple times', () => {
    const instance1 = EventStreamFirehose.getInstance();
    const instance2 = EventStreamFirehose.getInstance();
    expect(instance1).toBe(instance2);
  });

  test('should start with no subscriptions and disconnected state', () => {
    const instance = EventStreamFirehose.getInstance();
    expect(instance.getStats().subscriptionCount).toBe(0);
    expect(instance.getStats().isConnected).toBe(false);
  });
});
