// ABOUTME: Tests for DurableEventData discriminated union type narrowing

import { describe, it, expect } from 'vitest';
import type { DurableEventData, TypedDurableEvent } from '../event-types';

describe('DurableEventData', () => {
  it('narrows prompt event data correctly', () => {
    const event: TypedDurableEvent = {
      eventSeq: 1,
      timestamp: '2026-01-15T00:00:00Z',
      type: 'prompt',
      data: { type: 'prompt', content: [{ type: 'text', text: 'hello' }] },
    };

    if (event.data.type === 'prompt') {
      // TypeScript should know this is PromptEventData
      expect(event.data.content).toBeDefined();
      expect(Array.isArray(event.data.content)).toBe(true);
    }
  });

  it('narrows tool_use event data correctly', () => {
    const event: TypedDurableEvent = {
      eventSeq: 2,
      timestamp: '2026-01-15T00:00:00Z',
      type: 'tool_use',
      data: {
        type: 'tool_use',
        toolCallId: 'tc_123',
        name: 'bash',
        input: { command: 'ls' },
      },
    };

    if (event.data.type === 'tool_use') {
      // TypeScript should know this is ToolUseEventData
      expect(event.data.toolCallId).toBe('tc_123');
      expect(event.data.name).toBe('bash');
    }
  });

  it('narrows job_started event data correctly', () => {
    const event: TypedDurableEvent = {
      eventSeq: 3,
      timestamp: '2026-01-15T00:00:00Z',
      type: 'job_started',
      data: {
        type: 'job_started',
        jobId: 'job_123',
        jobType: 'shell',
      },
    };

    if (event.data.type === 'job_started') {
      expect(event.data.jobId).toBe('job_123');
      expect(event.data.jobType).toBe('shell');
    }
  });
});
