// ABOUTME: Unit tests for HelperFactory creating InfrastructureHelper and SessionHelper
// ABOUTME: Tests type safety, parameter validation, and proper constructor calls
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HelperFactory } from './helper-factory';
import { InfrastructureHelper } from './infrastructure-helper';
import { SessionHelper } from './session-helper';
import type { Agent } from '~/agents/agent';

// Mock modules
vi.mock('./infrastructure-helper', () => ({
  InfrastructureHelper: vi.fn(),
}));
vi.mock('./session-helper', () => ({
  SessionHelper: vi.fn(),
}));

describe('HelperFactory', () => {
  let mockAgent: Agent;

  beforeEach(() => {
    const agentPartial: Partial<Agent> = {};
    mockAgent = agentPartial as Agent;
    vi.clearAllMocks();
  });

  describe('createInfrastructureHelper', () => {
    it('should create infrastructure helper with required options', () => {
      const options = {
        model: 'fast' as const,
        tools: ['test_tool']
      };

      HelperFactory.createInfrastructureHelper(options);

      expect(vi.mocked(InfrastructureHelper)).toHaveBeenCalledWith(options);
    });

    it('should create infrastructure helper with optional context', () => {
      const options = {
        model: 'smart' as const,
        tools: ['test_tool', 'another_tool'],
        workingDirectory: '/test/dir',
        processEnv: { TEST: 'value' },
        abortSignal: new AbortController().signal
      };

      HelperFactory.createInfrastructureHelper(options);

      expect(vi.mocked(InfrastructureHelper)).toHaveBeenCalledWith(options);
    });
  });

  describe('createSessionHelper', () => {
    it('should create session helper with required options', () => {
      const options = {
        model: 'fast' as const,
        parentAgent: mockAgent
      };

      HelperFactory.createSessionHelper(options);

      expect(vi.mocked(SessionHelper)).toHaveBeenCalledWith(options);
    });

    it('should create session helper with abort signal', () => {
      const options = {
        model: 'smart' as const,
        parentAgent: mockAgent,
        abortSignal: new AbortController().signal
      };

      HelperFactory.createSessionHelper(options);

      expect(vi.mocked(SessionHelper)).toHaveBeenCalledWith(options);
    });
  });

  describe('type safety', () => {
    it('should enforce valid model tiers', () => {
      // These should compile and create helpers
      const fastHelper = HelperFactory.createInfrastructureHelper({
        model: 'fast',
        tools: []
      });
      expect(fastHelper).toBeInstanceOf(InfrastructureHelper);

      const smartHelper = HelperFactory.createInfrastructureHelper({
        model: 'smart',
        tools: []
      });
      expect(smartHelper).toBeInstanceOf(InfrastructureHelper);
    });

    it('should require tools array for infrastructure helpers', () => {
      // This should compile and create helper with tools
      const helper = HelperFactory.createInfrastructureHelper({
        model: 'fast',
        tools: ['tool1', 'tool2']
      });
      expect(helper).toBeInstanceOf(InfrastructureHelper);
    });

    it('should require parent agent for session helpers', () => {
      // This should compile and create helper with parent agent
      const helper = HelperFactory.createSessionHelper({
        model: 'fast',
        parentAgent: mockAgent
      });
      expect(helper).toBeInstanceOf(SessionHelper);
    });
  });
});