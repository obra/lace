// ABOUTME: Integration tests for TaskTool and ProgressTracker working together
// ABOUTME: Tests the complete flow of progress reporting through TaskTool to ProgressTracker

import { test, describe, beforeEach, afterEach } from '../test-harness.js';
import { TestHarness, assert, utils } from '../test-harness.js';

describe('TaskTool-ProgressTracker Integration', () => {
  let harness;
  let taskTool;
  let progressTracker;
  let mockAgent;

  beforeEach(async () => {
    harness = new TestHarness();
    
    // Import classes
    const { TaskTool } = await import('../../src/tools/task-tool.js');
    const { ProgressTracker } = await import('../../src/tools/progress-tracker.js');

    progressTracker = new ProgressTracker();
    taskTool = new TaskTool();

    // Set up TaskTool with ProgressTracker
    taskTool.setProgressTracker(progressTracker);

    // Mock agent
    mockAgent = {
      generation: 1.5,
      delegateTask: async (sessionId, description) => ({
        content: `Completed: ${description}`
      }),
      spawnSubagent: async (options) => ({
        generation: 1.6,
        generateResponse: async () => ({ content: 'Subagent completed task' })
      })
    };

    taskTool.setAgent(mockAgent);
    taskTool.setSessionId('test-session');
  });

  afterEach(async () => {
    if (progressTracker) {
      progressTracker.destroy();
    }
    await harness.cleanup();
  });

  describe('Progress Reporting Integration', () => {
    test('should report progress through TaskTool to ProgressTracker', async () => {
      // Report progress via TaskTool
      const result = await taskTool.reportProgress({
        status: 'in_progress',
        progressPercent: 75,
        details: 'Almost done with task'
      });

      assert.equal(result.success, true, 'TaskTool should succeed');

      // Verify progress was stored in ProgressTracker
      const storedProgress = progressTracker.getProgress(1.5);
      assert.ok(storedProgress, 'Progress should be stored');
      assert.equal(storedProgress.status, 'in_progress', 'Should store correct status');
      assert.equal(storedProgress.progressPercent, 75, 'Should store correct progress');
      assert.equal(storedProgress.details, 'Almost done with task', 'Should store details');
    });

    test('should handle help requests through integration', async () => {
      const result = await taskTool.requestHelp({
        errorDescription: 'Database connection failed',
        attemptedSolutions: ['Restarted service', 'Checked credentials'],
        helpNeeded: 'Need network troubleshooting assistance'
      });

      assert.equal(result.success, true, 'TaskTool should succeed');

      // Verify help request was stored
      const storedProgress = progressTracker.getProgress(1.5);
      assert.equal(storedProgress.status, 'needs_help', 'Should set needs_help status');
      assert.ok(storedProgress.helpRequest, 'Should store help request');

      // Check ProgressTracker helper method
      const needingHelp = progressTracker.getAgentsNeedingHelp();
      assert.equal(needingHelp.length, 1, 'Should find one agent needing help');
      assert.equal(needingHelp[0].agentId, 1.5, 'Should be the correct agent');
    });

    test('should handle delegateTask with progress tracking', async () => {
      // Delegate task should trigger progress reporting
      const result = await taskTool.delegateTask({
        description: 'Process large dataset',
        role: 'data_processor',
        timeout: 30000
      });

      assert.equal(result.success, true, 'Task delegation should succeed');

      // Check if progress was updated for completion
      const storedProgress = progressTracker.getProgress(1.5);
      assert.ok(storedProgress, 'Should have progress entry');
      assert.equal(storedProgress.status, 'completed', 'Should mark as completed');
      assert.equal(storedProgress.progressPercent, 100, 'Should be 100% complete');
    });
  });

  describe('Summary and Aggregation', () => {
    test('should aggregate progress from multiple TaskTool agents', async () => {
      // Simulate multiple agents reporting progress
      const agent1 = { ...mockAgent, generation: 1.1 };
      const agent2 = { ...mockAgent, generation: 1.2 };
      const agent3 = { ...mockAgent, generation: 1.3 };

      // Set up TaskTools for each agent
      const taskTool1 = new TaskTool();
      taskTool1.setAgent(agent1);
      taskTool1.setProgressTracker(progressTracker);

      const taskTool2 = new TaskTool();
      taskTool2.setAgent(agent2);
      taskTool2.setProgressTracker(progressTracker);

      const taskTool3 = new TaskTool();
      taskTool3.setAgent(agent3);
      taskTool3.setProgressTracker(progressTracker);

      // Report different progress states
      await taskTool1.reportProgress({ status: 'in_progress', progressPercent: 30 });
      await taskTool2.reportProgress({ status: 'in_progress', progressPercent: 80 });
      await taskTool3.reportProgress({ status: 'completed', progressPercent: 100 });

      // Check aggregated summary
      const summary = progressTracker.getProgressSummary();
      assert.equal(summary.totalAgents, 3, 'Should track all three agents');
      assert.equal(summary.statusCounts.in_progress, 2, 'Should count in_progress agents');
      assert.equal(summary.statusCounts.completed, 1, 'Should count completed agents');
      assert.equal(summary.overallProgress, 70, 'Should calculate average progress (30+80+100)/3 = 70)');
      assert.equal(summary.summary, '2 active, 1 done', 'Should generate concise summary');
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle TaskTool errors gracefully in ProgressTracker', async () => {
      // Force an error in progress tracker
      const errorTracker = {
        updateProgress: async () => {
          throw new Error('Progress tracker storage failed');
        }
      };

      taskTool.setProgressTracker(errorTracker);

      const result = await taskTool.reportProgress({ status: 'testing' });

      assert.equal(result.success, false, 'Should fail when progress tracker throws');
      assert.ok(result.error.includes('storage failed'), 'Should include tracker error');
    });

    test('should work when ProgressTracker is not available', async () => {
      taskTool.setProgressTracker(null);

      const result = await taskTool.reportProgress({ status: 'working' });

      assert.equal(result.success, true, 'Should succeed without progress tracker');
      assert.equal(result.status, 'working', 'Should still return status');
    });
  });

  describe('Real-world Scenarios', () => {
    test('should handle complex multi-agent workflow', async () => {
      // Simulate a realistic workflow with progress tracking

      // Agent 1: Start working
      const agent1 = { ...mockAgent, generation: 2.1 };
      const tool1 = new TaskTool();
      tool1.setAgent(agent1);
      tool1.setProgressTracker(progressTracker);

      await tool1.reportProgress({
        status: 'in_progress',
        progressPercent: 10,
        details: 'Started analysis'
      });

      // Agent 2: Spawn for parallel work
      const agent2 = { ...mockAgent, generation: 2.2 };
      const tool2 = new TaskTool();
      tool2.setAgent(agent2);
      tool2.setProgressTracker(progressTracker);

      await tool2.reportProgress({
        status: 'in_progress',
        progressPercent: 5,
        details: 'Initializing parallel process'
      });

      // Agent 1: Progress update
      await tool1.reportProgress({
        status: 'in_progress',
        progressPercent: 60,
        details: 'Analysis 60% complete'
      });

      // Agent 3: Encounters error and needs help
      const agent3 = { ...mockAgent, generation: 2.3 };
      const tool3 = new TaskTool();
      tool3.setAgent(agent3);
      tool3.setProgressTracker(progressTracker);

      await tool3.requestHelp({
        errorDescription: 'Memory limit exceeded during processing',
        attemptedSolutions: ['Increased memory allocation', 'Optimized algorithm'],
        helpNeeded: 'Need alternative processing strategy'
      });

      // Check overall progress summary
      const summary = progressTracker.getProgressSummary();
      assert.equal(summary.totalAgents, 3, 'Should track all agents');
      assert.equal(summary.statusCounts.in_progress, 2, 'Should have 2 active agents');
      assert.equal(summary.statusCounts.needs_help, 1, 'Should have 1 agent needing help');
      assert.equal(summary.helpRequests.length, 1, 'Should include help request');

      // Check active agents
      const activeAgents = progressTracker.getActiveAgents();
      assert.equal(activeAgents.length, 3, 'All agents should be active (none completed/failed)');

      // Agent 1: Complete
      await tool1.reportProgress({
        status: 'completed',
        progressPercent: 100,
        details: 'Analysis complete'
      });

      // Final summary
      const finalSummary = progressTracker.getProgressSummary();
      assert.equal(finalSummary.summary, '1 active, 1 done, 1 need help', 'Should update summary');
    });
  });
});