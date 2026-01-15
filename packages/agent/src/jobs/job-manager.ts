// ABOUTME: Unified job management - state, operations, and notifications
// Consolidates scattered job code into single session-scoped service

import type { JobState, JobStatus, JobType, PendingJobNotification } from '../server-types';

export type JobManagerDeps = {
  getActiveSession: () => { sessionId: string; dir: string } | null;
  persistEvent: (event: { type: string; data: Record<string, unknown> }) => Promise<void>;
  emitUpdate: (update: { type: string; [key: string]: unknown }) => Promise<void>;
};

export class JobManager {
  private jobs = new Map<string, JobState>();
  private streamingMode: 'full' | 'coalesced' | 'none' = 'full';
  private notificationQueue: PendingJobNotification[] = [];
  private deps: JobManagerDeps;

  constructor(deps: JobManagerDeps) {
    this.deps = deps;
  }

  listJobs(): Array<{
    jobId: string;
    type: JobType;
    status: JobStatus;
    description?: string;
  }> {
    return [];
  }

  getStreamingMode(): 'full' | 'coalesced' | 'none' {
    return this.streamingMode;
  }
}
