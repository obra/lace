// ABOUTME: Test for hasFileBeenRead working directory bug
// ABOUTME: Reproduces issue where path resolution fails due to working directory mismatch

import { describe, it, expect } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import type { LaceEvent } from '~/threads/types';

describe('hasFileBeenRead working directory bug', () => {
  const _tempLaceDir = setupCoreTest();

  it('should fail due to working directory mismatch (reproduces bug)', () => {
    const threadManager = new ThreadManager();
    const toolExecutor = new ToolExecutor([], {});

    // Create agent with specific working directory (like web UI scenario)
    const agent = new Agent({
      toolExecutor,
      threadManager,
      threadId: 'test-thread',
      tools: [],
      metadata: {
        name: 'test-agent',
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
        workingDirectory: '/Users/jesse/git/projects/git-rebase-extract-file', // Real project dir
      },
    });

    // Mock events like what we see in the database - relative path used in TOOL_CALL
    const mockEvents: LaceEvent[] = [
      {
        id: 'event-1',
        type: 'TOOL_CALL',
        threadId: 'test-thread',
        timestamp: new Date(),
        data: {
          id: 'functions.file_read:26',
          name: 'file_read',
          arguments: { path: 'internal/rebase/rebase.go' }, // Relative path
        },
      },
      {
        id: 'event-2',
        type: 'TOOL_RESULT',
        threadId: 'test-thread',
        timestamp: new Date(),
        data: {
          id: 'functions.file_read:26',
          status: 'completed',
        },
      },
    ];

    // Mock ThreadManager.getEvents to return our test events
    threadManager.getEvents = () => mockEvents;

    // Test 1: Check with relative path (same as in TOOL_CALL)
    const relativePathResult = agent.hasFileBeenRead('internal/rebase/rebase.go');

    // Test 2: Check with absolute path (same as file_edit tool would use)
    const absolutePath =
      '/Users/jesse/git/projects/git-rebase-extract-file/internal/rebase/rebase.go';
    const absolutePathResult = agent.hasFileBeenRead(absolutePath);

    // This test demonstrates the bug:
    // - Relative path check works when using process.cwd()
    // - Absolute path check fails due to working directory mismatch
    expect(relativePathResult).toBe(true); // Works with current logic
    expect(absolutePathResult).toBe(false); // FAILS - this is the bug we need to fix
  });
});
