// ABOUTME: Test for hasFileBeenRead working directory bug and file_write tracking
// ABOUTME: Reproduces issue where path resolution fails due to working directory mismatch
// ABOUTME: Tests that file_write marks files as known

import { describe, it, expect } from 'vitest';
import { Agent } from './agent';
import { ThreadManager } from '@lace/core/threads/thread-manager';
import { ToolExecutor } from '@lace/core/tools/executor';
import { setupCoreTest } from '@lace/core/test-utils/core-test-setup';
import type { LaceEvent } from '@lace/core/threads/types';

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

    // With the fix, when no working directory is available (test context):
    // - Both checks should fail safely rather than using wrong directory
    // - This is correct behavior - prevents false positives from process.cwd()
    expect(relativePathResult).toBe(false); // Fails safely without working directory
    expect(absolutePathResult).toBe(false); // Fails safely without working directory
  });

  it('should recognize files written with file_write as known', () => {
    const threadManager = new ThreadManager();
    const toolExecutor = new ToolExecutor([], {});

    const agent = new Agent({
      toolExecutor,
      threadManager,
      threadId: 'test-thread',
      tools: [],
      metadata: {
        name: 'test-agent',
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
        workingDirectory: '/Users/jesse/git/projects/test-project',
      },
    });

    // Mock events showing a file_write operation
    const mockEvents: LaceEvent[] = [
      {
        id: 'event-1',
        type: 'TOOL_CALL',
        threadId: 'test-thread',
        timestamp: new Date(),
        data: {
          id: 'functions.file_write:1',
          name: 'file_write',
          arguments: { path: 'Tests/NewTests.swift', content: 'test content' },
        },
      },
      {
        id: 'event-2',
        type: 'TOOL_RESULT',
        threadId: 'test-thread',
        timestamp: new Date(),
        data: {
          id: 'functions.file_write:1',
          status: 'completed',
        },
      },
    ];

    threadManager.getEvents = () => mockEvents;

    // Mock _getWorkingDirectory to return the test working directory
    (agent as any)._getWorkingDirectory = () => '/Users/jesse/git/projects/test-project';

    // After writing a file, hasFileBeenRead should return true
    const result = agent.hasFileBeenRead('Tests/NewTests.swift');
    expect(result).toBe(true);
  });

  it('should recognize files written with file_write using absolute paths', () => {
    const threadManager = new ThreadManager();
    const toolExecutor = new ToolExecutor([], {});

    const agent = new Agent({
      toolExecutor,
      threadManager,
      threadId: 'test-thread',
      tools: [],
      metadata: {
        name: 'test-agent',
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
        workingDirectory: '/Users/jesse/git/projects/test-project',
      },
    });

    // Mock events showing a file_write with relative path
    const mockEvents: LaceEvent[] = [
      {
        id: 'event-1',
        type: 'TOOL_CALL',
        threadId: 'test-thread',
        timestamp: new Date(),
        data: {
          id: 'functions.file_write:1',
          name: 'file_write',
          arguments: { path: 'src/main.go', content: 'package main' },
        },
      },
      {
        id: 'event-2',
        type: 'TOOL_RESULT',
        threadId: 'test-thread',
        timestamp: new Date(),
        data: {
          id: 'functions.file_write:1',
          status: 'completed',
        },
      },
    ];

    threadManager.getEvents = () => mockEvents;

    // Mock _getWorkingDirectory to return the test working directory
    (agent as any)._getWorkingDirectory = () => '/Users/jesse/git/projects/test-project';

    // Check with absolute path - should normalize and match
    const absolutePath = '/Users/jesse/git/projects/test-project/src/main.go';
    const result = agent.hasFileBeenRead(absolutePath);
    expect(result).toBe(true);
  });

  it('should not recognize files from failed file_write operations', () => {
    const threadManager = new ThreadManager();
    const toolExecutor = new ToolExecutor([], {});

    const agent = new Agent({
      toolExecutor,
      threadManager,
      threadId: 'test-thread',
      tools: [],
      metadata: {
        name: 'test-agent',
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
        workingDirectory: '/Users/jesse/git/projects/test-project',
      },
    });

    // Mock events showing a failed file_write
    const mockEvents: LaceEvent[] = [
      {
        id: 'event-1',
        type: 'TOOL_CALL',
        threadId: 'test-thread',
        timestamp: new Date(),
        data: {
          id: 'functions.file_write:1',
          name: 'file_write',
          arguments: { path: 'protected/file.txt', content: 'test' },
        },
      },
      {
        id: 'event-2',
        type: 'TOOL_RESULT',
        threadId: 'test-thread',
        timestamp: new Date(),
        data: {
          id: 'functions.file_write:1',
          status: 'failed',
        },
      },
    ];

    threadManager.getEvents = () => mockEvents;

    // Mock _getWorkingDirectory to return the test working directory
    (agent as any)._getWorkingDirectory = () => '/Users/jesse/git/projects/test-project';

    // Failed writes should not mark file as known
    const result = agent.hasFileBeenRead('protected/file.txt');
    expect(result).toBe(false);
  });
});
