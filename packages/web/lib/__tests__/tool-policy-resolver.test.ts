// ABOUTME: Unit tests for ToolPolicyResolver to verify progressive restriction logic
// ABOUTME: Tests policy hierarchy resolution, allowedValues computation, and validation without API complexity

import { describe, it, expect } from 'vitest';
import { ToolPolicyResolver } from '@/lib/tool-policy-resolver';

describe('ToolPolicyResolver', () => {
  describe('resolveSessionToolPolicies', () => {
    it('should resolve session tool policies with explicit parent values', () => {
      const tools = ['bash', 'file_read', 'filesystem/move_file'];
      const hierarchy = {
        project: {
          bash: 'allow' as const,
          file_read: 'ask' as const,
          'filesystem/move_file': 'deny' as const,
        },
        session: {
          bash: 'ask' as const, // Session overrides to ask (more restrictive)
        },
      };

      const result = ToolPolicyResolver.resolveSessionToolPolicies(tools, hierarchy);

      expect(result).toEqual({
        bash: {
          value: 'ask', // Session override
          allowedValues: ['allow', 'ask', 'deny', 'disable'], // Equal or more restrictive than project 'allow'
          projectValue: 'allow', // What project has set
        },
        file_read: {
          value: 'ask', // Inherited from project
          allowedValues: ['ask', 'deny', 'disable'], // Equal or more restrictive than project 'ask'
          projectValue: 'ask', // What project has set
        },
        'filesystem/move_file': {
          value: 'deny', // Inherited from project
          allowedValues: ['deny', 'disable'], // Equal or more restrictive than project 'deny'
          projectValue: 'deny', // What project has set
        },
      });
    });

    it('should handle tools with no project override (no restrictions)', () => {
      const tools = ['bash'];
      const hierarchy = {
        project: {}, // No project policies
        session: {},
      };

      const result = ToolPolicyResolver.resolveSessionToolPolicies(tools, hierarchy);

      expect(result).toEqual({
        bash: {
          value: 'ask', // Default policy
          allowedValues: ['allow', 'ask', 'deny', 'disable'], // All options available
          // No projectValue since project doesn't set policy
        },
      });
    });

    it('should ensure disable is always available even when parent is deny', () => {
      const tools = ['bash'];
      const hierarchy = {
        project: { bash: 'deny' as const },
        session: {},
      };

      const result = ToolPolicyResolver.resolveSessionToolPolicies(tools, hierarchy);

      expect(result.bash.allowedValues).toEqual(['deny', 'disable']);
      expect(result.bash.allowedValues).toContain('disable'); // Ultimate restriction always available
    });
  });

  describe('resolveProjectToolPolicies', () => {
    it('should resolve project tool policies with global parent values', () => {
      const tools = ['bash', 'file_read'];
      const hierarchy = {
        global: {
          bash: 'allow' as const,
          file_read: 'ask' as const,
        },
        project: {
          bash: 'ask' as const, // Project overrides to ask (more restrictive)
        },
      };

      const result = ToolPolicyResolver.resolveProjectToolPolicies(tools, hierarchy);

      expect(result).toEqual({
        bash: {
          value: 'ask', // Project override
          allowedValues: ['allow', 'ask', 'deny', 'disable'], // Equal or more restrictive than global 'allow'
          globalValue: 'allow', // What global has set
        },
        file_read: {
          value: 'ask', // Inherited from global
          allowedValues: ['ask', 'deny', 'disable'], // Equal or more restrictive than global 'ask'
          globalValue: 'ask', // What global has set
        },
      });
    });
  });

  describe('resolveGlobalToolPolicies', () => {
    it('should resolve global tool policies with full permissions', () => {
      const tools = ['bash', 'file_read'];
      const policies = {
        bash: 'allow' as const,
        file_read: 'deny' as const,
      };

      const result = ToolPolicyResolver.resolveGlobalToolPolicies(tools, policies);

      expect(result).toEqual({
        bash: {
          value: 'allow',
          allowedValues: ['allow', 'ask', 'deny', 'disable'], // All options at global level
        },
        file_read: {
          value: 'deny',
          allowedValues: ['allow', 'ask', 'deny', 'disable'], // All options at global level
        },
      });
    });

    it('should use default policy when tool not configured', () => {
      const tools = ['bash'];
      const policies = {}; // No policies set

      const result = ToolPolicyResolver.resolveGlobalToolPolicies(tools, policies);

      expect(result.bash).toEqual({
        value: 'ask', // Default policy
        allowedValues: ['allow', 'ask', 'deny', 'disable'], // All options available
      });
    });
  });

  describe('isValidPolicyChange', () => {
    it('should validate policy changes against progressive restriction', () => {
      // Parent is 'allow' - child can be equal or more restrictive
      expect(ToolPolicyResolver.isValidPolicyChange('bash', 'allow', 'allow')).toBe(true);
      expect(ToolPolicyResolver.isValidPolicyChange('bash', 'ask', 'allow')).toBe(true);
      expect(ToolPolicyResolver.isValidPolicyChange('bash', 'deny', 'allow')).toBe(true);
      expect(ToolPolicyResolver.isValidPolicyChange('bash', 'disable', 'allow')).toBe(true);

      // Parent is 'deny' - child can only be deny or disable
      expect(ToolPolicyResolver.isValidPolicyChange('bash', 'allow', 'deny')).toBe(false);
      expect(ToolPolicyResolver.isValidPolicyChange('bash', 'ask', 'deny')).toBe(false);
      expect(ToolPolicyResolver.isValidPolicyChange('bash', 'deny', 'deny')).toBe(true);
      expect(ToolPolicyResolver.isValidPolicyChange('bash', 'disable', 'deny')).toBe(true);
    });

    it('should allow all policies when no parent restriction', () => {
      expect(ToolPolicyResolver.isValidPolicyChange('bash', 'allow')).toBe(true);
      expect(ToolPolicyResolver.isValidPolicyChange('bash', 'ask')).toBe(true);
      expect(ToolPolicyResolver.isValidPolicyChange('bash', 'deny')).toBe(true);
      expect(ToolPolicyResolver.isValidPolicyChange('bash', 'disable')).toBe(true);
    });
  });
});
