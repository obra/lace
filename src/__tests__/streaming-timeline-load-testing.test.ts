// ABOUTME: Comprehensive load testing for StreamingTimelineProcessor performance validation
// ABOUTME: Tests O(1) behavior across conversation sizes from small to very large (1000+ events)

import { describe, it, expect, beforeEach } from 'vitest';
import { StreamingTimelineProcessor } from '../interfaces/streaming-timeline-processor.js';
import { ThreadEvent } from '../threads/types.js';
import { ToolCall, ToolResult } from '../tools/types.js';

describe('StreamingTimelineProcessor Load Testing', () => {
  let processor: StreamingTimelineProcessor;

  beforeEach(() => {
    processor = new StreamingTimelineProcessor();
  });

  describe('Small Conversation Load Testing (10 events)', () => {
    it('should handle small conversations with consistent O(1) performance', () => {
      const events = generateEventSequence(10, 'small-thread');
      const timings: number[] = [];

      // Measure each append operation
      for (const event of events) {
        const startTime = performance.now();
        processor.appendEvent(event);
        const endTime = performance.now();
        timings.push(endTime - startTime);
      }

      // Verify timeline correctness
      const timeline = processor.getTimeline();
      expect(timeline.items).toHaveLength(10);
      expect(timeline.metadata.eventCount).toBe(10);

      // Verify performance consistency
      const avgTime = timings.reduce((sum, time) => sum + time, 0) / timings.length;
      const maxTime = Math.max(...timings);

      expect(avgTime).toBeLessThan(1); // Should be very fast
      expect(maxTime).toBeLessThan(5); // No single operation should be slow

      // Verify metrics show good fast path efficiency
      const metrics = processor.getMetrics();
      expect(metrics.fastPathHits / metrics.appendCount).toBeGreaterThan(0.9); // 90%+ fast path
    });
  });

  describe('Medium Conversation Load Testing (100 events)', () => {
    it('should handle medium conversations with stable performance', () => {
      const events = generateEventSequence(100, 'medium-thread');
      const timings: number[] = [];

      // Measure append performance
      for (const event of events) {
        const startTime = performance.now();
        processor.appendEvent(event);
        const endTime = performance.now();
        timings.push(endTime - startTime);
      }

      // Verify timeline correctness
      const timeline = processor.getTimeline();
      expect(timeline.items).toHaveLength(100);
      expect(timeline.metadata.eventCount).toBe(100);

      // Verify performance stability - later events shouldn't be slower
      const firstQuarterAvg = average(timings.slice(0, 25));
      const lastQuarterAvg = average(timings.slice(-25));
      const performanceDrift = lastQuarterAvg / firstQuarterAvg;

      expect(performanceDrift).toBeLessThan(2); // No more than 2x degradation
      expect(average(timings)).toBeLessThan(1); // Overall fast performance

      // Verify fast path efficiency remains high
      const metrics = processor.getMetrics();
      expect(metrics.fastPathHits / metrics.appendCount).toBeGreaterThan(0.85); // 85%+ fast path
    });
  });

  describe('Large Conversation Load Testing (1000+ events)', () => {
    it('should handle large conversations without performance degradation', () => {
      const eventCount = 1000;
      const events = generateEventSequence(eventCount, 'large-thread');
      const timings: number[] = [];

      console.log(`\n📊 Load testing with ${eventCount} events...`);

      // Measure append performance in batches
      const batchSize = 100;
      const batchTimings: number[] = [];

      for (let i = 0; i < events.length; i += batchSize) {
        const batch = events.slice(i, i + batchSize);
        const batchStartTime = performance.now();

        for (const event of batch) {
          const startTime = performance.now();
          processor.appendEvent(event);
          const endTime = performance.now();
          timings.push(endTime - startTime);
        }

        const batchEndTime = performance.now();
        batchTimings.push(batchEndTime - batchStartTime);

        // Log progress
        if ((i + batchSize) % 200 === 0) {
          const progress = Math.round(((i + batchSize) / events.length) * 100);
          console.log(`  ${progress}% complete (${i + batchSize}/${events.length} events)`);
        }
      }

      // Verify timeline correctness
      const timeline = processor.getTimeline();
      expect(timeline.items).toHaveLength(eventCount);
      expect(timeline.metadata.eventCount).toBe(eventCount);

      // Verify O(1) behavior - performance should not degrade significantly
      const firstBatchAvg = average(batchTimings.slice(0, 2));
      const lastBatchAvg = average(batchTimings.slice(-2));
      const performanceDrift = lastBatchAvg / firstBatchAvg;

      console.log(`  First batch avg: ${firstBatchAvg.toFixed(3)}ms`);
      console.log(`  Last batch avg: ${lastBatchAvg.toFixed(3)}ms`);
      console.log(`  Performance drift: ${performanceDrift.toFixed(2)}x`);

      expect(performanceDrift).toBeLessThan(2); // No more than 2x degradation
      expect(average(timings)).toBeLessThan(2); // Individual operations stay fast

      // Verify fast path efficiency remains reasonable
      const metrics = processor.getMetrics();
      const fastPathEfficiency = metrics.fastPathHits / metrics.appendCount;
      console.log(`  Fast path efficiency: ${(fastPathEfficiency * 100).toFixed(1)}%`);
      expect(fastPathEfficiency).toBeGreaterThan(0.8); // 80%+ fast path for ordered events

      console.log(`✅ Large conversation load test completed successfully`);
    });

    it('should handle very large conversations (2000+ events) efficiently', () => {
      const eventCount = 2000;
      console.log(`\n🚀 Stress testing with ${eventCount} events...`);

      // Use bulk loading for initial setup to test realistic resumption scenario
      const initialEvents = generateEventSequence(1500, 'stress-thread');
      const bulkStartTime = performance.now();
      processor.loadEvents(initialEvents);
      const bulkEndTime = performance.now();

      console.log(`  Bulk loaded 1500 events in ${(bulkEndTime - bulkStartTime).toFixed(3)}ms`);

      // Add remaining events incrementally (simulating real-time additions)
      const incrementalEvents = generateEventSequence(500, 'stress-thread', 1500);
      const timings: number[] = [];

      for (const event of incrementalEvents) {
        const startTime = performance.now();
        processor.appendEvent(event);
        const endTime = performance.now();
        timings.push(endTime - startTime);
      }

      // Verify timeline correctness
      const timeline = processor.getTimeline();
      expect(timeline.items).toHaveLength(eventCount);
      expect(timeline.metadata.eventCount).toBe(eventCount);

      // Verify incremental performance remains good despite large timeline
      const avgIncrementalTime = average(timings);
      console.log(`  Average incremental append time: ${avgIncrementalTime.toFixed(3)}ms`);
      expect(avgIncrementalTime).toBeLessThan(3); // Should stay under 3ms per event

      // Verify getTimeline() performance with large dataset
      const getTimelineStartTime = performance.now();
      const timelineCopy = processor.getTimeline();
      const getTimelineEndTime = performance.now();
      const getTimelineTime = getTimelineEndTime - getTimelineStartTime;

      console.log(`  getTimeline() with 2000 items: ${getTimelineTime.toFixed(3)}ms`);
      expect(getTimelineTime).toBeLessThan(50); // Should be fast even for large timelines
      expect(timelineCopy.items).toHaveLength(eventCount);

      console.log(`✅ Stress test completed successfully`);
    });
  });

  describe('Memory Leak Detection', () => {
    it('should not leak memory during extended operation', () => {
      const initialHeap = getHeapUsage();
      console.log(`\n🧠 Memory leak test starting (initial heap: ${initialHeap.toFixed(2)}MB)`);

      // Simulate extended operation with many small conversations
      for (let conversation = 0; conversation < 10; conversation++) {
        processor.reset();

        // Add 200 events per conversation
        const events = generateEventSequence(200, `conv-${conversation}`);
        for (const event of events) {
          processor.appendEvent(event);
        }

        // Verify conversation processed correctly
        expect(processor.getTimeline().items).toHaveLength(200);

        if (conversation % 3 === 0) {
          const currentHeap = getHeapUsage();
          console.log(`  Conversation ${conversation}: ${currentHeap.toFixed(2)}MB`);
        }
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalHeap = getHeapUsage();
      const heapGrowth = finalHeap - initialHeap;

      console.log(`  Final heap: ${finalHeap.toFixed(2)}MB`);
      console.log(`  Heap growth: ${heapGrowth.toFixed(2)}MB`);

      // Memory growth should be reasonable (under 50MB for this test)
      expect(heapGrowth).toBeLessThan(50);

      console.log(`✅ Memory leak test completed`);
    });
  });

  describe('Mixed Event Type Performance', () => {
    it('should handle complex event sequences with tools efficiently', () => {
      console.log(`\n🔧 Testing complex tool sequences...`);

      const events = generateComplexToolSequence(500, 'tool-thread');
      const timings: number[] = [];

      for (const event of events) {
        const startTime = performance.now();
        processor.appendEvent(event);
        const endTime = performance.now();
        timings.push(endTime - startTime);
      }

      const timeline = processor.getTimeline();

      // Should have messages and tool executions
      const messageCount = timeline.items.filter(
        (item) => item.type === 'user_message' || item.type === 'agent_message'
      ).length;
      const toolCount = timeline.items.filter((item) => item.type === 'tool_execution').length;

      expect(messageCount).toBeGreaterThan(100);
      expect(toolCount).toBeGreaterThan(50);
      expect(timeline.metadata.eventCount).toBe(500);

      // Performance should remain good even with complex tool correlation
      const avgTime = average(timings);
      console.log(`  Average append time with tools: ${avgTime.toFixed(3)}ms`);
      expect(avgTime).toBeLessThan(2);

      // Verify no orphaned tool calls
      const pendingCalls = timeline.items.filter(
        (item) => item.type === 'tool_execution' && !item.result
      ).length;
      expect(pendingCalls).toBe(0); // All tool calls should have results

      console.log(`✅ Complex tool sequence test completed`);
    });
  });

  describe('Concurrent Timeline Performance', () => {
    it('should handle multiple independent processors efficiently', () => {
      console.log(`\n🔄 Testing concurrent timeline processors...`);

      const processors = Array.from({ length: 5 }, () => new StreamingTimelineProcessor());
      const timings: number[][] = Array.from({ length: 5 }, () => []);

      // Simulate 5 concurrent conversations
      for (let round = 0; round < 100; round++) {
        for (let procIndex = 0; procIndex < processors.length; procIndex++) {
          const processor = processors[procIndex];
          const event = generateSingleEvent(
            `proc-${procIndex}-${round}`,
            'USER_MESSAGE',
            `processor-${procIndex}`
          );

          const startTime = performance.now();
          processor.appendEvent(event);
          const endTime = performance.now();

          timings[procIndex].push(endTime - startTime);
        }
      }

      // Verify all processors completed successfully
      for (let i = 0; i < processors.length; i++) {
        const timeline = processors[i].getTimeline();
        expect(timeline.items).toHaveLength(100);
        expect(timeline.metadata.eventCount).toBe(100);

        const avgTime = average(timings[i]);
        expect(avgTime).toBeLessThan(1); // Each processor should maintain performance
      }

      console.log(`✅ Concurrent processors test completed`);
    });
  });
});

// Helper functions for generating test data

function generateEventSequence(count: number, threadId: string, startIndex = 0): ThreadEvent[] {
  const events: ThreadEvent[] = [];
  const baseTime = Date.now();

  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    const eventType = i % 2 === 0 ? 'USER_MESSAGE' : 'AGENT_MESSAGE';
    const data = eventType === 'USER_MESSAGE' ? `User message ${index}` : `Agent response ${index}`;

    events.push({
      id: `event-${index}`,
      type: eventType,
      data,
      timestamp: new Date(baseTime + index * 1000),
      threadId,
    });
  }

  return events;
}

