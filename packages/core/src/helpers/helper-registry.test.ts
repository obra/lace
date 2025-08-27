import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HelperRegistry } from './helper-registry';
import { InfrastructureHelper } from './infrastructure-helper';
import { SessionHelper } from './session-helper';
import { Agent } from '~/agents/agent';

// Mock modules
vi.mock('./infrastructure-helper');
vi.mock('./session-helper');

describe('HelperRegistry', () => {
  let registry: HelperRegistry;
  let mockAgent: Agent;

  beforeEach(() => {
    registry = new HelperRegistry();
    mockAgent = {} as Agent;
    vi.clearAllMocks();
  });

  describe('createInfrastructureHelper', () => {
    it('should create infrastructure helper and track it', () => {
      const options = {
        model: 'fast' as const,
        tools: ['test_tool']
      };

      const helper = registry.createInfrastructureHelper('test-id', options);

      expect(vi.mocked(InfrastructureHelper)).toHaveBeenCalledWith(options);
      expect(registry.getHelper('test-id')).toBe(helper);
      expect(registry.getActiveHelperIds()).toContain('test-id');
    });

    it('should throw if id already exists', () => {
      const options = {
        model: 'fast' as const,
        tools: ['test_tool']
      };

      registry.createInfrastructureHelper('test-id', options);

      expect(() => {
        registry.createInfrastructureHelper('test-id', options);
      }).toThrow('Helper with id "test-id" already exists');
    });
  });

  describe('createSessionHelper', () => {
    it('should create session helper and track it', () => {
      const options = {
        model: 'fast' as const,
        parentAgent: mockAgent
      };

      const helper = registry.createSessionHelper('session-1', options);

      expect(vi.mocked(SessionHelper)).toHaveBeenCalledWith(options);
      expect(registry.getHelper('session-1')).toBe(helper);
      expect(registry.getActiveHelperIds()).toContain('session-1');
    });

    it('should throw if id already exists', () => {
      const options = {
        model: 'fast' as const,
        parentAgent: mockAgent
      };

      registry.createSessionHelper('session-1', options);

      expect(() => {
        registry.createSessionHelper('session-1', options);
      }).toThrow('Helper with id "session-1" already exists');
    });
  });

  describe('helper management', () => {
    it('should remove helper when requested', () => {
      const helper = registry.createInfrastructureHelper('test-id', {
        model: 'fast',
        tools: []
      });

      expect(registry.getHelper('test-id')).toBe(helper);

      registry.removeHelper('test-id');

      expect(registry.getHelper('test-id')).toBeUndefined();
      expect(registry.getActiveHelperIds()).not.toContain('test-id');
    });

    it('should return undefined for non-existent helper', () => {
      expect(registry.getHelper('non-existent')).toBeUndefined();
    });

    it('should list all active helper ids', () => {
      registry.createInfrastructureHelper('infra-1', { model: 'fast', tools: [] });
      registry.createSessionHelper('session-1', { model: 'smart', parentAgent: mockAgent });
      registry.createInfrastructureHelper('infra-2', { model: 'smart', tools: ['tool1'] });

      const ids = registry.getActiveHelperIds();
      expect(ids).toEqual(['infra-1', 'session-1', 'infra-2']);
      expect(ids).toHaveLength(3);
    });

    it('should clear all helpers', () => {
      registry.createInfrastructureHelper('infra-1', { model: 'fast', tools: [] });
      registry.createSessionHelper('session-1', { model: 'smart', parentAgent: mockAgent });

      expect(registry.getActiveHelperIds()).toHaveLength(2);

      registry.clearAll();

      expect(registry.getActiveHelperIds()).toHaveLength(0);
      expect(registry.getHelper('infra-1')).toBeUndefined();
      expect(registry.getHelper('session-1')).toBeUndefined();
    });

    it('should count active helpers', () => {
      expect(registry.getActiveHelperCount()).toBe(0);

      registry.createInfrastructureHelper('infra-1', { model: 'fast', tools: [] });
      expect(registry.getActiveHelperCount()).toBe(1);

      registry.createSessionHelper('session-1', { model: 'smart', parentAgent: mockAgent });
      expect(registry.getActiveHelperCount()).toBe(2);

      registry.removeHelper('infra-1');
      expect(registry.getActiveHelperCount()).toBe(1);

      registry.clearAll();
      expect(registry.getActiveHelperCount()).toBe(0);
    });
  });

  describe('helper type tracking', () => {
    it('should track helper types correctly', () => {
      const infraHelper = registry.createInfrastructureHelper('infra-1', { 
        model: 'fast', 
        tools: [] 
      });
      const sessionHelper = registry.createSessionHelper('session-1', { 
        model: 'smart', 
        parentAgent: mockAgent 
      });

      expect(registry.getHelperType('infra-1')).toBe('infrastructure');
      expect(registry.getHelperType('session-1')).toBe('session');
      expect(registry.getHelperType('non-existent')).toBeUndefined();
    });

    it('should filter helpers by type', () => {
      registry.createInfrastructureHelper('infra-1', { model: 'fast', tools: [] });
      registry.createInfrastructureHelper('infra-2', { model: 'smart', tools: [] });
      registry.createSessionHelper('session-1', { model: 'fast', parentAgent: mockAgent });

      const infraIds = registry.getHelperIdsByType('infrastructure');
      expect(infraIds).toEqual(['infra-1', 'infra-2']);

      const sessionIds = registry.getHelperIdsByType('session');
      expect(sessionIds).toEqual(['session-1']);
    });
  });
});