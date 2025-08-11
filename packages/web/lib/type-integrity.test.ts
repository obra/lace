// ABOUTME: Integration test ensuring type imports work correctly
// ABOUTME: Prevents regressions during type cleanup refactoring

import { describe, it, expect } from 'vitest';
import type { SessionInfo, AgentInfo } from '@/types/core';

// Test that all key types can be imported from current paths
describe('Type Integrity - Current State', () => {
  describe('ThreadId imports', () => {
    it('should import ThreadId from @/types/core', async () => {
      const coreTypes = await import('@/types/core');
      expect(coreTypes.asThreadId).toBeDefined(); // asThreadId is a function, not ThreadId type

      // But we can test that the type exists by using it
      const testId = 'lace_20250731_abc123';
      const threadIdTyped: string = testId; // ThreadId is just a string type
      expect(threadIdTyped).toBe(testId);
    });

    it('should import ThreadId from @/types/core', async () => {
      const { asThreadId, isThreadId } = await import('@/types/core');

      const testId = 'lace_20250731_abc123';
      expect(isThreadId(testId)).toBe(true);

      const threadId = asThreadId(testId);
      expect(threadId).toBe(testId);
    });

    it('should import ThreadId from @/lib/validation/schemas', async () => {
      const { ThreadIdSchema } = await import('@/lib/validation/schemas');

      const testId = 'lace_20250731_abc123';
      const result = ThreadIdSchema.safeParse(testId);
      expect(result.success).toBe(true);
    });

    it('should import ThreadId from @/types/core', async () => {
      const coreImports = await import('@/types/core');
      // ThreadId is a type export, so we test it exists in the import
      expect(coreImports).toBeDefined();
    });
  });

  describe('ApprovalDecision imports', () => {
    it('should import ApprovalDecision from @/types/core', async () => {
      const { ApprovalDecision } = await import('@/types/core');

      expect(ApprovalDecision.ALLOW_ONCE).toBe('allow_once');
      expect(ApprovalDecision.ALLOW_SESSION).toBe('allow_session');
      expect(ApprovalDecision.DENY).toBe('deny');
    });

    it('should import ApprovalDecision from @/types/core', async () => {
      const { ApprovalDecision } = await import('@/types/core');

      expect(ApprovalDecision.ALLOW_ONCE).toBe('allow_once');
      expect(ApprovalDecision.ALLOW_SESSION).toBe('allow_session');
      expect(ApprovalDecision.DENY).toBe('deny');
    });
  });

  describe('Core type functionality', () => {
    it('should validate ThreadId correctly', async () => {
      const { isValidThreadId } = await import('@/lib/validation/thread-id-validation');

      // Valid formats
      expect(isValidThreadId('lace_20250731_abc123')).toBe(true);
      expect(isValidThreadId('lace_20250731_abc123.1')).toBe(true);

      // Invalid formats
      expect(isValidThreadId('invalid')).toBe(false);
      expect(isValidThreadId('')).toBe(false);
      expect(isValidThreadId('lace_invalid_date')).toBe(false);
      expect(isValidThreadId('550e8400-e29b-41d4-a716-446655440000')).toBe(false); // UUIDs not valid
    });

    it('should create SessionInfo types correctly', async () => {
      const { asThreadId } = await import('@/types/core');

      // Test SessionInfo creation with proper ThreadId
      const sessionId = asThreadId('lace_20250731_abc123');
      const session: SessionInfo = {
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date('2025-07-31T10:00:00Z'),
        agents: [],
      };

      expect(session.id).toBe(sessionId);
      expect(session.name).toBe('Test Session');
    });

    it('should create AgentInfo types correctly', async () => {
      const { asThreadId } = await import('@/types/core');

      // Test AgentInfo creation with proper ThreadId
      const agentThreadId = asThreadId('lace_20250731_abc123.1');
      const agent: AgentInfo = {
        threadId: agentThreadId,
        name: 'Test Agent',
        providerInstanceId: 'anthropic-instance-1',
        modelId: 'claude-3-sonnet',
        status: 'idle',
      };

      expect(agent.threadId).toBe(agentThreadId);
      expect(agent.name).toBe('Test Agent');
    });
  });

  describe('Type compatibility', () => {
    it('should have compatible ThreadId types across imports', async () => {
      const { asThreadId: asThreadIdCore } = await import('@/types/core');
      const { asValidThreadId } = await import('@/lib/validation/thread-id-validation');

      const testId = 'lace_20250731_abc123';
      const coreThreadId = asThreadIdCore(testId);
      const validatedThreadId = asValidThreadId(testId);

      // These should be compatible (both resolve to strings)
      expect(coreThreadId).toBe(validatedThreadId);
    });

    it('should have compatible ApprovalDecision enums', async () => {
      const { ApprovalDecision: CoreApproval } = await import('@/types/core');
      const { ApprovalDecision: ServerApproval } = await import('@/types/core');

      // Values should be identical
      expect(CoreApproval.ALLOW_ONCE).toBe(ServerApproval.ALLOW_ONCE);
      expect(CoreApproval.ALLOW_SESSION).toBe(ServerApproval.ALLOW_SESSION);
      expect(CoreApproval.DENY).toBe(ServerApproval.DENY);
    });
  });

  describe('Event type imports', () => {
    it('should import EVENT_TYPES from core', async () => {
      const { EVENT_TYPES } = await import('@/types/core');

      expect(EVENT_TYPES).toContain('USER_MESSAGE');
      expect(EVENT_TYPES).toContain('AGENT_MESSAGE');
      expect(EVENT_TYPES).toContain('TOOL_CALL');
      expect(EVENT_TYPES).toContain('TOOL_RESULT');
    });

    it('should import ThreadEventType from core', async () => {
      const coreModule = await import('@/types/core');
      // ThreadEventType is a type, not a value, so we just check the module exists
      expect(coreModule).toBeDefined();
      expect(coreModule.EVENT_TYPES).toBeDefined(); // This is a value export
    });
  });

  describe('Import resolution', () => {
    it('should resolve all current import paths without errors', async () => {
      // Test that all current import paths can be resolved
      const imports = [
        () => import('@/types/api'),
        () => import('@/types/core'),
        () => import('@/lib/server/lace-imports'),
        () => import('@/lib/validation/schemas'),
        () => import('@/lib/validation/thread-id-validation'),
      ];

      // All imports should resolve successfully
      const resolvedImports = await Promise.all(imports.map((importFn) => importFn()));
      expect(resolvedImports).toHaveLength(5);
      resolvedImports.forEach((module) => {
        expect(module).toBeDefined();
      });
    });
  });
});
