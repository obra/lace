// ABOUTME: Test event type definitions and utilities
// ABOUTME: Ensures event types are correctly structured and utilities work

import { describe, it, expect } from 'vitest';
import type { ThreadEvent } from '@/types/core';
import { EVENT_TYPES } from '@/types/core';
import { UI_EVENT_TYPES, getAllEventTypes, isPersistedEvent } from './events-constants';
import { asThreadId } from '@/types/core';

describe('Event Types', () => {
  it('should export core EVENT_TYPES', () => {
    expect(EVENT_TYPES).toContain('USER_MESSAGE');
    expect(EVENT_TYPES).toContain('AGENT_MESSAGE');
    expect(EVENT_TYPES).toContain('TOOL_CALL');
  });

  it('should define UI_EVENT_TYPES', () => {
    expect(UI_EVENT_TYPES).toContain('TOOL_APPROVAL_REQUEST');
    expect(UI_EVENT_TYPES).toContain('AGENT_TOKEN');
    expect(UI_EVENT_TYPES).toContain('AGENT_STREAMING');
  });

  it('should combine all event types', () => {
    const allTypes = getAllEventTypes();
    expect(allTypes).toContain('USER_MESSAGE'); // from core
    expect(allTypes).toContain('AGENT_TOKEN'); // from UI
  });

  it('should identify persisted events', () => {
    expect(isPersistedEvent('USER_MESSAGE')).toBe(true);
    expect(isPersistedEvent('AGENT_TOKEN')).toBe(false);
  });

  it('should create valid ThreadEvent', () => {
    const event: ThreadEvent = {
      type: 'USER_MESSAGE',
      threadId: asThreadId('lace_20250731_test01'),
      timestamp: new Date(),
      data: 'Hello', // USER_MESSAGE data is a string
    };

    expect(event.type).toBe('USER_MESSAGE');
    expect(event.data).toBe('Hello');
  });
});
