// ABOUTME: Performance tests for StreamingTimelineProcessor ensuring O(1) behavior
// ABOUTME: Verifies constant-time processing regardless of conversation length

import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadEvent } from '~/threads/types.js';
import { StreamingTimelineProcessor } from '~/interfaces/streaming-timeline-processor.js';

describe('StreamingTimelineProcessor Performance', () => {
  let processor: StreamingTimelineProcessor;

  beforeEach(() => {
    processor = new StreamingTimelineProcessor();
  });

  const createTestEvent = (
    id: string,
    type: 'USER_MESSAGE' | 'AGENT_MESSAGE' = 'USER_MESSAGE',
    timestamp?: Date
  ): ThreadEvent => ({
    id,
    type,
    data: `Message ${id}`,
    timestamp: timestamp || new Date(),
    threadId: 'thread-1',
  });

  describe('O(1) Append Performance', () => {
    it('should maintain constant time for appendEvent regardless of timeline size', () => {
      const measurements: { timelineSize: number; avgTime: number }[] = [];

      // Test with different timeline sizes
      for (const targetSize of [10, 100, 500, 1000]) {
        // Build up timeline to target size
        for (let i = 0; i < targetSize; i++) {
          processor.appendEvent(createTestEvent(`setup-${i}`));
        }

        // Measure append time for next 10 events
        const times: number[] = [];
        for (let i = 0; i < 10; i++) {
          const start = performance.now();
          processor.appendEvent(createTestEvent(`test-${targetSize}-${i}`));
          const end = performance.now();
          times.push(end - start);
        }

        const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
        measurements.push({ timelineSize: targetSize, avgTime });

        // Reset for next test
        processor.reset();
      }

      // Verify O(1) behavior - times should not grow significantly with timeline size
      // Allow for some variance but performance should remain roughly constant
      const firstMeasurement = measurements[0];
      const lastMeasurement = measurements[measurements.length - 1];

      // Performance should not degrade by more than 10x even with 100x more data
      const performanceDegradation = lastMeasurement.avgTime / firstMeasurement.avgTime;
      expect(performanceDegradation).toBeLessThan(10);
    });

    it('should handle rapid event additions without performance degradation', () => {
      const eventCount = 1000;
      const times: number[] = [];

      // Measure time for each individual append
      for (let i = 0; i < eventCount; i++) {
        const start = performance.now();
        processor.appendEvent(createTestEvent(`rapid-${i}`));
        const end = performance.now();
        times.push(end - start);
      }

      // Check that later operations aren't significantly slower than earlier ones
      const firstQuartile = times.slice(0, Math.floor(eventCount / 4));
      const lastQuartile = times.slice(-Math.floor(eventCount / 4));

      const avgFirst = firstQuartile.reduce((sum, time) => sum + time, 0) / firstQuartile.length;
      const avgLast = lastQuartile.reduce((sum, time) => sum + time, 0) / lastQuartile.length;

      // Last quarter should not be more than 5x slower than first quarter
      const degradation = avgLast / avgFirst;
      expect(degradation).toBeLessThan(5);
    });
  });

  describe('Memory Usage', () => {
    it('should not leak memory during extended operation', () => {
      const initialMemory = process.memoryUsage();

      // Add many events
      for (let i = 0; i < 10000; i++) {
        processor.appendEvent(createTestEvent(`memory-test-${i}`));
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage();

      // Memory should grow linearly with data, not exponentially
      // Allow for some overhead but ensure we're not leaking
      const heapGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      const expectedGrowthPerEvent = 1000; // bytes - rough estimate
      const maxExpectedGrowth = 10000 * expectedGrowthPerEvent * 2; // 2x buffer

      expect(heapGrowth).toBeLessThan(maxExpectedGrowth);
    });

    it('should clean up tool call correlation state', () => {
      // Add many tool calls without results to test cleanup
      for (let i = 0; i < 1000; i++) {
        processor.appendEvent({
          id: `tool-call-${i}`,
          type: 'TOOL_CALL',
          data: {
            id: `call-${i}`,
            name: 'test-tool',
            arguments: { index: i },
          },
          timestamp: new Date(),
          threadId: 'thread-1',
        });
      }

      // Verify timeline doesn't contain individual tool calls (they should be pending)
      const timeline = processor.getTimeline();
      const toolExecutions = timeline.items.filter((item) => item.type === 'tool_execution');

      // Since we haven't provided results, these should be pending and not in timeline yet
      // (They'll be added when loadEvents() completes or reset() is called)
      expect(toolExecutions.length).toBe(0);

      // Reset should clean up pending tool calls
      processor.reset();
      const emptyTimeline = processor.getTimeline();
      expect(emptyTimeline.items).toHaveLength(0);
    });
  });

  describe('Bulk Loading Performance', () => {
    it('should handle large event sets efficiently during loadEvents', () => {
      const eventCount = 5000;
      const events: ThreadEvent[] = [];

      // Create large event set
      for (let i = 0; i < eventCount; i++) {
        events.push(createTestEvent(`bulk-${i}`, i % 2 === 0 ? 'USER_MESSAGE' : 'AGENT_MESSAGE'));
      }

      // Measure bulk loading time
      const start = performance.now();
      processor.loadEvents(events);
      const end = performance.now();

      const loadTime = end - start;
      const timeline = processor.getTimeline();

      expect(timeline.items).toHaveLength(eventCount);
      expect(timeline.metadata.eventCount).toBe(eventCount);

      // Should complete within reasonable time (less than 1 second for 5000 events)
      expect(loadTime).toBeLessThan(1000);
    });
  });

  describe('Timeline Size Scalability', () => {
    it('should maintain performance with very large timelines', () => {
      // Build a large timeline
      const largeTimelineSize = 2000;
      const events: ThreadEvent[] = [];

      for (let i = 0; i < largeTimelineSize; i++) {
        events.push(createTestEvent(`large-${i}`));
      }

      processor.loadEvents(events);

      // Measure performance of operations on large timeline
      const operations: { operation: string; time: number }[] = [];

      // Test getTimeline performance
      let start = performance.now();
      const timeline = processor.getTimeline();
      let end = performance.now();
      operations.push({ operation: 'getTimeline', time: end - start });

      // Test appendEvent performance on large timeline
      start = performance.now();
      processor.appendEvent(createTestEvent('append-to-large'));
      end = performance.now();
      operations.push({ operation: 'appendEvent', time: end - start });

      // Test reset performance
      start = performance.now();
      processor.reset();
      end = performance.now();
      operations.push({ operation: 'reset', time: end - start });

      // All operations should complete quickly regardless of timeline size
      for (const { time } of operations) {
        expect(time).toBeLessThan(100); // Less than 100ms for any operation
      }

      expect(timeline.items).toHaveLength(largeTimelineSize);
    });
  });
});
