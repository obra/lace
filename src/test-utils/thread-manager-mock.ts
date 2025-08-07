// ABOUTME: Shared mock ThreadManager for agent tests
// ABOUTME: Provides complete mock with all required methods and proper ThreadId handling

import { vi } from 'vitest';
import { ThreadManager } from '~/threads/thread-manager';
import { createThreadId } from '~/threads/types';

export function createMockThreadManager(threadId?: string) {
  const testThreadId = threadId ? createThreadId(threadId) : createThreadId('lace_20250723_abc123');

  return {
    addEvent: vi.fn(),
    getEvents: vi.fn().mockReturnValue([]),
    getThread: vi.fn().mockReturnValue({
      id: testThreadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
      metadata: {},
    }),
    saveThread: vi.fn().mockResolvedValue(undefined),
    getSessionInfo: vi.fn().mockReturnValue({
      threadId: testThreadId,
      model: 'test-model',
      provider: 'test-provider',
    }),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as ThreadManager;
}
