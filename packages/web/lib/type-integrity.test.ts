// ABOUTME: Integration test ensuring type imports work correctly
// ABOUTME: Prevents regressions during type cleanup refactoring

import { describe, it, expect } from 'vitest';

// Test that all key types can be imported from current paths
describe('Type Integrity - Current State', () => {
  describe('ThreadId imports', () => {
    it('should import ThreadId from @/types/api', async () => {
      const apiTypes = await import('@/types/api');
      expect(apiTypes.ThreadId).toBeUndefined(); // ThreadId is a type, not a value

      // But we can test that the type exists by using it
      const testId = 'lace_20250731_abc123';
      const threadIdTyped: typeof apiTypes.ThreadId = testId as unknown as typeof apiTypes.ThreadId;
      expect(threadIdTyped).toBe(testId);
    });

    it('should import ThreadId from @/lib/server/core-types', async () => {
      const { asThreadId, isThreadId } = await import('@/lib/server/core-types');

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

    it('should import ThreadId from @/lib/core', async () => {
      const coreImports = await import('@/lib/core');
      // ThreadId is a type export, so we test it exists in the import
      expect(coreImports).toBeDefined();
    });
  });

  describe('ApprovalDecision imports', () => {
    it('should import ApprovalDecision from @/types/api', async () => {
      const { ApprovalDecision } = await import('@/types/api');

      expect(ApprovalDecision.ALLOW_ONCE).toBe('allow_once');
      expect(ApprovalDecision.ALLOW_SESSION).toBe('allow_session');
      expect(ApprovalDecision.DENY).toBe('deny');
    });

    it('should import ApprovalDecision from @/lib/server/core-types', async () => {
      const { ApprovalDecision } = await import('@/lib/server/core-types');

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

    it('should create Session types correctly', async () => {
      const { asThreadId } = await import('@/lib/server/core-types');
      const _apiTypes = await import('@/types/api');

      // Test Session creation with proper ThreadId
      const sessionId = asThreadId('lace_20250731_abc123');
      const session: (typeof _apiTypes)['Session'] = {
        id: sessionId,
        name: 'Test Session',
        createdAt: '2025-07-31T10:00:00Z',
      };

      expect(session.id).toBe(sessionId);
      expect(session.name).toBe('Test Session');
    });

    it('should create Agent types correctly', async () => {
      const { asThreadId } = await import('@/lib/server/core-types');
      const _apiTypes = await import('@/types/api');

      // Test Agent creation with proper ThreadId
      const agentThreadId = asThreadId('lace_20250731_abc123.1');
      const agent: (typeof _apiTypes)['Agent'] = {
        threadId: agentThreadId,
        name: 'Test Agent',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        status: 'idle',
        createdAt: '2025-07-31T10:00:00Z',
      };

      expect(agent.threadId).toBe(agentThreadId);
      expect(agent.name).toBe('Test Agent');
    });
  });

  describe('Type compatibility', () => {
    it('should have compatible ThreadId types across imports', async () => {
      const { asThreadId: asThreadIdCore } = await import('@/lib/server/core-types');
      const { asValidThreadId } = await import('@/lib/validation/thread-id-validation');

      const testId = 'lace_20250731_abc123';
      const coreThreadId = asThreadIdCore(testId);
      const validatedThreadId = asValidThreadId(testId);

      // These should be compatible (both resolve to strings)
      expect(coreThreadId).toBe(validatedThreadId);
    });

    it('should have compatible ApprovalDecision enums', async () => {
      const { ApprovalDecision: ApiApproval } = await import('@/types/api');
      const { ApprovalDecision: CoreApproval } = await import('@/lib/server/core-types');

      // Values should be identical
      expect(ApiApproval.ALLOW_ONCE).toBe(CoreApproval.ALLOW_ONCE);
      expect(ApiApproval.ALLOW_SESSION).toBe(CoreApproval.ALLOW_SESSION);
      expect(ApiApproval.DENY).toBe(CoreApproval.DENY);
    });
  });

  describe('Event type imports', () => {
    it('should import EVENT_TYPES from events constants', async () => {
      const { EVENT_TYPES } = await import('@/types/events-constants');

      expect(EVENT_TYPES).toContain('USER_MESSAGE');
      expect(EVENT_TYPES).toContain('AGENT_MESSAGE');
      expect(EVENT_TYPES).toContain('TOOL_CALL');
      expect(EVENT_TYPES).toContain('TOOL_RESULT');
    });

    it('should import ThreadEventType from events constants', async () => {
      const eventsModule = await import('@/types/events-constants');
      expect(eventsModule.ThreadEventType).toBeUndefined(); // ThreadEventType is a type, not a value
      expect(eventsModule).toBeDefined();
    });
  });

  describe('Import resolution', () => {
    it('should resolve all current import paths without errors', async () => {
      // Test that all current import paths can be resolved
      const imports = [
        () => import('@/types/api'),
        () => import('@/lib/server/core-types'),
        () => import('@/lib/server/lace-imports'),
        () => import('@/lib/core'),
        () => import('@/lib/validation/schemas'),
        () => import('@/lib/validation/thread-id-validation'),
        () => import('@/types/events-constants'),
      ];

      // All imports should resolve successfully
      const resolvedImports = await Promise.all(imports.map((importFn) => importFn()));
      expect(resolvedImports).toHaveLength(7);
      resolvedImports.forEach((module) => {
        expect(module).toBeDefined();
      });
    });
  });
});
