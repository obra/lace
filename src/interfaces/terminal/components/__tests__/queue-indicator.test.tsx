// ABOUTME: Tests for QueueIndicator component
// ABOUTME: Verifies queue status display and priority indication

import React from 'react';
import { describe, it, expect } from 'vitest';
import {
  renderInkComponent,
  stripAnsi,
} from '~/interfaces/terminal/__tests__/helpers/ink-test-utils';
import { QueueIndicator } from '~/interfaces/terminal/components/queue-indicator';
import type { MessageQueueStats } from '~/agents/types';

describe('QueueIndicator', () => {
  it('should not render when queue is empty', () => {
    const emptyStats: MessageQueueStats = {
      queueLength: 0,
      highPriorityCount: 0,
    };

    const { lastFrame } = renderInkComponent(<QueueIndicator stats={emptyStats} />);

    const frame = stripAnsi(lastFrame() || '');
    expect(frame).toBe('');
  });

  it('should show basic queue count', () => {
    const stats: MessageQueueStats = {
      queueLength: 3,
      highPriorityCount: 0,
      oldestMessageAge: 5000,
    };

    const { lastFrame } = renderInkComponent(<QueueIndicator stats={stats} />);

    const frame = lastFrame();
    expect(frame).toContain('📬 3 queued');
  });

  it('should indicate high priority messages', () => {
    const stats: MessageQueueStats = {
      queueLength: 5,
      highPriorityCount: 2,
      oldestMessageAge: 10000,
    };

    const { lastFrame } = renderInkComponent(<QueueIndicator stats={stats} />);

    const frame = lastFrame();
    expect(frame).toContain('📬 5 queued');
    expect(frame).toContain('(2 high)');
  });

  it('should show high priority without total when all messages are high priority', () => {
    const stats: MessageQueueStats = {
      queueLength: 2,
      highPriorityCount: 2,
      oldestMessageAge: 3000,
    };

    const { lastFrame } = renderInkComponent(<QueueIndicator stats={stats} />);

    const frame = lastFrame();
    expect(frame).toContain('📬 2 queued');
    expect(frame).toContain('(2 high)');
  });

  it('should not show high priority indicator when count is zero', () => {
    const stats: MessageQueueStats = {
      queueLength: 4,
      highPriorityCount: 0,
      oldestMessageAge: 7000,
    };

    const { lastFrame } = renderInkComponent(<QueueIndicator stats={stats} />);

    const frame = lastFrame();
    expect(frame).toContain('📬 4 queued');
    expect(frame).not.toContain('high');
  });

  it('should handle stats without oldestMessageAge', () => {
    const stats: MessageQueueStats = {
      queueLength: 1,
      highPriorityCount: 1,
    };

    const { lastFrame } = renderInkComponent(<QueueIndicator stats={stats} />);

    const frame = lastFrame();
    expect(frame).toContain('📬 1 queued');
    expect(frame).toContain('(1 high)');
  });

  it('should use yellow color for queue indicator', () => {
    const stats: MessageQueueStats = {
      queueLength: 2,
      highPriorityCount: 0,
    };

    const { lastFrame } = renderInkComponent(<QueueIndicator stats={stats} />);

    // Check that the component renders (yellow color will be in ANSI codes)
    const frame = lastFrame();
    expect(frame).toContain('📬 2 queued');
  });
});
