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

/**
 * Create multiple mock agents with sequential thread IDs
 * @param count Number of agents to create
 * @param baseOverrides Base overrides applied to all agents
 * @returns Array of AgentInfo mock objects
 */
function createMockAgents(count: number, baseOverrides?: Partial<AgentInfo>): AgentInfo[] {
  return Array.from({ length: count }, (_, index) =>
    createMockAgentInfo({
      threadId: `lace_20250904_test${String(index + 1).padStart(2, '0')}` as ThreadId,
      name: `Test Agent ${index + 1}`,
      ...baseOverrides,
    })
  );
}

/**
 * Common agent personas for testing
 */
const MOCK_PERSONAS = {
  lace: createMockAgentInfo({ persona: 'lace' }),
  codingAgent: createMockAgentInfo({
    persona: 'coding-agent',
    name: 'Coding Agent',
    threadId: 'lace_20250904_coding' as ThreadId,
  }),
  helperAgent: createMockAgentInfo({
    persona: 'helper-agent',
    name: 'Helper Agent',
    threadId: 'lace_20250904_helper' as ThreadId,
  }),
  sessionSummary: createMockAgentInfo({
    persona: 'session-summary',
    name: 'Summary Agent',
    threadId: 'lace_20250904_summary' as ThreadId,
  }),
} as const;