function generateComplexToolSequence(count: number, threadId: string): ThreadEvent[] {
  const events: ThreadEvent[] = [];
  const baseTime = Date.now();
  let eventIndex = 0;

  while (events.length < count) {
    // Add user message
    events.push({
      id: `event-${eventIndex++}`,
      type: 'USER_MESSAGE',
      data: `User message ${eventIndex}`,
      timestamp: new Date(baseTime + events.length * 1000),
      threadId,
    });

    if (events.length >= count) break;

    // Sometimes add tool call + result
    if (eventIndex % 3 === 0) {
      const toolCallId = `tool-${eventIndex}`;

      // Tool call
      events.push({
        id: `event-${eventIndex++}`,
        type: 'TOOL_CALL',
        data: {
          id: toolCallId,
          name: 'test-tool',
          arguments: { param: `value-${eventIndex}` },
        } as ToolCall,
        timestamp: new Date(baseTime + events.length * 1000),
        threadId,
      });

      if (events.length >= count) break;

      // Tool result
      events.push({
        id: `event-${eventIndex++}`,
        type: 'TOOL_RESULT',
        data: {
          id: toolCallId,
          content: [{ type: 'text', text: `Tool result ${eventIndex}` }],
          isError: false,
        } as ToolResult,
        timestamp: new Date(baseTime + events.length * 1000),
        threadId,
      });
    } else {
      // Add agent message
      events.push({
        id: `event-${eventIndex++}`,
        type: 'AGENT_MESSAGE',
        data: `Agent response ${eventIndex}`,
        timestamp: new Date(baseTime + events.length * 1000),
        threadId,
      });
    }
  }

  return events.slice(0, count);
}

function generateSingleEvent(
  id: string,
  type: 'USER_MESSAGE' | 'AGENT_MESSAGE',
  threadId: string
): ThreadEvent {
  return {
    id,
    type,
    data: `${type} content`,
    timestamp: new Date(),
    threadId,
  };
}

function average(numbers: number[]): number {
  return numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
}

function getHeapUsage(): number {
  const memUsage = process.memoryUsage();
  return memUsage.heapUsed / 1024 / 1024; // Convert to MB
}
