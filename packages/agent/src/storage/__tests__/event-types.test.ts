// ABOUTME: Tests for DurableEventData discriminated union type narrowing

import { describe, it, expect } from 'vitest';
import type { TypedDurableEvent } from '../event-types';

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

describe('track field', () => {
  it('PromptEventData accepts optional track', () => {
    const e: TypedDurableEvent = {
      eventSeq: 1,
      timestamp: '2026-05-24T00:00:00Z',
      type: 'prompt',
      data: {
        type: 'prompt',
        content: [{ type: 'text', text: 'hi' }],
        track: 'slack:T1:C1:1.0',
      },
    };
    expect(e.data.type === 'prompt' && e.data.track).toBe('slack:T1:C1:1.0');
  });

  it('ContextInjectedEventData accepts optional track', () => {
    const e: TypedDurableEvent = {
      eventSeq: 2,
      timestamp: '2026-05-24T00:00:01Z',
      type: 'context_injected',
      data: {
        type: 'context_injected',
        content: [{ type: 'text', text: 'note' }],
        track: 'alarm:abc',
      },
    };
    expect(e.data.type === 'context_injected' && e.data.track).toBe('alarm:abc');
  });

  it('TurnEndEventData.usage accepts lastCallInputContextTokens', () => {
    const e: TypedDurableEvent = {
      eventSeq: 3,
      timestamp: '2026-05-24T00:00:02Z',
      type: 'turn_end',
      data: {
        type: 'turn_end',
        stopReason: 'end_turn',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationInputTokens: 200,
          cacheReadInputTokens: 300,
          lastCallInputContextTokens: 600,
          costUsd: 0.01,
        },
      },
    };
    expect(e.data.type === 'turn_end' && e.data.usage?.lastCallInputContextTokens).toBe(600);
  });
});
