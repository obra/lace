// ABOUTME: Tests for thread event types alignment with protocol

import { describe, it, expect } from 'vitest';
import {
  EVENT_TYPES,
  isTransientEventType,
  type SessionInfoData,
  type ContextWindowData,
} from './types';

describe('Thread Event Types - Protocol Alignment (Task 7)', () => {
  describe('EVENT_TYPES array', () => {
    it('should have SESSION_INFO instead of SESSION_UPDATED', () => {
      expect(EVENT_TYPES).toContain('SESSION_INFO');
      expect(EVENT_TYPES).not.toContain('SESSION_UPDATED');
    });

    it('should have CONTEXT_WINDOW event type', () => {
      expect(EVENT_TYPES).toContain('CONTEXT_WINDOW');
    });

    it('should have existing compaction and MCP events', () => {
      expect(EVENT_TYPES).toContain('COMPACTION_START');
      expect(EVENT_TYPES).toContain('COMPACTION_COMPLETE');
      expect(EVENT_TYPES).toContain('MCP_CONFIG_CHANGED');
      expect(EVENT_TYPES).toContain('MCP_SERVER_STATUS_CHANGED');
      expect(EVENT_TYPES).toContain('AGENT_ERROR');
    });
  });

  describe('SessionInfoData type', () => {
    it('should accept title and updatedAt fields', () => {
      const data: SessionInfoData = {
        title: 'Test Session',
        updatedAt: new Date(),
      };
      expect(data.title).toBe('Test Session');
      expect(data.updatedAt).toBeInstanceOf(Date);
    });

    it('should accept optional _meta field', () => {
      const data: SessionInfoData = {
        title: 'Test',
        _meta: { custom: 'value' },
      };
      expect(data._meta).toEqual({ custom: 'value' });
    });
  });

  describe('ContextWindowData type', () => {
    it('should accept used and size fields', () => {
      const data: ContextWindowData = {
        used: 50000,
        size: 200000,
      };
      expect(data.used).toBe(50000);
      expect(data.size).toBe(200000);
    });
  });

  describe('isTransientEventType()', () => {
    it('should mark SESSION_INFO as transient', () => {
      expect(isTransientEventType('SESSION_INFO')).toBe(true);
    });

    it('should mark CONTEXT_WINDOW as transient', () => {
      expect(isTransientEventType('CONTEXT_WINDOW')).toBe(true);
    });

    it('should mark other transient events correctly', () => {
      expect(isTransientEventType('AGENT_TOKEN')).toBe(true);
      expect(isTransientEventType('AGENT_STREAMING')).toBe(true);
      expect(isTransientEventType('COMPACTION_START')).toBe(true);
      expect(isTransientEventType('COMPACTION_COMPLETE')).toBe(true);
    });

    it('should mark conversation events as not transient', () => {
      expect(isTransientEventType('USER_MESSAGE')).toBe(false);
      expect(isTransientEventType('AGENT_MESSAGE')).toBe(false);
      expect(isTransientEventType('TOOL_CALL')).toBe(false);
    });
  });
});
