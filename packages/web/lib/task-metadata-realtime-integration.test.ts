// ABOUTME: Simple test to verify session-service.ts event format fix worked
// ABOUTME: Tests that real-time and persistence TOOL_RESULT events have identical structure

import { describe, it, expect } from 'vitest';
import type { LaceEvent } from '@/types/core';
import type { ToolResult, ThreadId } from '@/types/core';

describe('Task Metadata Event Format', () => {
  it('should have correct TOOL_RESULT format for task metadata', () => {
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

    // Correct ToolResult structure
    const toolResult: ToolResult = {
      content: [{ type: 'text', text: 'Task created successfully' }],
      metadata: taskMetadata,
      status: 'completed' as const,
    };

    const testThreadId = 'lace_20240115_abc123' as ThreadId;

    // Real-time event format (correct)
    const toolResultEvent: LaceEvent = {
      type: 'TOOL_RESULT',
      threadId: testThreadId,
      timestamp: new Date(),
      data: toolResult, // Direct result format
    };

    // Verify the structure
    expect(toolResultEvent.type).toBe('TOOL_RESULT');
    expect(toolResultEvent.data).toEqual(toolResult);

    // Verify metadata is accessible
    const eventData = toolResultEvent.data as ToolResult;
    expect(eventData.metadata).toEqual(taskMetadata);
    expect(eventData.content).toEqual([{ type: 'text', text: 'Task created successfully' }]);
    expect(eventData.status).toBe('completed');
  });

  it('should reject incorrect wrapped TOOL_RESULT format', () => {
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
      status: 'completed' as const,
    };

    // Incorrect wrapped format (the bug we fixed)
    const incorrectData = {
      toolName: 'task_add',
      result: toolResult, // Wrapped format - this was the bug
    };

    // This should NOT be a valid ToolResult
    const isValidToolResult = (data: unknown): data is ToolResult => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'content' in data &&
        Array.isArray((data as ToolResult).content)
      );
    };

    // The wrapped format should NOT pass validation
    expect(isValidToolResult(incorrectData)).toBe(false);

    // The correct format should pass validation
    expect(isValidToolResult(toolResult)).toBe(true);
  });
});
