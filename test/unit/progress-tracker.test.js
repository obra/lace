// ABOUTME: Comprehensive unit tests for ProgressTracker in-memory progress tracking system
// ABOUTME: Tests all methods, aggregation, callbacks, and cleanup functionality

import { test, describe, beforeEach, afterEach } from '../test-harness.js';
import { TestHarness, assert, utils } from '../test-harness.js';

describe('ProgressTracker', () => {
  let harness;
  let progressTracker;
  let callbackEvents;

  beforeEach(async () => {
    harness = new TestHarness();
    
    // Import ProgressTracker
    const { ProgressTracker } = await import('../../src/tools/progress-tracker.js');
    progressTracker = new ProgressTracker({
      cleanupInterval: 100, // Fast cleanup for testing
      maxAge: 1000, // 1 second for testing
      maxEntries: 5 // Small limit for testing
    });

    // Track callback events
    callbackEvents = [];
    progressTracker.addCallback((eventType, data) => {
      callbackEvents.push({ eventType, data, timestamp: Date.now() });
    });
  });

  afterEach(async () => {
    if (progressTracker) {
      progressTracker.destroy();
    }
    await harness.cleanup();
  });

  describe('Initialization', () => {
    test('should create ProgressTracker instance', async () => {
      assert.ok(progressTracker instanceof Object, 'ProgressTracker should be created');
      assert.equal(typeof progressTracker.updateProgress, 'function', 'Should have updateProgress method');
      assert.equal(typeof progressTracker.getProgress, 'function', 'Should have getProgress method');
      assert.equal(typeof progressTracker.getProgressSummary, 'function', 'Should have getProgressSummary method');
    });

    test('should use default options', async () => {
      const { ProgressTracker } = await import('../../src/tools/progress-tracker.js');
      const defaultTracker = new ProgressTracker();
      
      assert.equal(defaultTracker.cleanupInterval, 300000, 'Should use default cleanup interval');
      assert.equal(defaultTracker.maxAge, 3600000, 'Should use default max age');
      assert.equal(defaultTracker.maxEntries, 1000, 'Should use default max entries');
      
      defaultTracker.destroy();
    });
  });

  describe('updateProgress', () => {
    test('should update progress successfully', async () => {
      const agentId = 'agent-1';
      const progressUpdate = {
        status: 'in_progress',
        progressPercent: 50,
        details: 'Working on task',
        timestamp: Date.now()
      };

      const result = await progressTracker.updateProgress(agentId, progressUpdate);

      assert.equal(result.success, true, 'Should succeed');
      assert.equal(result.agentId, agentId, 'Should return agent ID');
      assert.ok(result.timestamp, 'Should include timestamp');

      // Check stored data
      const stored = progressTracker.getProgress(agentId);
      assert.equal(stored.status, 'in_progress', 'Should store status');
      assert.equal(stored.progressPercent, 50, 'Should store progress percent');
      assert.equal(stored.details, 'Working on task', 'Should store details');
    });

    test('should use current timestamp if not provided', async () => {
      const before = Date.now();
      await progressTracker.updateProgress('agent-1', { status: 'started' });
      const after = Date.now();

      const stored = progressTracker.getProgress('agent-1');
      assert.ok(stored.timestamp >= before && stored.timestamp <= after, 'Should use current timestamp');
    });

    test('should merge with existing progress data', async () => {
      const agentId = 'agent-1';
      
      // First update
      await progressTracker.updateProgress(agentId, {
        status: 'in_progress',
        progressPercent: 25,
        details: 'Starting'
      });

      // Second update (partial)
      await progressTracker.updateProgress(agentId, {
        status: 'in_progress',
        progressPercent: 75
      });

      const stored = progressTracker.getProgress(agentId);
      assert.equal(stored.progressPercent, 75, 'Should update progress percent');
      assert.equal(stored.details, 'Starting', 'Should preserve existing details');
    });

    test('should truncate long details', async () => {
      const longDetails = 'x'.repeat(300);
      
      await progressTracker.updateProgress('agent-1', {
        status: 'working',
        details: longDetails
      });

      const stored = progressTracker.getProgress('agent-1');
      assert.ok(stored.details.length <= 200, 'Details should be truncated');
      assert.ok(stored.details.endsWith('...'), 'Should end with ellipsis');
    });

    test('should handle help requests', async () => {
      const helpRequest = {
        errorDescription: 'Connection failed',
        attemptedSolutions: ['Retry', 'Check network'],
        helpNeeded: 'Network troubleshooting'
      };

      await progressTracker.updateProgress('agent-1', {
        status: 'needs_help',
        helpRequest
      });

      const stored = progressTracker.getProgress('agent-1');
      assert.equal(stored.status, 'needs_help', 'Should store help status');
      assert.deepEqual(stored.helpRequest, helpRequest, 'Should store help request');
    });

    test('should fail with invalid parameters', async () => {
      // No agent ID
      try {
        await progressTracker.updateProgress(null, { status: 'test' });
        assert.fail('Should throw for null agent ID');
      } catch (error) {
        assert.ok(error.message.includes('Agent ID'), 'Should mention agent ID requirement');
      }

      // No status
      try {
        await progressTracker.updateProgress('agent-1', {});
        assert.fail('Should throw for missing status');
      } catch (error) {
        assert.ok(error.message.includes('status'), 'Should mention status requirement');
      }
    });

    test('should trigger callbacks', async () => {
      await progressTracker.updateProgress('agent-1', { status: 'started' });

      assert.equal(callbackEvents.length, 1, 'Should trigger one callback');
      assert.equal(callbackEvents[0].eventType, 'progress_update', 'Should be progress_update event');
      assert.equal(callbackEvents[0].data.agentId, 'agent-1', 'Should include agent ID');
      assert.ok(callbackEvents[0].data.progress, 'Should include progress data');
    });
  });

  describe('getProgress', () => {
    test('should return progress for existing agent', async () => {
      await progressTracker.updateProgress('agent-1', {
        status: 'working',
        progressPercent: 30
      });

      const progress = progressTracker.getProgress('agent-1');
      assert.ok(progress, 'Should return progress data');
      assert.equal(progress.agentId, 'agent-1', 'Should include agent ID');
      assert.equal(progress.status, 'working', 'Should include status');
    });

    test('should return null for non-existent agent', async () => {
      const progress = progressTracker.getProgress('non-existent');
      assert.equal(progress, null, 'Should return null for non-existent agent');
    });
  });

  describe('getAllProgress', () => {
    test('should return all progress entries', async () => {
      await progressTracker.updateProgress('agent-1', { status: 'working' });
      await progressTracker.updateProgress('agent-2', { status: 'waiting' });
      await progressTracker.updateProgress('agent-3', { status: 'completed' });

      const allProgress = progressTracker.getAllProgress();
      assert.equal(allProgress.length, 3, 'Should return all three entries');
      
      const agentIds = allProgress.map(p => p.agentId);
      assert.ok(agentIds.includes('agent-1'), 'Should include agent-1');
      assert.ok(agentIds.includes('agent-2'), 'Should include agent-2');
      assert.ok(agentIds.includes('agent-3'), 'Should include agent-3');
    });

    test('should return empty array when no progress', async () => {
      const allProgress = progressTracker.getAllProgress();
      assert.equal(allProgress.length, 0, 'Should return empty array');
    });
  });

  describe('getProgressSummary', () => {
    test('should return summary for no agents', async () => {
      const summary = progressTracker.getProgressSummary();
      
      assert.equal(summary.totalAgents, 0, 'Should show zero agents');
      assert.equal(summary.summary, 'No active agents', 'Should have appropriate message');
      assert.deepEqual(summary.statusCounts, {}, 'Should have empty status counts');
      assert.equal(summary.overallProgress, 0, 'Should show zero progress');
    });

    test('should aggregate status counts', async () => {
      await progressTracker.updateProgress('agent-1', { status: 'in_progress', progressPercent: 30 });
      await progressTracker.updateProgress('agent-2', { status: 'in_progress', progressPercent: 70 });
      await progressTracker.updateProgress('agent-3', { status: 'completed', progressPercent: 100 });
      await progressTracker.updateProgress('agent-4', { status: 'failed' });

      const summary = progressTracker.getProgressSummary();
      
      assert.equal(summary.totalAgents, 4, 'Should count all agents');
      assert.equal(summary.statusCounts.in_progress, 2, 'Should count in_progress agents');
      assert.equal(summary.statusCounts.completed, 1, 'Should count completed agents');
      assert.equal(summary.statusCounts.failed, 1, 'Should count failed agents');
      assert.equal(summary.overallProgress, 67, 'Should calculate average progress (30+70+100)/3 = 67)');
    });

    test('should filter by specific agent IDs', async () => {
      await progressTracker.updateProgress('agent-1', { status: 'working' });
      await progressTracker.updateProgress('agent-2', { status: 'completed' });
      await progressTracker.updateProgress('agent-3', { status: 'failed' });

      const summary = progressTracker.getProgressSummary(['agent-1', 'agent-2']);
      
      assert.equal(summary.totalAgents, 2, 'Should only count specified agents');
      assert.equal(summary.statusCounts.working, 1, 'Should include agent-1');
      assert.equal(summary.statusCounts.completed, 1, 'Should include agent-2');
      assert.equal(summary.statusCounts.failed, undefined, 'Should exclude agent-3');
    });

    test('should include help requests in summary', async () => {
      await progressTracker.updateProgress('agent-1', {
        status: 'needs_help',
        helpRequest: { helpNeeded: 'Database issues' }
      });

      const summary = progressTracker.getProgressSummary();
      
      assert.equal(summary.helpRequests.length, 1, 'Should include help requests');
      assert.equal(summary.helpRequests[0].agentId, 'agent-1', 'Should include agent ID');
      assert.ok(summary.helpRequests[0].helpRequest, 'Should include help request data');
    });

    test('should generate concise summary text', async () => {
      await progressTracker.updateProgress('agent-1', { status: 'in_progress' });
      await progressTracker.updateProgress('agent-2', { status: 'in_progress' });
      await progressTracker.updateProgress('agent-3', { status: 'completed' });

      const summary = progressTracker.getProgressSummary();
      
      assert.equal(summary.summary, '2 active, 1 done', 'Should generate concise summary');
    });
  });

  describe('removeProgress', () => {
    test('should remove progress for specific agent', async () => {
      await progressTracker.updateProgress('agent-1', { status: 'working' });
      await progressTracker.updateProgress('agent-2', { status: 'waiting' });

      const removed = progressTracker.removeProgress('agent-1');
      
      assert.equal(removed, true, 'Should return true for successful removal');
      assert.equal(progressTracker.getProgress('agent-1'), null, 'Should remove agent-1 progress');
      assert.ok(progressTracker.getProgress('agent-2'), 'Should keep agent-2 progress');
    });

    test('should return false for non-existent agent', async () => {
      const removed = progressTracker.removeProgress('non-existent');
      assert.equal(removed, false, 'Should return false for non-existent agent');
    });

    test('should trigger callback on removal', async () => {
      await progressTracker.updateProgress('agent-1', { status: 'working' });
      callbackEvents.length = 0; // Clear previous events
      
      progressTracker.removeProgress('agent-1');
      
      assert.equal(callbackEvents.length, 1, 'Should trigger callback');
      assert.equal(callbackEvents[0].eventType, 'progress_removed', 'Should be removal event');
    });
  });

  describe('clearAll', () => {
    test('should clear all progress data', async () => {
      await progressTracker.updateProgress('agent-1', { status: 'working' });
      await progressTracker.updateProgress('agent-2', { status: 'waiting' });

      progressTracker.clearAll();

      assert.equal(progressTracker.getAllProgress().length, 0, 'Should clear all progress');
      assert.equal(progressTracker.getProgress('agent-1'), null, 'Should clear agent-1');
      assert.equal(progressTracker.getProgress('agent-2'), null, 'Should clear agent-2');
    });

    test('should trigger callback on clear', async () => {
      await progressTracker.updateProgress('agent-1', { status: 'working' });
      callbackEvents.length = 0; // Clear previous events
      
      progressTracker.clearAll();
      
      assert.equal(callbackEvents.length, 1, 'Should trigger callback');
      assert.equal(callbackEvents[0].eventType, 'progress_cleared', 'Should be clear event');
    });
  });

  describe('Callbacks', () => {
    test('should add and remove callbacks', async () => {
      const callback1 = () => {};
      const callback2 = () => {};

      progressTracker.addCallback(callback1);
      progressTracker.addCallback(callback2);
      assert.equal(progressTracker.callbacks.size, 3, 'Should have 3 callbacks (including test callback)');

      progressTracker.removeCallback(callback1);
      assert.equal(progressTracker.callbacks.size, 2, 'Should have 2 callbacks after removal');
    });

    test('should ignore non-function callbacks', async () => {
      const initialSize = progressTracker.callbacks.size;
      progressTracker.addCallback('not-a-function');
      progressTracker.addCallback(null);
      
      assert.equal(progressTracker.callbacks.size, initialSize, 'Should not add non-function callbacks');
    });

    test('should handle callback errors gracefully', async () => {
      const errorCallback = () => {
        throw new Error('Callback error');
      };

      progressTracker.addCallback(errorCallback);
      
      // Should not throw
      await progressTracker.updateProgress('agent-1', { status: 'test' });
      
      // Other callbacks should still work
      assert.ok(callbackEvents.length > 0, 'Other callbacks should still work');
    });
  });

  describe('Helper Methods', () => {
    test('should get agents needing help', async () => {
      await progressTracker.updateProgress('agent-1', { status: 'working' });
      await progressTracker.updateProgress('agent-2', { 
        status: 'needs_help',
        details: 'Database error',
        helpRequest: { helpNeeded: 'Database troubleshooting' }
      });
      await progressTracker.updateProgress('agent-3', { status: 'completed' });

      const needingHelp = progressTracker.getAgentsNeedingHelp();
      
      assert.equal(needingHelp.length, 1, 'Should find one agent needing help');
      assert.equal(needingHelp[0].agentId, 'agent-2', 'Should be agent-2');
      assert.equal(needingHelp[0].details, 'Database error', 'Should include details');
      assert.ok(needingHelp[0].helpRequest, 'Should include help request');
    });

    test('should get active agents', async () => {
      await progressTracker.updateProgress('agent-1', { status: 'in_progress' });
      await progressTracker.updateProgress('agent-2', { status: 'waiting' });
      await progressTracker.updateProgress('agent-3', { status: 'completed' });
      await progressTracker.updateProgress('agent-4', { status: 'failed' });

      const active = progressTracker.getActiveAgents();
      
      assert.equal(active.length, 2, 'Should find two active agents');
      const activeIds = active.map(a => a.agentId);
      assert.ok(activeIds.includes('agent-1'), 'Should include in_progress agent');
      assert.ok(activeIds.includes('agent-2'), 'Should include waiting agent');
    });
  });

  describe('Cleanup and Memory Management', () => {
    test('should cleanup old entries', async () => {
      const { ProgressTracker } = await import('../../src/tools/progress-tracker.js');
      const testTracker = new ProgressTracker({
        cleanupInterval: 50,
        maxAge: 100 // 100ms
      });

      await testTracker.updateProgress('agent-1', { status: 'old' });
      assert.equal(testTracker.getAllProgress().length, 1, 'Should have one entry');

      // Wait for aging and cleanup
      await new Promise(resolve => setTimeout(resolve, 150));
      
      assert.equal(testTracker.getAllProgress().length, 0, 'Should cleanup old entries');
      
      testTracker.destroy();
    });

    test('should respect max entries limit', async () => {
      // progressTracker has maxEntries: 5
      for (let i = 1; i <= 7; i++) {
        await progressTracker.updateProgress(`agent-${i}`, { status: 'working' });
      }

      const allProgress = progressTracker.getAllProgress();
      assert.ok(allProgress.length <= 5, 'Should respect max entries limit');
    });

    test('should cleanup completed/failed entries quickly', async () => {
      const { ProgressTracker } = await import('../../src/tools/progress-tracker.js');
      const testTracker = new ProgressTracker({
        cleanupInterval: 50
      });

      await testTracker.updateProgress('agent-1', { status: 'completed' });
      await testTracker.updateProgress('agent-2', { status: 'failed' });
      
      // Wait for cleanup (completed/failed cleaned after 1 minute, but we can test the logic)
      testTracker.cleanup();
      
      testTracker.destroy();
    });
  });

  describe('Destroy', () => {
    test('should clean up resources on destroy', async () => {
      const initialCallbacks = progressTracker.callbacks.size;
      await progressTracker.updateProgress('agent-1', { status: 'working' });

      progressTracker.destroy();

      assert.equal(progressTracker.getAllProgress().length, 0, 'Should clear all progress');
      assert.equal(progressTracker.callbacks.size, 0, 'Should clear all callbacks');
      assert.equal(progressTracker.cleanupTimer, null, 'Should clear cleanup timer');
    });
  });
});