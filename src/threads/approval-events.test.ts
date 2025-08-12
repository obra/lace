// ABOUTME: Tests for new approval event types in the thread system
// ABOUTME: Validates TOOL_APPROVAL_REQUEST and TOOL_APPROVAL_RESPONSE event creation

import { describe, it, expect } from 'vitest';
import { EVENT_TYPES, LaceEventType } from '~/threads/types';

describe('Approval Event Types', () => {
  it('should include TOOL_APPROVAL_REQUEST in EVENT_TYPES', () => {
    expect(EVENT_TYPES).toContain('TOOL_APPROVAL_REQUEST');
  });

  it('should include TOOL_APPROVAL_RESPONSE in EVENT_TYPES', () => {
    expect(EVENT_TYPES).toContain('TOOL_APPROVAL_RESPONSE');
  });

  it('should accept TOOL_APPROVAL_REQUEST as valid LaceEventType', () => {
    const eventType: LaceEventType = 'TOOL_APPROVAL_REQUEST';
    expect(eventType).toBe('TOOL_APPROVAL_REQUEST');
  });

  it('should accept TOOL_APPROVAL_RESPONSE as valid LaceEventType', () => {
    const eventType: LaceEventType = 'TOOL_APPROVAL_RESPONSE';
    expect(eventType).toBe('TOOL_APPROVAL_RESPONSE');
  });
});
