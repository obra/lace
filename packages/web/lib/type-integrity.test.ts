// ABOUTME: Integration test ensuring type imports work correctly
// ABOUTME: Prevents regressions during type cleanup refactoring

import { describe, it, expect } from 'vitest';
import type { SessionInfo, AgentInfo } from '@lace/web/types/core';
import { createMockAgentInfo } from '@lace/web/__tests__/utils/agent-mocks';
import { testSessionId } from '@lace/web/test-utils/test-ids';

// Test that all key types can be imported from current paths
describe('Type Integrity - Current State', () => {
  describe('ThreadId imports', () => {
    it('should import ThreadId from @/types/core', async () => {
      const coreTypes = await import('@lace/web/types/core');
      expect(coreTypes.asThreadId).toBeDefined(); // asThreadId is a function, not ThreadId type

      // But we can test that the type exists by using it
      const testId = testSessionId(1);
      const threadIdTyped: string = testId; // ThreadId is just a string type
      expect(threadIdTyped).toBe(testId);
    });

    it('should import ThreadId from @/types/core', async () => {
      const { asThreadId, isThreadId } = await import('@lace/web/types/core');

      const testId = testSessionId(1);
      expect(isThreadId(testId)).toBe(true);

      const threadId = asThreadId(testId);
      expect(threadId).toBe(testId);
    });

    it('should import ThreadId from @/lib/validation/schemas', async () => {
      const { ThreadIdSchema } = await import('@lace/web/lib/validation/schemas');

      const testId = testSessionId(1);
      const result = ThreadIdSchema.safeParse(testId);
      expect(result.success).toBe(true);
    });

    it('should import ThreadId from @/types/core', async () => {
      const coreImports = await import('@lace/web/types/core');
      // ThreadId is a type export, so we test it exists in the import
      expect(coreImports).toBeDefined();
    });
  });

  describe('ApprovalDecision imports', () => {
    it('should import ApprovalDecision from @/types/core', async () => {
      const { ApprovalDecision } = await import('@lace/web/types/core');

      expect(ApprovalDecision.ALLOW_ONCE).toBe('allow_once');
      expect(ApprovalDecision.ALLOW_SESSION).toBe('allow_session');
      expect(ApprovalDecision.DENY).toBe('deny');
    });

    it('should import ApprovalDecision from @/types/core', async () => {
      const { ApprovalDecision } = await import('@lace/web/types/core');

      expect(ApprovalDecision.ALLOW_ONCE).toBe('allow_once');
      expect(ApprovalDecision.ALLOW_SESSION).toBe('allow_session');
      expect(ApprovalDecision.DENY).toBe('deny');
    });
  });

  describe('Core type functionality', () => {
    it('should validate ThreadId correctly', async () => {
      const { isValidThreadId } = await import('@lace/web/lib/validation/thread-id-validation');

      // Valid formats - only sess_<uuid> now
      expect(isValidThreadId('sess_123e4567-e89b-12d3-a456-426614174000')).toBe(true);

      // Invalid formats
      expect(isValidThreadId('')).toBe(false);
      expect(isValidThreadId('a..b')).toBe(false);
      expect(isValidThreadId('abc.')).toBe(false);
      expect(isValidThreadId('has space')).toBe(false);
      expect(isValidThreadId('550e8400-e29b-41d4-a716-446655440000')).toBe(false); // bare UUID no longer valid
    });

    it('should create SessionInfo types correctly', async () => {
      const { asWorkspaceSessionId } = await import('@lace/web/types/core');

      const sessionId = asWorkspaceSessionId('ws_00000000-0000-0000-0000-000000000080');
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
      const { asThreadId } = await import('@lace/web/types/core');

      // Test AgentInfo creation with proper ThreadId
      const agentThreadId = asThreadId('sess_123e4567-e89b-12d3-a456-426614174000');
      const agent: AgentInfo = createMockAgentInfo({
        threadId: agentThreadId,
        name: 'Test Agent',
        providerInstanceId: 'anthropic-instance-1',
        modelId: 'claude-3-sonnet',
        status: 'idle',
      });

      expect(agent.threadId).toBe(agentThreadId);
      expect(agent.name).toBe('Test Agent');
    });
  });

  describe('Type compatibility', () => {
    it('should have compatible ThreadId types across imports', async () => {
      const { asThreadId: asThreadIdCore } = await import('@lace/web/types/core');
      const { asValidThreadId } = await import('@lace/web/lib/validation/thread-id-validation');

      const testId = testSessionId(1);
      const coreThreadId = asThreadIdCore(testId);
      const validatedThreadId = asValidThreadId(testId);

      // These should be compatible (both resolve to strings)
      expect(coreThreadId).toBe(validatedThreadId);
    });

    it('should have compatible ApprovalDecision enums', async () => {
      const { ApprovalDecision: CoreApproval } = await import('@lace/web/types/core');
      const { ApprovalDecision: ServerApproval } = await import('@lace/web/types/core');

      // Values should be identical
      expect(CoreApproval.ALLOW_ONCE).toBe(ServerApproval.ALLOW_ONCE);
      expect(CoreApproval.ALLOW_SESSION).toBe(ServerApproval.ALLOW_SESSION);
      expect(CoreApproval.DENY).toBe(ServerApproval.DENY);
    });
  });

  describe('AppEvent type imports', () => {
    it('should import AppEvent type guards', async () => {
      const { isProtocolEvent, isWebEvent, isPermissionRequestEvent } = await import(
        '@lace/web/types/app-events'
      );

      expect(typeof isProtocolEvent).toBe('function');
      expect(typeof isWebEvent).toBe('function');
      expect(typeof isPermissionRequestEvent).toBe('function');
    });

    it('should import ThreadId utilities from core', async () => {
      const coreModule = await import('@lace/web/types/core');
      expect(coreModule.isThreadId).toBeDefined();
      expect(coreModule.asThreadId).toBeDefined();
    });
  });

  describe('Import resolution', () => {
    it('should resolve all current import paths without errors', async () => {
      // Test that all current import paths can be resolved
      const imports = [
        () => import('@lace/web/types/api'),
        () => import('@lace/web/types/core'),
        () => import('@lace/web/lib/validation/schemas'),
        () => import('@lace/web/lib/validation/thread-id-validation'),
      ];

      // All imports should resolve successfully
      const resolvedImports = await Promise.all(imports.map((importFn) => importFn()));
      expect(resolvedImports).toHaveLength(4);
      resolvedImports.forEach((module) => {
        expect(module).toBeDefined();
      });
    });
  });
});
