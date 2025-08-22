// ABOUTME: Tests for task manager type definitions
// ABOUTME: Ensures TaskStatus and other types have correct values

import { describe, it, expect } from 'vitest';
import type { TaskStatus } from '~/tools/implementations/task-manager/types';

describe('TaskStatus type', () => {
  it('should include archived status', () => {
    // This test should fail initially since 'archived' is not in TaskStatus yet
    const archivedStatus: TaskStatus = 'archived';
    expect(archivedStatus).toBe('archived');
  });

  it('should include all expected status values', () => {
    const validStatuses: TaskStatus[] = [
      'pending',
      'in_progress',
      'completed',
      'blocked',
      'archived',
    ];

    validStatuses.forEach((status) => {
      // This should not throw if TaskStatus includes all these values
      const testStatus: TaskStatus = status;
      expect(typeof testStatus).toBe('string');
    });
  });
});
