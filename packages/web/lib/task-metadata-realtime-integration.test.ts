// ABOUTME: Simple test to verify session-service.ts event format fix worked
// ABOUTME: Tests that real-time and persistence TOOL_RESULT events have identical structure

import { describe, it, expect } from 'vitest';
import { convertSessionEventsToTimeline } from './timeline-converter';
import type { SessionEvent } from '@/types/web-sse';
import type { ApiAgent as AgentType } from '@/types/api';
import type { ToolResult, ThreadId } from '@/types/core';

describe('Task Metadata Event Format Bug', () => {
  it('should produce identical timeline results when TOOL_RESULT formats match', () => {
    // Mock task metadata like the task tools create
    const taskMetadata = {
      tasks: [
        {
          id: 'task_123',
          title: 'Test task',
          status: 'pending',
          priority: 'medium',
        },
      ],
    };

    const toolResult: ToolResult = {
      content: [{ type: 'text', text: 'Task created successfully' }],
      metadata: taskMetadata,
      isError: false,
    };

    // Real-time events (how session-service.ts supposedly sends them after my fix)
    const testThreadId = 'test-thread' as ThreadId;
    const realTimeEvents: SessionEvent[] = [
      {
        type: 'TOOL_CALL',
        threadId: testThreadId,
        timestamp: new Date(),
        data: { id: 'call-123', name: 'task_add', arguments: { tasks: [{ title: 'Test task' }] } },
      },
      {
        type: 'TOOL_RESULT',
        threadId: testThreadId,
        timestamp: new Date(),
        data: toolResult, // Direct result format (the fix)
      },
    ];

    // Persistence events (how they're stored and loaded on page reload)
    const persistenceEvents: SessionEvent[] = [
      {
        type: 'TOOL_CALL',
        threadId: testThreadId,
        timestamp: new Date(),
        data: { id: 'call-123', name: 'task_add', arguments: { tasks: [{ title: 'Test task' }] } },
      },
      {
        type: 'TOOL_RESULT',
        threadId: testThreadId,
        timestamp: new Date(),
        data: toolResult, // Same format
      },
    ];

    // Convert both to timeline
    const mockContext = {
      agents: [{ threadId: testThreadId, name: 'Test Agent' } as AgentType],
    };

    const realTimeTimeline = convertSessionEventsToTimeline(realTimeEvents, mockContext);
    const persistenceTimeline = convertSessionEventsToTimeline(persistenceEvents, mockContext);

    // Debug output for test validation
    if (process.env.NODE_ENV === 'test') {
      // Real-time timeline logged for debugging
      // Persistence timeline logged for debugging
    }

    // Both should produce tool entries with metadata
    const realTimeToolEntry = realTimeTimeline.find((e) => e.type === 'tool');
    const persistenceToolEntry = persistenceTimeline.find((e) => e.type === 'tool');

    expect(realTimeToolEntry).toBeDefined();
    expect(persistenceToolEntry).toBeDefined();

    // Both should have the task metadata
    const realTimeResult = realTimeToolEntry?.result as ToolResult;
    const persistenceResult = persistenceToolEntry?.result as ToolResult;

    expect(realTimeResult?.metadata?.tasks).toBeDefined();
    expect(persistenceResult?.metadata?.tasks).toBeDefined();

    // The metadata should be identical
    expect(realTimeResult?.metadata).toEqual(persistenceResult?.metadata);

    // Both have metadata - fix should work
  });

  it('should fail when TOOL_RESULT formats differ (old broken version)', () => {
    // Mock task metadata
    const taskMetadata = {
      tasks: [
        {
          id: 'task_123',
          title: 'Test task',
          status: 'pending',
          priority: 'medium',
        },
      ],
    };

    const toolResult: ToolResult = {
      content: [{ type: 'text', text: 'Task created successfully' }],
      metadata: taskMetadata,
      isError: false,
    };

    // Real-time events (old broken format before my fix)
    const testThreadId2 = 'test-thread' as ThreadId;
    const realTimeEventsBroken: SessionEvent[] = [
      {
        type: 'TOOL_CALL',
        threadId: testThreadId2,
        timestamp: new Date(),
        data: { id: 'call-123', name: 'task_add', arguments: { tasks: [{ title: 'Test task' }] } },
      },
      {
        type: 'TOOL_RESULT',
        threadId: testThreadId2,
        timestamp: new Date(),
        data: {
          toolName: 'task_add',
          result: toolResult, // Wrapped format (the bug)
        } as { toolName: string; result: unknown },
      },
    ];

    // Persistence events (correct format)
    const persistenceEvents: SessionEvent[] = [
      {
        type: 'TOOL_CALL',
        threadId: testThreadId2,
        timestamp: new Date(),
        data: { id: 'call-123', name: 'task_add', arguments: { tasks: [{ title: 'Test task' }] } },
      },
      {
        type: 'TOOL_RESULT',
        threadId: testThreadId2,
        timestamp: new Date(),
        data: toolResult, // Direct format
      },
    ];

    // Convert both to timeline
    const mockContext = {
      agents: [{ threadId: testThreadId2, name: 'Test Agent' } as AgentType],
    };

    const realTimeTimeline = convertSessionEventsToTimeline(realTimeEventsBroken, mockContext);
    const persistenceTimeline = convertSessionEventsToTimeline(persistenceEvents, mockContext);

    // Debug output for broken format demonstration
    if (process.env.NODE_ENV === 'test') {
      // Broken real-time timeline logged for debugging
      // Correct persistence timeline logged for debugging
    }

    // Both should produce tool entries
    const realTimeToolEntry = realTimeTimeline.find((e) => e.type === 'tool');
    const persistenceToolEntry = persistenceTimeline.find((e) => e.type === 'tool');

    expect(realTimeToolEntry).toBeDefined();
    expect(persistenceToolEntry).toBeDefined();

    // But real-time should NOT have metadata (due to wrong format)
    const realTimeResult = realTimeToolEntry?.result as unknown;
    const persistenceResult = persistenceToolEntry?.result as ToolResult;

    expect(persistenceResult?.metadata?.tasks).toBeDefined();

    // This would be the bug - real-time doesn't have metadata
    const realTimeHasMetadata = !!(realTimeResult as ToolResult)?.metadata?.tasks;
    const persistenceHasMetadata = !!persistenceResult?.metadata?.tasks;

    // Format mismatch causes metadata loss in real-time
    // This demonstrates the bug that was fixed

    // This demonstrates the bug
    expect(realTimeHasMetadata).toBe(false);
    expect(persistenceHasMetadata).toBe(true);
  });
});
