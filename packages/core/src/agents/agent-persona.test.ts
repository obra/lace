import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent, AgentConfig } from './agent';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';

// Mock dependencies
const createMockToolExecutor = (): ToolExecutor =>
  ({
    execute: vi.fn(),
    getAvailableTools: vi.fn().mockReturnValue([]),
  }) as unknown as ToolExecutor;

const createMockThreadManager = (): ThreadManager =>
  ({
    addEvent: vi.fn(),
    getThread: vi.fn(),
  }) as unknown as ThreadManager;

describe('Agent Personas', () => {
  let baseConfig: AgentConfig;

  beforeEach(() => {
    const validThreadId = 'lace_20250904_test01';
    baseConfig = {
      toolExecutor: createMockToolExecutor(),
      threadManager: createMockThreadManager(),
      threadId: validThreadId,
      tools: [],
    };
  });

  it('defaults to lace persona when none specified', () => {
    const agent = new Agent(baseConfig);

    expect(agent.getInfo().persona).toBe('lace');
  });

  it('uses specified persona from config', () => {
    const config = { ...baseConfig, persona: 'coding-agent' };
    const agent = new Agent(config);

    expect(agent.getInfo().persona).toBe('coding-agent');
  });

  it('includes persona in agent info', () => {
    const config = { ...baseConfig, persona: 'helper-agent' };
    const agent = new Agent(config);

    const info = agent.getInfo();
    expect(info).toHaveProperty('persona');
    expect(info.persona).toBe('helper-agent');
  });

  it('supports different persona types', () => {
    const personas = ['lace', 'coding-agent', 'helper-agent', 'custom-persona'];

    for (const persona of personas) {
      const config = { ...baseConfig, persona };
      const agent = new Agent(config);

      expect(agent.getInfo().persona).toBe(persona);
    }
  });

  it('persona field is included in AgentInfo type', () => {
    const config = { ...baseConfig, persona: 'test-persona' };
    const agent = new Agent(config);

    const info = agent.getInfo();

    // Verify all expected AgentInfo fields are present
    expect(info).toHaveProperty('threadId');
    expect(info).toHaveProperty('name');
    expect(info).toHaveProperty('providerInstanceId');
    expect(info).toHaveProperty('modelId');
    expect(info).toHaveProperty('status');
    expect(info).toHaveProperty('persona');

    // Verify persona is correctly typed as string
    const personaValue: string = info.persona;
    expect(typeof personaValue).toBe('string');
  });

  it('getInfo returns consistent persona value', () => {
    const config = { ...baseConfig, persona: 'consistent-persona' };
    const agent = new Agent(config);

    // Call getInfo multiple times
    const info1 = agent.getInfo();
    const info2 = agent.getInfo();
    const info3 = agent.getInfo();

    expect(info1.persona).toBe('consistent-persona');
    expect(info2.persona).toBe('consistent-persona');
    expect(info3.persona).toBe('consistent-persona');
    expect(info1.persona).toBe(info2.persona);
    expect(info2.persona).toBe(info3.persona);
  });

  it('handles undefined persona in config', () => {
    const config = { ...baseConfig, persona: undefined };
    const agent = new Agent(config);

    // Should default to 'lace' when persona is explicitly undefined
    expect(agent.getInfo().persona).toBe('lace');
  });

  it('handles empty string persona', () => {
    const config = { ...baseConfig, persona: '' };
    const agent = new Agent(config);

    // Empty string should be treated as falsy and default to 'lace'
    expect(agent.getInfo().persona).toBe('lace');
  });
});
