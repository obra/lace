import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HelperFactory } from './helper-factory';
import { InfrastructureHelper } from './infrastructure-helper';
import { SessionHelper } from './session-helper';
import { Agent } from '~/agents/agent';

// Mock modules
vi.mock('./infrastructure-helper');
vi.mock('./session-helper');

describe('HelperFactory', () => {
  let mockAgent: Agent;

  beforeEach(() => {
    mockAgent = {} as Agent;
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
      // These should compile
      HelperFactory.createInfrastructureHelper({
        model: 'fast',
        tools: []
      });

      HelperFactory.createInfrastructureHelper({
        model: 'smart',
        tools: []
      });

      // Invalid model would cause TypeScript error
      // HelperFactory.createInfrastructureHelper({
      //   model: 'invalid',  // TypeScript error
      //   tools: []
      // });
    });

    it('should require tools array for infrastructure helpers', () => {
      // This should compile
      HelperFactory.createInfrastructureHelper({
        model: 'fast',
        tools: ['tool1', 'tool2']
      });

      // Missing tools would cause TypeScript error
      // HelperFactory.createInfrastructureHelper({
      //   model: 'fast'  // TypeScript error - missing tools
      // });
    });

    it('should require parent agent for session helpers', () => {
      // This should compile
      HelperFactory.createSessionHelper({
        model: 'fast',
        parentAgent: mockAgent
      });

      // Missing parent agent would cause TypeScript error
      // HelperFactory.createSessionHelper({
      //   model: 'fast'  // TypeScript error - missing parentAgent
      // });
    });
  });
});