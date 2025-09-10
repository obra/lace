// ABOUTME: Test event type definitions and utilities
// ABOUTME: Ensures event types are correctly structured and utilities work

import { describe, it, expect } from 'vitest';
import type { LaceEvent } from '@/types/core';
import { EVENT_TYPES, isTransientEventType, asThreadId } from '@/types/core';

describe('Event Types', () => {
  it('should export core EVENT_TYPES', () => {
    expect(EVENT_TYPES).toContain('USER_MESSAGE');
    expect(EVENT_TYPES).toContain('AGENT_MESSAGE');
    expect(EVENT_TYPES).toContain('TOOL_CALL');
  });

  it('should include transient event types', () => {
    expect(EVENT_TYPES).toContain('TOOL_APPROVAL_REQUEST');
    expect(EVENT_TYPES).toContain('AGENT_TOKEN');
    expect(EVENT_TYPES).toContain('AGENT_STREAMING');
  });

  it('should identify transient events', () => {
    expect(isTransientEventType('USER_MESSAGE')).toBe(false); // USER_MESSAGE is persisted
    expect(isTransientEventType('AGENT_TOKEN')).toBe(true); // AGENT_TOKEN is transient
    expect(isTransientEventType('TOOL_APPROVAL_REQUEST')).toBe(false); // Actually persisted!
    expect(isTransientEventType('AGENT_STREAMING')).toBe(true); // Transient
  });

  it('should create valid LaceEvent', () => {
    const event: LaceEvent = {
      type: 'USER_MESSAGE',
      timestamp: new Date(),
      data: 'Hello', // USER_MESSAGE data is a string
      context: { threadId: asThreadId('lace_20250731_test01') },
    };

    expect(event.type).toBe('USER_MESSAGE');
    expect(event.data).toBe('Hello');
  });
});
