// ABOUTME: Tests for JobManager class - the unified job management service
// Tests job state management, operations, and notifications

import { describe, it, expect, vi } from 'vitest';
import { JobManager } from '../job-manager';

describe('JobManager', () => {
  describe('construction', () => {
    it('initializes with empty state', () => {
      const deps = {
        getActiveSession: vi.fn().mockReturnValue(null),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };

      const manager = new JobManager(deps);

      expect(manager.listJobs()).toEqual([]);
      expect(manager.getStreamingMode()).toBe('full');
    });
  });
});
