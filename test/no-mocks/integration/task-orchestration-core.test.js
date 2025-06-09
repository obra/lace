// ABOUTME: Core integration tests for TaskTool orchestration and parallel execution features
// ABOUTME: Focused validation of essential functionality without complex mocking scenarios

import { jest } from '@jest/globals';
import { Agent } from '../../../src/agents/agent.ts';
import { ToolRegistry } from '../../../src/tools/tool-registry.js';
import { ProgressTracker } from '../../../src/tools/progress-tracker.js';
import { TaskTool } from '../../../src/tools/task-tool.js';

describe('Task Orchestration Core Integration', () => {
  let agent;
  let toolRegistry;
  let progressTracker;
  let mockModelProvider;
  let mockDb;

  beforeEach(async () => {
    // Mock database
    mockDb = {
      saveMessage: jest.fn().mockResolvedValue(true),
      getConversationHistory: jest.fn().mockResolvedValue([])
    };

    // Simple model provider mock
    mockModelProvider = {
      chat: jest.fn().mockResolvedValue({
        success: true,
        content: 'Task completed successfully',
        toolCalls: [],
        usage: { input_tokens: 50, output_tokens: 30, total_tokens: 80 }
      })
    };

    // Initialize progress tracker with longer cleanup interval for testing
    progressTracker = new ProgressTracker({ 
      cleanupInterval: 3600000, // 1 hour - avoid cleanup during tests
      maxAge: 7200000 // 2 hours
    });

    // Initialize tool registry
    toolRegistry = new ToolRegistry({ progressTracker });
    await toolRegistry.initialize();

    // Create agent
    agent = new Agent({
      role: 'orchestrator',
      assignedModel: 'claude-3-5-sonnet-20241022',
      assignedProvider: 'anthropic',
      tools: toolRegistry,
      db: mockDb,
      modelProvider: mockModelProvider,
      maxConcurrentTools: 3,
      verbose: false
    });

    agent.agentId = 'test-agent-001';
    agent.generation = 1;
  });

  afterEach(async () => {
    // Clean up ProgressTracker timer to prevent memory leaks
    if (progressTracker) {
      progressTracker.destroy();
    }
  });

  // Helper function to set up TaskTool with all required context
  const setupTaskTool = (customAgent = null) => {
    const taskTool = toolRegistry.get('task');
    const agentToUse = customAgent || agent;
    taskTool.setAgent(agentToUse);
    taskTool.setProgressTracker(progressTracker);
    taskTool.setSessionId('test-session');
    return taskTool;
  };

  afterAll(() => {
    // Clean up progress tracker to prevent open handles
    if (progressTracker) {
      progressTracker.destroy();
    }
  });

  describe('TaskTool Basic Functionality', () => {
    it('should successfully delegate a task to a sub-agent', async () => {
      const taskTool = setupTaskTool();

      const result = await taskTool.delegateTask({
        description: 'Analyze the data patterns',
        role: 'reasoning',
        model: 'claude-3-5-haiku-20241022'
      });

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.metadata.role).toBe('reasoning');
      expect(result.metadata.model).toBe('claude-3-5-haiku-20241022');
    });

    it('should spawn an agent and track relationships', async () => {
      const taskTool = setupTaskTool();

      const result = await taskTool.spawnAgent({
        role: 'execution',
        task: 'Process the dataset',
        model: 'claude-3-5-haiku-20241022'
      });

      expect(result.success).toBe(true);
      expect(result.agentId).toBeDefined();
      expect(result.result).toBeDefined();

      // Check relationship tracking
      const relationships = taskTool.getAgentRelationships();
      expect(Object.keys(relationships)).toHaveLength(1);
      expect(relationships[result.agentId].parentId).toBe('test-agent-001');
      expect(relationships[result.agentId].role).toBe('execution');
    });

    it('should handle progress reporting', async () => {
      const taskTool = setupTaskTool();

      const result = await taskTool.reportProgress({
        status: 'in_progress',
        progressPercent: 75,
        details: 'Processing data batch 3 of 4'
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('in_progress');
      expect(result.progressPercent).toBe(75);

      // Check that progress was tracked
      const progressData = progressTracker.getProgress(agent.generation);
      expect(progressData).toBeDefined();
      expect(progressData.status).toBe('in_progress');
      expect(progressData.progressPercent).toBe(75);
    });

    it('should handle help requests', async () => {
      const taskTool = setupTaskTool();

      const result = await taskTool.requestHelp({
        errorDescription: 'Memory limit exceeded during processing',
        attemptedSolutions: ['Reduced batch size', 'Cleared cache'],
        helpNeeded: 'Need guidance on memory optimization'
      });

      expect(result.success).toBe(true);
      expect(result.helpRequestId).toMatch(/^help_/);
      expect(result.errorDescription).toContain('Memory limit exceeded');

      // Check that help request was tracked
      const progressData = progressTracker.getProgress(agent.generation);
      expect(progressData).toBeDefined();
      expect(progressData.status).toBe('needs_help');
      expect(progressData.helpRequest).toBeDefined();
    });
  });

  describe('Inter-Agent Message Passing', () => {
    it('should send and receive messages between agents', async () => {
      const taskTool = toolRegistry.get('task');
      taskTool.setAgent(agent);

      // Send a message
      const sendResult = await taskTool.sendMessage({
        recipientId: 'child-agent-456',
        messageType: 'status_update',
        content: 'Parent task 50% complete',
        priority: 'medium'
      });

      expect(sendResult.success).toBe(true);
      expect(sendResult.messageId).toMatch(/^msg_/);
      expect(sendResult.messageType).toBe('status_update');

      // Mock receiving agent
      const childAgent = { ...agent, agentId: 'child-agent-456', generation: 1.1 };
      taskTool.setAgent(childAgent);

      // Receive messages
      const receiveResult = await taskTool.receiveMessages();
      
      expect(receiveResult.success).toBe(true);
      expect(receiveResult.messages).toHaveLength(1);
      expect(receiveResult.messages[0].content).toBe('Parent task 50% complete');
      expect(receiveResult.messages[0].senderId).toBe('test-agent-001');
    });

    it('should filter messages by type', async () => {
      const taskTool = toolRegistry.get('task');
      taskTool.setAgent(agent);

      // Send different types of messages to same recipient
      await taskTool.sendMessage({
        recipientId: agent.agentId, // Send to self for testing
        messageType: 'status_update',
        content: 'Status message'
      });

      await taskTool.sendMessage({
        recipientId: agent.agentId,
        messageType: 'coordination',
        content: 'Coordination message'
      });

      // Filter by message type
      const statusResult = await taskTool.receiveMessages({
        messageType: 'status_update'
      });

      const coordResult = await taskTool.receiveMessages({
        messageType: 'coordination'
      });

      expect(statusResult.messages).toHaveLength(1);
      expect(statusResult.messages[0].messageType).toBe('status_update');

      expect(coordResult.messages).toHaveLength(1);
      expect(coordResult.messages[0].messageType).toBe('coordination');
    });

    it('should handle large message content with truncation', async () => {
      const taskTool = toolRegistry.get('task');
      taskTool.setAgent(agent);

      const largeContent = 'x'.repeat(1500); // Larger than 1000 char limit

      const result = await taskTool.sendMessage({
        recipientId: 'test-recipient',
        messageType: 'share_result',
        content: largeContent
      });

      expect(result.success).toBe(true);
      expect(result.contentTruncated).toBe(true);
      expect(result.originalLength).toBe(1500);
      expect(result.content.length).toBe(1000); // Should be truncated
    });
  });

  describe('Parallel Tool Execution', () => {
    it('should execute multiple TaskTool operations in parallel', async () => {
      // Mock tool operations with delays to test concurrency
      const originalCallTool = toolRegistry.callTool.bind(toolRegistry);
      let operationCount = 0;
      const startTimes = [];

      toolRegistry.callTool = jest.fn().mockImplementation(async (name, method, params, sessionId, agent) => {
        const opId = ++operationCount;
        startTimes[opId] = Date.now();
        
        // Add delay to simulate tool execution
        await new Promise(resolve => setTimeout(resolve, 100));
        
        return originalCallTool(name, method, params, sessionId, agent);
      });

      const toolCalls = [
        { name: 'task_reportProgress', input: { status: 'starting', details: 'Task 1' } },
        { name: 'task_reportProgress', input: { status: 'processing', details: 'Task 2' } },
        { name: 'task_reportProgress', input: { status: 'finishing', details: 'Task 3' } }
      ];

      const startTime = Date.now();
      const results = await agent.executeToolsInParallel(toolCalls, 'test-session', 'parallel test');
      const totalDuration = Date.now() - startTime;

      // All operations should complete successfully
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      // Should be faster than sequential execution (3 * 100ms = 300ms)
      expect(totalDuration).toBeLessThan(250); // Allow some buffer

      // Verify tools were called
      expect(toolRegistry.callTool).toHaveBeenCalledTimes(3);
    });

    it('should handle tool errors gracefully in parallel execution', async () => {
      // Mock one tool to fail
      let callCount = 0;
      const originalCallTool = toolRegistry.callTool.bind(toolRegistry);
      
      toolRegistry.callTool = jest.fn().mockImplementation(async (name, method, params, sessionId, agent) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Simulated tool failure');
        }
        return originalCallTool(name, method, params, sessionId, agent);
      });

      const toolCalls = [
        { name: 'task_reportProgress', input: { status: 'task1' } },
        { name: 'task_reportProgress', input: { status: 'task2' } }, // This will fail
        { name: 'task_reportProgress', input: { status: 'task3' } }
      ];

      const results = await agent.executeToolsInParallel(toolCalls, 'test-session', 'error test');

      expect(results).toHaveLength(3);
      
      // Should have 2 successful and 1 failed
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => r.error);

      expect(successful).toHaveLength(2);
      expect(failed).toHaveLength(1);
      expect(failed[0].error).toContain('Simulated tool failure');
    });
  });

  describe('Progress Tracking Integration', () => {
    it('should aggregate progress from multiple operations', async () => {
      const taskTool = setupTaskTool();

      // Create multiple progress updates
      await taskTool.reportProgress({
        status: 'in_progress',
        progressPercent: 25,
        details: 'Phase 1 complete'
      });

      // Simulate second agent (create separate TaskTool to avoid interference)
      const agent2 = { generation: 2, agentId: 'agent-002' };
      const taskTool2 = setupTaskTool(agent2);

      await taskTool2.reportProgress({
        status: 'in_progress',
        progressPercent: 75,
        details: 'Phase 2 processing'
      });

      // Get progress summary
      const summary = progressTracker.getProgressSummary();

      expect(summary.totalAgents).toBe(2);
      expect(summary.statusCounts.in_progress).toBe(2);
      expect(summary.overallProgress).toBe(50); // Average of 25% and 75%
    });

    it('should track agents needing help', async () => {
      const taskTool = setupTaskTool();

      await taskTool.requestHelp({
        errorDescription: 'Database connection failed',
        helpNeeded: 'Need database configuration assistance'
      });

      const agentsNeedingHelp = progressTracker.getAgentsNeedingHelp();
      
      expect(agentsNeedingHelp).toHaveLength(1);
      expect(agentsNeedingHelp[0].agentId).toBe(agent.generation);
      expect(agentsNeedingHelp[0].helpRequest).toBeDefined();
      expect(agentsNeedingHelp[0].helpRequest.helpNeeded).toContain('database configuration');
    });
  });

  describe('Tool Registry Integration', () => {
    it('should properly register TaskTool with agent context', async () => {
      const taskTool = toolRegistry.get('task');
      expect(taskTool).toBeInstanceOf(TaskTool);

      // Tool should set agent context when called via registry
      const result = await toolRegistry.callTool('task', 'reportProgress', {
        status: 'testing',
        details: 'Registry integration test'
      }, 'test-session', agent);

      expect(result.success).toBe(true);
      expect(result.agentId).toBe(agent.generation);
    });

    it('should provide correct tool schema for TaskTool', async () => {
      const schema = toolRegistry.getToolSchema('task');
      
      expect(schema).toBeDefined();
      expect(schema.name).toBe('task');
      expect(schema.description).toContain('orchestration');
      
      // Check that all methods are present
      const methods = Object.keys(schema.methods);
      expect(methods).toContain('delegateTask');
      expect(methods).toContain('spawnAgent');
      expect(methods).toContain('reportProgress');
      expect(methods).toContain('requestHelp');
      expect(methods).toContain('sendMessage');
      expect(methods).toContain('receiveMessages');
    });
  });

  describe('Error Recovery and Retry Logic', () => {
    it('should retry failed operations with exponential backoff', async () => {
      let attemptCount = 0;
      const originalCallTool = toolRegistry.callTool.bind(toolRegistry);
      
      toolRegistry.callTool = jest.fn().mockImplementation(async (name, method, params) => {
        attemptCount++;
        if (attemptCount <= 2) {
          throw new Error('Temporary failure');
        }
        return originalCallTool(name, method, params, 'test-session', agent);
      });

      const toolCalls = [{ name: 'task_reportProgress', input: { status: 'retrying' } }];

      const startTime = Date.now();
      const results = await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'retry test');
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].retryAttempts).toBe(2); // Failed twice, succeeded on third
      
      // Should have exponential backoff delay
      expect(duration).toBeGreaterThan(300); // At least base delay + backoff
      expect(attemptCount).toBe(3); // Initial + 2 retries
    });

    it('should not retry non-retriable errors', async () => {
      const originalCallTool = toolRegistry.callTool.bind(toolRegistry);
      let callCount = 0;
      
      toolRegistry.callTool = jest.fn().mockImplementation(async () => {
        callCount++;
        throw new Error('Authentication failed'); // Non-retriable error
      });

      const toolCalls = [{ name: 'task_reportProgress', input: { status: 'auth_test' } }];

      const results = await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'auth test');

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].nonRetriable).toBe(true);
      expect(results[0].retryAttempts).toBe(0);
      expect(callCount).toBe(1); // Should not retry
    });
  });
});