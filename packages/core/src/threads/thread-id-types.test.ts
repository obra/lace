// ABOUTME: Tests for ThreadId branded types and validation functions
// ABOUTME: Ensures type safety for thread IDs and new agent specifications

import { describe, it, expect } from 'vitest';
import {
  ThreadId,
  isThreadId,
  asThreadId,
  NewAgentSpec,
  isNewAgentSpec,
  createNewAgentSpec,
  isAssigneeId,
} from '~/threads/types';

describe('ThreadId types', () => {
  describe('isThreadId', () => {
    it('should validate correct thread ID formats', () => {
      expect(isThreadId('lace_20250703_abc123')).toBe(true);
      expect(isThreadId('lace_20250703_xyz789')).toBe(true);
      expect(isThreadId('lace_19991231_000000')).toBe(true);
    });

    it('should validate hierarchical thread IDs', () => {
      expect(isThreadId('lace_20250703_abc123.1')).toBe(true);
      expect(isThreadId('lace_20250703_abc123.1.2')).toBe(true);
      expect(isThreadId('lace_20250703_abc123.999')).toBe(true);
    });

    it('should reject invalid thread ID formats', () => {
      expect(isThreadId('invalid')).toBe(false);
      expect(isThreadId('lace_2025703_abc123')).toBe(false); // Wrong date format
      expect(isThreadId('lace_20250703_ABC123')).toBe(false); // Uppercase not allowed
      expect(isThreadId('lace_20250703_abc12')).toBe(false); // Too short
      expect(isThreadId('lace_20250703_abc1234')).toBe(false); // Too long
      expect(isThreadId('lace_20250703_abc123.')).toBe(false); // Trailing dot
      expect(isThreadId('lace_20250703_abc123.a')).toBe(false); // Non-numeric suffix
      expect(isThreadId('')).toBe(false);
    });
  });

  describe('asThreadId', () => {
    it('should create valid thread IDs', () => {
      const id = asThreadId('lace_20250703_abc123');
      expect(id).toBe('lace_20250703_abc123');
      // TypeScript should see this as ThreadId type
      const _typeCheck: ThreadId = id;
    });

    it('should throw on invalid thread IDs', () => {
      expect(() => asThreadId('invalid')).toThrow('Invalid thread ID format: invalid');
      expect(() => asThreadId('lace_2025_abc123')).toThrow();
    });
  });
});

describe('NewAgentSpec types', () => {
  describe('isNewAgentSpec', () => {
    it('should validate correct new agent specs', () => {
      expect(isNewAgentSpec('new:lace:anthropic/claude-3-haiku')).toBe(true);
      expect(isNewAgentSpec('new:coding-agent:openai/gpt-4')).toBe(true);
      expect(isNewAgentSpec('new:helper:local/llama-2')).toBe(true);
    });

    it('should reject invalid new agent specs', () => {
      expect(isNewAgentSpec('new:anthropic')).toBe(false); // Missing model
      expect(isNewAgentSpec('anthropic/claude-3-haiku')).toBe(false); // Missing new: prefix
      expect(isNewAgentSpec('new:anthropic/claude-3-haiku')).toBe(false); // Old format - now invalid
      expect(isNewAgentSpec('new:openai/gpt-4')).toBe(false); // Old format - now invalid
      expect(isNewAgentSpec('new:')).toBe(false);
      expect(isNewAgentSpec('new:/')).toBe(false);
      expect(isNewAgentSpec('new:provider/')).toBe(false);
      expect(isNewAgentSpec('new:/model')).toBe(false);
      expect(isNewAgentSpec('')).toBe(false);
    });
  });

  describe('createNewAgentSpec', () => {
    it('should create valid new agent specs', () => {
      const spec = createNewAgentSpec('lace', 'anthropic', 'claude-3-haiku');
      expect(spec).toBe('new:lace:anthropic/claude-3-haiku');
      // TypeScript should see this as NewAgentSpec type
      const _typeCheck: NewAgentSpec = spec;
    });
  });
});

describe('AssigneeId types', () => {
  describe('isAssigneeId', () => {
    it('should accept valid thread IDs', () => {
      expect(isAssigneeId('lace_20250703_abc123')).toBe(true);
      expect(isAssigneeId('lace_20250703_abc123.1')).toBe(true);
    });

    it('should accept valid new agent specs', () => {
      expect(isAssigneeId('new:lace:anthropic/claude-3-haiku')).toBe(true);
      expect(isAssigneeId('new:coding-agent:openai/gpt-4')).toBe(true);
    });

    it('should reject invalid formats', () => {
      expect(isAssigneeId('invalid')).toBe(false);
      expect(isAssigneeId('lace_invalid')).toBe(false);
      expect(isAssigneeId('new:invalid')).toBe(false);
      expect(isAssigneeId('')).toBe(false);
    });
  });
});
