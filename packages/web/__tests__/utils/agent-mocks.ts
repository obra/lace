// ABOUTME: Centralized mock factory for AgentInfo objects in tests
// ABOUTME: Provides consistent test data with DRY principle and override support

import type { AgentInfo, ThreadId } from '@/types/core';

/**
 * Create a mock AgentInfo object with sensible defaults
 * @param overrides Partial AgentInfo to override defaults
 * @returns Complete AgentInfo mock object
 */
export function createMockAgentInfo(overrides?: Partial<AgentInfo>): AgentInfo {
  return {
    threadId: 'lace_20250904_test01' as ThreadId,
    name: 'Test Agent',
    providerInstanceId: 'test-provider',
    modelId: 'test-model',
    status: 'idle',
    persona: 'lace',
    ...overrides,
  };
}
