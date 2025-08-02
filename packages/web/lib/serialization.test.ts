// ABOUTME: Tests for superjson serialization of branded types and Date objects
// ABOUTME: Verifies core types survive serialization/deserialization round trips

import { serialize, deserialize } from './serialization';
import type { ThreadId } from '@/types/core';

// Define NewAgentSpec locally for testing (it's defined in serialization.ts)
type NewAgentSpec = string & { readonly __brand: 'NewAgentSpec' };

describe('Serialization', () => {
  it('should preserve ThreadId branded types', () => {
    const threadId = 'lace_20250801_abc123' as ThreadId;
    const serialized = serialize(threadId);
    const deserialized = deserialize<ThreadId>(serialized);

    expect(deserialized).toBe(threadId);
    expect(typeof deserialized).toBe('string');
  });

  it('should preserve NewAgentSpec branded types', () => {
    const agentSpec = 'agent-claude-3-5' as NewAgentSpec;
    const serialized = serialize(agentSpec);
    const deserialized = deserialize<NewAgentSpec>(serialized);

    expect(deserialized).toBe(agentSpec);
    expect(typeof deserialized).toBe('string');
  });

  it('should preserve Date objects', () => {
    const date = new Date('2025-08-01T12:00:00Z');
    const serialized = serialize(date);
    const deserialized = deserialize<Date>(serialized);

    expect(deserialized).toEqual(date);
    expect(deserialized instanceof Date).toBe(true);
  });

  it('should handle complex objects with multiple branded types', () => {
    const complexObject = {
      sessionId: 'lace_20250801_abc123' as ThreadId,
      assignedTo: 'agent-claude-3-5' as NewAgentSpec,
      createdAt: new Date('2025-08-01T12:00:00Z'),
      metadata: { key: 'value' },
    };

    const serialized = serialize(complexObject);
    const deserialized = deserialize<typeof complexObject>(serialized);

    expect(deserialized.sessionId).toBe(complexObject.sessionId);
    expect(deserialized.assignedTo).toBe(complexObject.assignedTo);
    expect(deserialized.createdAt).toEqual(complexObject.createdAt);
    expect(deserialized.createdAt instanceof Date).toBe(true);
    expect(deserialized.metadata).toEqual(complexObject.metadata);
  });
});
