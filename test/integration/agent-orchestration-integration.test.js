// ABOUTME: Integration tests demonstrating end-to-end agent orchestration with parallel execution
// ABOUTME: Tests TaskTool coordination, message passing, error recovery, and performance improvements

import { jest } from '@jest/globals';
import { Agent } from '../../src/agents/agent.js';
import { ToolRegistry } from '../../src/tools/tool-registry.js';
import { ProgressTracker } from '../../src/tools/progress-tracker.js';
import { TaskTool } from '../../src/tools/task-tool.js';

describe('Agent Orchestration Integration Tests', () => {
  let orchestratorAgent;
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

    // Mock model provider with call tracking per test
    let testCallCount = 0;
    mockModelProvider = {
      chat: jest.fn().mockImplementation(async (messages, options) => {
        testCallCount++;
        
        // Simulate different responses based on agent role and call count
        const systemMessage = messages.find(m => m.role === 'system');
        
        if (systemMessage?.content.includes('specialist')) {
          return {
            success: true,
            content: 'Specialist task completed with detailed analysis',
            toolCalls: [],
            usage: { input_tokens: 50, output_tokens: 30, total_tokens: 80 }
          };
        }
        
        if (systemMessage?.content.includes('worker')) {
          return {
            success: true,
            content: 'Worker task executed successfully',
            toolCalls: [],
            usage: { input_tokens: 40, output_tokens: 25, total_tokens: 65 }
          };
        }
        
        // Orchestrator: Only return tool calls on first call to avoid infinite loop
        if (testCallCount === 1) {
          return {
            success: true,
            content: 'Orchestrating multiple parallel tasks',
            toolCalls: [
              {
                name: 'task_delegateTask',
                input: {
                  description: 'Analyze data patterns',
                  role: 'specialist',
                  model: 'claude-3-5-sonnet-20241022'
                }
              },
              {
                name: 'task_spawnAgent',
                input: {
                  role: 'worker',
                  task: 'Process results',
                  model: 'claude-3-5-haiku-20241022'
                }
              },
              {
                name: 'task_reportProgress',
                input: {
                  status: 'in_progress',
                  progressPercent: 50,
                  details: 'Parallel tasks initiated'
                }
              }
            ],
            usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }
          };
        } else {
          // Subsequent calls return no tool calls to end the agentic loop
          return {
            success: true,
            content: 'Tasks completed successfully',
            toolCalls: [],
            usage: { input_tokens: 50, output_tokens: 25, total_tokens: 75 }
          };
        }
      })
    };

    // Initialize progress tracker
    progressTracker = new ProgressTracker();

    // Initialize tool registry with progress tracker
    toolRegistry = new ToolRegistry({ progressTracker });
    await toolRegistry.initialize();

    // Create orchestrator agent with parallel execution enabled
    orchestratorAgent = new Agent({
      role: 'orchestrator',
      assignedModel: 'claude-3-5-sonnet-20241022',
      assignedProvider: 'anthropic',
      tools: toolRegistry,
      db: mockDb,
      modelProvider: mockModelProvider,
      maxConcurrentTools: 5,
      verbose: false,
      capabilities: ['orchestration', 'planning', 'coordination']
    });

    // Set up agent IDs for message passing
    orchestratorAgent.agentId = 'orchestrator-001';
    orchestratorAgent.generation = 0;
  });

  afterEach(async () => {
    // Clean up ProgressTracker timer to prevent memory leaks
    if (progressTracker) {
      progressTracker.destroy();
    }
  });

  describe('Parallel Tool Execution with TaskTool', () => {
    it('should execute multiple TaskTool methods in parallel', async () => {
      const startTime = Date.now();
      
      // Generate response that will trigger parallel TaskTool execution
      const response = await orchestratorAgent.generateResponse(
        'test-session',
        'Create a team of agents to analyze data and process results simultaneously'
      );

      const duration = Date.now() - startTime;

      expect(response.content).toContain('Orchestrating multiple parallel tasks');
      expect(response.toolCalls).toHaveLength(3);
      expect(response.toolResults).toHaveLength(3);
      
      // All tool results should be successful
      const successfulResults = response.toolResults.filter(r => r.result?.success);
      expect(successfulResults).toHaveLength(3);

      // Verify different types of TaskTool operations were executed
      const toolNames = response.toolCalls.map(tc => tc.name);
      expect(toolNames).toContain('task_delegateTask');
      expect(toolNames).toContain('task_spawnAgent');
      expect(toolNames).toContain('task_reportProgress');

      // Should be faster than sequential execution due to parallel processing
      expect(duration).toBeLessThan(1000); // Should complete quickly in parallel
    });

    it('should demonstrate performance improvement over sequential execution', async () => {
      // Mock slow tool operations
      const originalCallTool = toolRegistry.callTool.bind(toolRegistry);
      toolRegistry.callTool = jest.fn().mockImplementation(async (name, method, params, sessionId, agent) => {
        // Add artificial delay to simulate tool execution time
        await new Promise(resolve => setTimeout(resolve, 100));
        return originalCallTool(name, method, params, sessionId, agent);
      });

      // Test parallel execution
      const parallelStartTime = Date.now();
      await orchestratorAgent.executeToolsInParallel([
        { name: 'task_delegateTask', input: { description: 'Task 1', role: 'worker' } },
        { name: 'task_delegateTask', input: { description: 'Task 2', role: 'worker' } },
        { name: 'task_delegateTask', input: { description: 'Task 3', role: 'worker' } }
      ], 'test-session', 'parallel test');
      const parallelDuration = Date.now() - parallelStartTime;

      // Simulate sequential execution for comparison  
      const sequentialStartTime = Date.now();
      for (let i = 1; i <= 3; i++) {
        const taskTool = toolRegistry.get('task');
        taskTool.setAgent(orchestratorAgent);
        taskTool.setSessionId('test-session');
        await taskTool.delegateTask({
          description: `Sequential Task ${i}`,
          role: 'worker'
        });
      }
      const sequentialDuration = Date.now() - sequentialStartTime;

      // Parallel should be significantly faster (at least 2x speedup expected)
      expect(parallelDuration).toBeLessThan(sequentialDuration * 0.6);
      
      // Should have called the tool the same number of times
      expect(toolRegistry.callTool).toHaveBeenCalledTimes(6); // 3 parallel + 3 sequential
    });
  });

  describe('Complex Multi-Agent Coordination', () => {
    it('should coordinate multiple sub-agents with progress reporting', async () => {
      const taskTool = toolRegistry.get('task');
      taskTool.setAgent(orchestratorAgent);
      taskTool.setSessionId('coordination-test');

      // Spawn multiple agents working in parallel
      const spawnPromises = [
        taskTool.spawnAgent({
          role: 'data_analyst',
          task: 'Analyze dataset patterns',
          model: 'claude-3-5-sonnet-20241022'
        }),
        taskTool.spawnAgent({
          role: 'data_processor',
          task: 'Clean and process data',
          model: 'claude-3-5-haiku-20241022'
        }),
        taskTool.spawnAgent({
          role: 'reporter',
          task: 'Generate summary report',
          model: 'claude-3-5-haiku-20241022'
        })
      ];

      const results = await Promise.all(spawnPromises);

      // All agents should spawn successfully
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.agentId).toBeDefined();
        expect(result.result).toBeDefined();
      });

      // Check that agent relationships are tracked
      const relationships = taskTool.getAgentRelationships();
      expect(Object.keys(relationships)).toHaveLength(3);

      // Each relationship should have correct parent
      Object.values(relationships).forEach(rel => {
        expect(rel.parentId).toBe('orchestrator-001');
        expect(rel.status).toBe('active');
      });
    });

    it('should handle inter-agent message passing', async () => {
      const taskTool = toolRegistry.get('task');
      taskTool.setAgent(orchestratorAgent);
      taskTool.setSessionId('message-test');

      // Register mock agent relationships
      taskTool.registerAgentRelationship('child-1', {
        parentId: 'orchestrator-001',
        role: 'processor',
        status: 'active'
      });

      taskTool.registerAgentRelationship('child-2', {
        parentId: 'orchestrator-001',
        role: 'analyzer',
        status: 'active'
      });

      // Send various types of messages
      const messages = await Promise.all([
        taskTool.sendMessage({
          recipientId: 'child-1',
          messageType: 'status_update',
          content: 'Starting coordination sequence',
          priority: 'high'
        }),
        taskTool.sendMessage({
          recipientId: 'child-2',
          messageType: 'coordination',
          content: 'Wait for processor completion',
          priority: 'medium'
        }),
        taskTool.sendMessage({
          recipientId: 'child-1',
          messageType: 'share_result',
          content: 'Analysis complete, proceeding to next phase',
          priority: 'low'
        })
      ]);

      // All messages should send successfully
      expect(messages).toHaveLength(3);
      messages.forEach(msg => {
        expect(msg.success).toBe(true);
        expect(msg.messageId).toMatch(/^msg_/);
        expect(msg.timestamp).toBeDefined();
      });

      // Messages should have different priorities and types
      expect(messages[0].priority).toBe('high');
      expect(messages[1].messageType).toBe('coordination');
      expect(messages[2].recipientId).toBe('child-1');
    });
  });

  describe('Error Recovery in Parallel Execution', () => {
    it('should handle mixed success/failure scenarios gracefully', async () => {
      // Mock some tools to fail
      const originalCallTool = toolRegistry.callTool.bind(toolRegistry);
      let callCount = 0;
      toolRegistry.callTool = jest.fn().mockImplementation(async (name, method, params, sessionId, agent) => {
        callCount++;
        // Make every 2nd call fail
        if (callCount % 2 === 0) {
          throw new Error('Simulated tool failure');
        }
        return originalCallTool(name, method, params, sessionId, agent);
      });

      const toolCalls = [
        { name: 'task_reportProgress', input: { status: 'starting' } },
        { name: 'task_reportProgress', input: { status: 'processing' } },
        { name: 'task_reportProgress', input: { status: 'completing' } },
        { name: 'task_reportProgress', input: { status: 'finished' } }
      ];

      const results = await orchestratorAgent.executeToolsInParallelWithRetry(
        toolCalls,
        'error-test-session',
        'testing error recovery'
      );

      expect(results).toHaveLength(4);

      // Should have mix of successful and failed results
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful.length).toBeGreaterThan(0);
      expect(failed.length).toBeGreaterThan(0);
      
      // Failed results should have retry information
      failed.forEach(result => {
        expect(result.retryAttempts).toBeGreaterThan(0);
        expect(result.error).toContain('Simulated tool failure');
      });

      // Should demonstrate graceful degradation
      expect(results[0].gracefulDegradation).toBe(true);
    });

    it('should implement circuit breaker for consistently failing tools', async () => {
      // Mock task tool to consistently fail
      const taskTool = toolRegistry.get('task');
      const originalDelegateTask = taskTool.delegateTask.bind(taskTool);
      taskTool.delegateTask = jest.fn().mockRejectedValue(new Error('Service unavailable'));

      taskTool.setAgent(orchestratorAgent);

      // Execute multiple failing operations to trigger circuit breaker
      const toolCalls = Array(6).fill().map((_, i) => ({
        name: 'task_delegateTask',
        input: { description: `Failing task ${i}`, role: 'worker' }
      }));

      const results = await orchestratorAgent.executeToolsInParallelWithRetry(
        toolCalls,
        'circuit-breaker-test',
        'testing circuit breaker'
      );

      // Should have some circuit broken results
      const circuitBrokenResults = results.filter(r => r.circuitBroken);
      expect(circuitBrokenResults.length).toBeGreaterThan(0);

      // Verify circuit breaker statistics
      const stats = orchestratorAgent.getCircuitBreakerStats();
      expect(stats.task).toBeDefined();
      expect(stats.task.failures).toBeGreaterThan(0);
      expect(['open', 'closed', 'half-open']).toContain(stats.task.state);

      // Restore original function
      taskTool.delegateTask = originalDelegateTask;
    });

    it('should provide actionable error analysis', async () => {
      // Mock various error types
      const originalCallTool = toolRegistry.callTool.bind(toolRegistry);
      let callCount = 0;
      toolRegistry.callTool = jest.fn().mockImplementation(async (name, method, params) => {
        callCount++;
        switch (callCount) {
          case 1:
            throw new Error('Rate limit exceeded - too many requests');
          case 2:
            throw new Error('Network timeout occurred');
          case 3:
            throw new Error('Tool validation failed - invalid input');
          default:
            return originalCallTool(name, method, params);
        }
      });

      const toolCalls = [
        { name: 'task_reportProgress', input: { status: 'test1' } },
        { name: 'task_reportProgress', input: { status: 'test2' } },
        { name: 'task_reportProgress', input: { status: 'test3' } }
      ];

      const results = await orchestratorAgent.executeToolsInParallelWithRetry(
        toolCalls,
        'error-analysis-test',
        'testing error analysis'
      );

      // Analyze the execution errors
      const errorAnalysis = orchestratorAgent.analyzeExecutionErrors(results);

      expect(errorAnalysis.toolSpecificErrors).toHaveLength(1); // validation error
      expect(errorAnalysis.systemicErrors).toHaveLength(1); // network timeout
      expect(errorAnalysis.recommendations).toEqual(
        expect.arrayContaining([
          expect.stringContaining('tool-specific'),
          expect.stringContaining('infrastructure')
        ])
      );

      // Check actionable error information
      const rateLimit = results.find(r => r.actionableError?.category === 'rate_limit');
      const network = results.find(r => r.actionableError?.category === 'network');
      
      expect(rateLimit).toBeDefined();
      expect(rateLimit.actionableError.suggestion).toContain('wait');
      expect(network).toBeDefined();
      expect(network.actionableError.retryAfter).toBeGreaterThan(0);
    });
  });

  describe('Progress Tracking and Coordination', () => {
    it('should track progress from multiple parallel agents', async () => {
      const progressCallbacks = [];
      
      // Set up progress tracking callbacks
      progressTracker.addCallback(async (eventType, data) => {
        if (eventType === 'progress_update') {
          progressCallbacks.push(data);
        }
      });

      const taskTool = toolRegistry.get('task');
      taskTool.setAgent(orchestratorAgent);
      taskTool.setSessionId('progress-test');

      // Report progress from multiple concurrent tasks
      const progressPromises = [
        taskTool.reportProgress({
          status: 'in_progress',
          progressPercent: 25,
          details: 'Agent 1 processing data'
        }),
        taskTool.reportProgress({
          status: 'in_progress', 
          progressPercent: 50,
          details: 'Agent 2 analyzing results'
        }),
        taskTool.reportProgress({
          status: 'completed',
          progressPercent: 100,
          details: 'Agent 3 finished reporting'
        })
      ];

      const results = await Promise.all(progressPromises);

      // All progress reports should succeed
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.agentId).toBeDefined();
      });

      // Progress tracker should have received updates
      expect(progressCallbacks.length).toBeGreaterThan(0);
      
      // Check aggregated progress data
      const progressSummary = progressTracker.getProgressSummary();
      expect(progressSummary.totalAgents).toBeGreaterThan(0);
    });

    it('should demonstrate request help functionality', async () => {
      const taskTool = toolRegistry.get('task');
      taskTool.setAgent(orchestratorAgent);

      const helpRequest = await taskTool.requestHelp({
        errorDescription: 'Unable to process large dataset due to memory constraints',
        attemptedSolutions: [
          'Tried increasing batch size',
          'Attempted data chunking',
          'Used streaming processing'
        ],
        helpNeeded: 'Need guidance on distributed processing approach'
      });

      expect(helpRequest.success).toBe(true);
      expect(helpRequest.helpRequestId).toMatch(/^help_/);
      expect(helpRequest.errorDescription).toContain('memory constraints');
      expect(helpRequest.attemptedSolutions).toHaveLength(3);
      expect(helpRequest.helpNeeded).toContain('distributed processing');

      // Should be recorded in progress tracker
      const progressData = progressTracker.getProgress(orchestratorAgent.generation);
      expect(progressData.status).toBe('needs_help');
      expect(progressData.helpRequest).toBeDefined();
    });
  });

  describe('End-to-End Orchestration Workflow', () => {
    it('should execute complete parallel workflow with all features', async () => {
      const workflowStartTime = Date.now();

      // Execute a complex multi-step workflow
      const response = await orchestratorAgent.generateResponse(
        'end-to-end-test',
        'Orchestrate a complete data analysis pipeline with parallel processing, progress tracking, and error recovery'
      );

      const workflowDuration = Date.now() - workflowStartTime;

      // Workflow should complete successfully
      expect(response.content).toBeDefined();
      expect(response.toolCalls).toBeDefined();
      expect(response.toolResults).toBeDefined();

      // Should demonstrate parallel execution performance
      expect(workflowDuration).toBeLessThan(2000); // Should complete within 2 seconds

      // Verify tool results include various TaskTool operations
      const taskToolResults = response.toolResults?.filter(r => 
        r.toolCall?.name?.startsWith('task_')
      );
      expect(taskToolResults.length).toBeGreaterThan(0);

      // Should have a mix of different task operations
      const operationTypes = new Set(
        taskToolResults.map(r => r.toolCall.name.split('_')[1])
      );
      expect(operationTypes.size).toBeGreaterThan(1);

      // Progress should be tracked
      const finalProgress = progressTracker.getProgressSummary();
      expect(finalProgress.totalAgents).toBeGreaterThan(0);

      // Should demonstrate error resilience (no catastrophic failures)
      const failedResults = response.toolResults?.filter(r => !r.success && r.catastrophicFailure);
      expect(failedResults?.length || 0).toBe(0);
    });

    it('should demonstrate sequential fallback when parallel execution fails', async () => {
      // Force parallel execution to fail for overload simulation
      const originalExecuteToolsInParallelWithRetry = orchestratorAgent.executeToolsInParallelWithRetry.bind(orchestratorAgent);
      
      let callCount = 0;
      orchestratorAgent.executeToolsInParallelWithRetry = jest.fn().mockImplementation(async (toolCalls, sessionId, reasoning) => {
        callCount++;
        
        // First call - simulate parallel overload for some tools
        if (callCount === 1) {
          const results = toolCalls.map((toolCall, index) => ({
            toolCall,
            success: index < 2, // First 2 succeed, rest fail with overload
            error: index >= 2 ? 'Parallel overload detected' : null,
            result: index < 2 ? { success: true, result: 'Parallel success' } : null
          }));
          return results;
        }
        
        // Subsequent calls - use original implementation
        return originalExecuteToolsInParallelWithRetry(toolCalls, sessionId, reasoning);
      });

      const toolCalls = [
        { name: 'task_reportProgress', input: { status: 'start' } },
        { name: 'task_reportProgress', input: { status: 'middle' } },
        { name: 'task_reportProgress', input: { status: 'overload1' } },
        { name: 'task_reportProgress', input: { status: 'overload2' } }
      ];

      const results = await orchestratorAgent.executeToolsInParallelWithRetry(
        toolCalls,
        'fallback-test',
        'testing sequential fallback'
      );

      expect(results).toHaveLength(4);
      
      // Should have some results marked as sequential fallback
      const fallbackResults = results.filter(r => r.sequentialFallback);
      expect(fallbackResults.length).toBeGreaterThan(0);

      // Restore original method
      orchestratorAgent.executeToolsInParallelWithRetry = originalExecuteToolsInParallelWithRetry;
    });
  });
});