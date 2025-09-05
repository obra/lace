import { describe, it, expect } from 'vitest';
import { ApprovalDecision } from './approval-types';

describe('ApprovalTypes', () => {
  describe('ApprovalDecision', () => {
    it('should include all approval levels', () => {
      const expectedLevels = [
        'allow_once',
        'allow_session',
        'allow_project',
        'allow_always',
        'deny',
        'disable',
      ];

      const actualLevels = Object.values(ApprovalDecision);
      expectedLevels.forEach((level) => {
        expect(actualLevels).toContain(level);
      });
      expect(actualLevels).toHaveLength(6);
    });

    it('should have correct enum values', () => {
      expect(ApprovalDecision.ALLOW_ONCE).toBe('allow_once');
      expect(ApprovalDecision.ALLOW_SESSION).toBe('allow_session');
      expect(ApprovalDecision.ALLOW_PROJECT).toBe('allow_project');
      expect(ApprovalDecision.ALLOW_ALWAYS).toBe('allow_always');
      expect(ApprovalDecision.DENY).toBe('deny');
      expect(ApprovalDecision.DISABLE).toBe('disable');
    });
  });
});
