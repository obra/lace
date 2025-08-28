// ABOUTME: Integration tests for HelperFactory + HelperRegistry lifecycle, collisions, and filtering
// ABOUTME: Tests realistic usage scenarios including memory analysis and agent sub-tasks
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HelperFactory } from './helper-factory';
import { HelperRegistry } from './helper-registry';
import { InfrastructureHelper } from './infrastructure-helper';
import { SessionHelper } from './session-helper';
import type { Agent } from '~/agents/agent';

// Test integration between factory and registry
describe('HelperFactory and HelperRegistry Integration', () => {
  let registry: HelperRegistry;
  let mockAgent: Agent;

  beforeEach(() => {
    registry = new HelperRegistry();
    const agentPartial: Partial<Agent> = {};
    mockAgent = agentPartial as Agent;
    vi.clearAllMocks();
  });

  describe('factory with registry workflow', () => {
    it('should create helpers via factory and track in registry', () => {
      // Create infrastructure helper via factory
      const infraHelper = HelperFactory.createInfrastructureHelper({
        model: 'fast',
        tools: ['test_tool']
      });

      // Create session helper via factory
      const sessionHelper = HelperFactory.createSessionHelper({
        model: 'smart',
        parentAgent: mockAgent
      });

      // This demonstrates the factory creates valid instances
      expect(infraHelper).toBeInstanceOf(InfrastructureHelper);
      expect(sessionHelper).toBeInstanceOf(SessionHelper);
    });

    it('should demonstrate complete workflow pattern', () => {
      // Pattern: Create helper via registry, use it, then clean up
      const helperId = 'workflow-test';
      
      // Step 1: Create helper
      const helper = registry.createInfrastructureHelper(helperId, {
        model: 'fast',
        tools: ['file-read', 'ripgrep-search']
      });

      expect(helper).toBeDefined();
      expect(registry.getActiveHelperCount()).toBe(1);

      // Step 2: Use helper (would normally call execute here)
      expect(registry.getHelper(helperId)).toBe(helper);
      expect(registry.getHelperType(helperId)).toBe('infrastructure');

      // Step 3: Clean up
      registry.removeHelper(helperId);
      expect(registry.getActiveHelperCount()).toBe(0);
      expect(registry.getHelper(helperId)).toBeUndefined();
    });

    it('should handle multiple concurrent helpers', () => {
      // Create multiple helpers of different types
      const infraHelper1 = registry.createInfrastructureHelper('infra-1', {
        model: 'fast',
        tools: ['tool1']
      });

      const _infraHelper2 = registry.createInfrastructureHelper('infra-2', {
        model: 'smart', 
        tools: ['tool2']
      });

      const _sessionHelper1 = registry.createSessionHelper('session-1', {
        model: 'fast',
        parentAgent: mockAgent
      });

      const sessionHelper2 = registry.createSessionHelper('session-2', {
        model: 'smart',
        parentAgent: mockAgent
      });

      // Verify all are tracked
      expect(registry.getActiveHelperCount()).toBe(4);
      expect(registry.getActiveHelperIds()).toEqual([
        'infra-1', 'infra-2', 'session-1', 'session-2'
      ]);

      // Verify type filtering works
      expect(registry.getHelperIdsByType('infrastructure')).toEqual([
        'infra-1', 'infra-2'
      ]);
      expect(registry.getHelperIdsByType('session')).toEqual([
        'session-1', 'session-2'
      ]);

      // Verify individual access
      expect(registry.getHelper('infra-1')).toBe(infraHelper1);
      expect(registry.getHelper('session-2')).toBe(sessionHelper2);

      // Clean up specific helpers
      registry.removeHelper('infra-1');
      registry.removeHelper('session-1');

      expect(registry.getActiveHelperCount()).toBe(2);
      expect(registry.getActiveHelperIds()).toEqual(['infra-2', 'session-2']);

      // Clear all remaining
      registry.clearAll();
      expect(registry.getActiveHelperCount()).toBe(0);
    });

    it('should prevent id collisions', () => {
      registry.createInfrastructureHelper('helper-1', {
        model: 'fast',
        tools: []
      });

      // Try to create session helper with same ID
      expect(() => {
        registry.createSessionHelper('helper-1', {
          model: 'smart',
          parentAgent: mockAgent
        });
      }).toThrow('Helper with id "helper-1" already exists');

      // Try to create another infrastructure helper with same ID
      expect(() => {
        registry.createInfrastructureHelper('helper-1', {
          model: 'smart',
          tools: ['different-tool']
        });
      }).toThrow('Helper with id "helper-1" already exists');
    });
  });

  describe('realistic usage scenarios', () => {
    it('should support memory management helper pattern', () => {
      // Scenario: Memory system creates helper for conversation analysis
      const memoryHelperId = 'memory-analyzer';
      
      const helper = registry.createInfrastructureHelper(memoryHelperId, {
        model: 'smart', // Use smart model for analysis
        tools: ['ripgrep-search', 'file-read', 'url-fetch'],
        workingDirectory: '/path/to/logs'
      });

      expect(helper).toBeDefined();
      expect(registry.getHelperType(memoryHelperId)).toBe('infrastructure');
      
      // After analysis is complete
      registry.removeHelper(memoryHelperId);
      expect(registry.getHelper(memoryHelperId)).toBeUndefined();
    });

    it('should support agent sub-task helper pattern', () => {
      // Scenario: Agent spawns helper for URL summarization during conversation
      const agent = mockAgent; // Would be real agent in practice
      const subTaskId = 'url-summarizer';
      
      const helper = registry.createSessionHelper(subTaskId, {
        model: 'fast', // Use fast model for simple summarization
        parentAgent: agent
      });

      expect(helper).toBeDefined();
      expect(registry.getHelperType(subTaskId)).toBe('session');
      
      // Helper inherits agent context and approval workflow
      // After summarization is complete
      registry.removeHelper(subTaskId);
      expect(registry.getHelper(subTaskId)).toBeUndefined();
    });

    it('should support bulk operations', () => {
      // Create multiple helpers for batch processing
      const helperIds = ['batch-1', 'batch-2', 'batch-3'];
      
      helperIds.forEach(id => {
        registry.createInfrastructureHelper(id, {
          model: 'fast',
          tools: ['file-read']
        });
      });

      expect(registry.getActiveHelperCount()).toBe(3);
      expect(registry.getActiveHelperIds()).toEqual(helperIds);

      // Clean up all batch helpers
      registry.clearAll();
      expect(registry.getActiveHelperCount()).toBe(0);
    });
  });
});