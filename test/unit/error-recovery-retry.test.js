// ABOUTME: Tests for error recovery and retry logic in parallel tool execution system
// ABOUTME: Validates automatic retry, exponential backoff, circuit breaker, and fallback strategies

import { jest } from '@jest/globals';
import { Agent } from '../../src/agents/agent.js';
import { ToolRegistry } from '../../src/tools/tool-registry.js';

describe('Error Recovery and Retry Logic', () => {
  let agent;
  let mockModelProvider;
  let mockToolRegistry;
  let mockTools;

  beforeEach(() => {
    // Mock tools that can fail/succeed
    mockTools = {
      flaky_tool: {
        callTool: jest.fn(),
        getSchema: () => ({
          name: 'flaky_tool',
          description: 'A tool that sometimes fails',
          methods: {
            execute: {
              description: 'Execute flaky operation',
              parameters: {}
            }
          }
        })
      },
      reliable_tool: {
        callTool: jest.fn().mockResolvedValue({
          success: true,
          result: 'Always works'
        }),
        getSchema: () => ({
          name: 'reliable_tool', 
          description: 'A tool that always works',
          methods: {
            execute: {
              description: 'Execute reliable operation',
              parameters: {}
            }
          }
        })
      }
    };

    mockToolRegistry = {
      listTools: () => ['flaky_tool', 'reliable_tool'],
      get: (name) => mockTools[name],
      callTool: (toolName, methodName, params, sessionId, agent) => {
        return mockTools[toolName].callTool(methodName, params, sessionId, agent);
      },
      getToolSchema: (name) => mockTools[name]?.getSchema()
    };

    mockModelProvider = {
      chat: jest.fn().mockResolvedValue({
        success: true,
        content: 'Test response',
        toolCalls: [],
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }
      })
    };

    agent = new Agent({
      tools: mockToolRegistry,
      modelProvider: mockModelProvider,
      maxConcurrentTools: 3,
      verbose: false
    });
  });

  describe('Automatic Retry with Exponential Backoff', () => {
    it('should retry transient failures with exponential backoff', async () => {
      // First two calls fail, third succeeds
      mockTools.flaky_tool.callTool
        .mockRejectedValueOnce(new Error('Transient network error'))
        .mockRejectedValueOnce(new Error('Temporary unavailable'))
        .mockResolvedValueOnce({ success: true, result: 'Finally worked' });

      const toolCalls = [{
        name: 'flaky_tool_execute',
        input: { test: 'data' }
      }];

      const startTime = Date.now();
      const results = await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'test reasoning');
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].result.result).toBe('Finally worked');
      expect(results[0].retryAttempts).toBe(2);
      expect(results[0].totalRetryDelay).toBeGreaterThan(0);
      
      // Should have exponential backoff delay (at least 100ms + 200ms = 300ms)
      expect(duration).toBeGreaterThan(300);
      
      expect(mockTools.flaky_tool.callTool).toHaveBeenCalledTimes(3);
    });

    it('should give up after max retry attempts', async () => {
      // Always fail
      mockTools.flaky_tool.callTool.mockRejectedValue(new Error('Persistent failure'));

      const toolCalls = [{
        name: 'flaky_tool_execute',
        input: { test: 'data' }
      }];

      const results = await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'test reasoning');

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Persistent failure');
      expect(results[0].retryAttempts).toBe(3); // Default max retries
      expect(results[0].finalFailure).toBe(true);
      
      expect(mockTools.flaky_tool.callTool).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it('should use configurable retry settings', async () => {
      agent.retryConfig = {
        maxRetries: 2,
        baseDelay: 50,
        maxDelay: 500,
        backoffMultiplier: 2
      };

      mockTools.flaky_tool.callTool.mockRejectedValue(new Error('Always fails'));

      const toolCalls = [{
        name: 'flaky_tool_execute', 
        input: {}
      }];

      const results = await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'test reasoning');

      expect(results[0].retryAttempts).toBe(2);
      expect(mockTools.flaky_tool.callTool).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should not retry non-transient errors', async () => {
      // Authentication/permission errors should not be retried
      mockTools.flaky_tool.callTool.mockRejectedValue(new Error('Authentication failed'));

      const toolCalls = [{
        name: 'flaky_tool_execute',
        input: {}
      }];

      const results = await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'test reasoning');

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Authentication failed');
      expect(results[0].retryAttempts).toBe(0);
      expect(results[0].nonRetriable).toBe(true);
      
      expect(mockTools.flaky_tool.callTool).toHaveBeenCalledTimes(1); // No retries
    });
  });

  describe('Circuit Breaker Pattern', () => {
    it('should open circuit after consecutive failures', async () => {
      // Fail multiple times to trigger circuit breaker
      mockTools.flaky_tool.callTool.mockRejectedValue(new Error('Service down'));

      const toolCalls = Array(5).fill().map((_, i) => ({
        name: 'flaky_tool_execute',
        input: { attempt: i }
      }));

      const results = await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'test reasoning');

      // First few should attempt retries, later ones should be circuit-broken
      const circuitBrokenResults = results.filter(r => r.circuitBroken);
      expect(circuitBrokenResults.length).toBeGreaterThan(0);

      // Circuit breaker should prevent some calls
      expect(mockTools.flaky_tool.callTool.mock.calls.length).toBeLessThan(20); // 5 tools × 4 attempts each
    });

    it('should close circuit after successful call following half-open state', async () => {
      // Setup mock to succeed on the recovery attempt
      mockTools.flaky_tool.callTool
        .mockReset()
        .mockResolvedValue({ success: true, result: 'Recovery' });

      // Force circuit breaker state
      agent.circuitBreaker.set('flaky_tool', {
        state: 'half-open',
        failures: 3,
        lastFailure: Date.now() - 31000, // 31 seconds ago
        nextAttempt: Date.now() - 1000
      });

      const toolCalls = [{
        name: 'flaky_tool_execute',
        input: {}
      }];

      const results = await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'test reasoning');

      expect(results[0].success).toBe(true);
      expect(results[0].circuitRecovered).toBe(true);
      expect(agent.circuitBreaker.get('flaky_tool').state).toBe('closed');
    });

    it('should provide circuit breaker statistics', async () => {
      // Trigger some failures
      mockTools.flaky_tool.callTool.mockRejectedValue(new Error('Service issues'));

      const toolCalls = [{
        name: 'flaky_tool_execute',
        input: {}
      }];

      await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'test reasoning');

      const stats = agent.getCircuitBreakerStats();
      expect(stats).toBeDefined();
      expect(stats.flaky_tool).toBeDefined();
      expect(stats.flaky_tool.failures).toBeGreaterThan(0);
      expect(stats.flaky_tool.state).toMatch(/open|closed|half-open/);
    });
  });

  describe('Fallback Strategies', () => {
    it('should retry sequentially when parallel execution fails', async () => {
      // Make parallel execution fail for multiple tools
      mockTools.flaky_tool.callTool
        .mockRejectedValueOnce(new Error('Parallel overload'))
        .mockResolvedValueOnce({ success: true, result: 'Sequential success' });

      const toolCalls = [
        { name: 'flaky_tool_execute', input: { id: 1 } },
        { name: 'reliable_tool_execute', input: { id: 2 } }
      ];

      const results = await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'test reasoning');

      expect(results).toHaveLength(2);
      
      // Should have attempted sequential fallback
      const sequentialResult = results.find(r => r.sequentialFallback);
      expect(sequentialResult).toBeDefined();
    });

    it('should use degraded execution when some tools consistently fail', async () => {
      mockTools.flaky_tool.callTool.mockRejectedValue(new Error('Consistently failing'));

      const toolCalls = [
        { name: 'flaky_tool_execute', input: {} },
        { name: 'reliable_tool_execute', input: {} }
      ];

      const results = await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'test reasoning');

      expect(results).toHaveLength(2);
      
      // Reliable tool should succeed
      const successResult = results.find(r => r.success);
      expect(successResult).toBeDefined();
      
      // Failed tool should be marked for degraded execution
      const failedResult = results.find(r => !r.success);
      expect(failedResult.degradedExecution).toBe(true);
    });

    it('should continue with successful tools when others fail', async () => {
      mockTools.flaky_tool.callTool.mockRejectedValue(new Error('Total failure'));

      const toolCalls = [
        { name: 'flaky_tool_execute', input: {} },
        { name: 'reliable_tool_execute', input: {} },
        { name: 'reliable_tool_execute', input: { second: true } }
      ];

      const results = await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'test reasoning');

      expect(results).toHaveLength(3);
      
      const successfulResults = results.filter(r => r.success);
      const failedResults = results.filter(r => !r.success);
      
      expect(successfulResults).toHaveLength(2); // Two reliable tools
      expect(failedResults).toHaveLength(1); // One flaky tool
      
      expect(results[0].gracefulDegradation).toBe(true);
    });
  });

  describe('Error Aggregation and Reporting', () => {
    it('should distinguish between tool-specific and systemic errors', async () => {
      // Tool-specific error
      mockTools.flaky_tool.callTool.mockRejectedValue(new Error('Tool validation failed'));
      // Systemic error (network/infrastructure)  
      mockTools.reliable_tool.callTool.mockRejectedValue(new Error('Network timeout'));

      const toolCalls = [
        { name: 'flaky_tool_execute', input: {} },
        { name: 'reliable_tool_execute', input: {} }
      ];

      const results = await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'test reasoning');

      const errorAnalysis = agent.analyzeExecutionErrors(results);
      
      expect(errorAnalysis.toolSpecificErrors).toHaveLength(1);
      expect(errorAnalysis.systemicErrors).toHaveLength(1);
      expect(errorAnalysis.recommendations).toEqual(
        expect.arrayContaining([
          expect.stringContaining('tool-specific'),
          expect.stringContaining('infrastructure')
        ])
      );
    });

    it('should provide actionable error information for recovery', async () => {
      mockTools.flaky_tool.callTool.mockRejectedValue(new Error('Rate limit exceeded'));

      const toolCalls = [{
        name: 'flaky_tool_execute',
        input: {}
      }];

      const results = await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'test reasoning');

      expect(results[0].actionableError).toBeDefined();
      expect(results[0].actionableError.category).toBe('rate_limit');
      expect(results[0].actionableError.suggestion).toContain('wait');
      expect(results[0].actionableError.retryAfter).toBeGreaterThan(0);
    });

    it('should track error patterns across multiple executions', async () => {
      // Simulate multiple execution rounds
      mockTools.flaky_tool.callTool.mockRejectedValue(new Error('Service degraded'));

      for (let i = 0; i < 3; i++) {
        const toolCalls = [{ name: 'flaky_tool_execute', input: { round: i } }];
        await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'test reasoning');
      }

      const errorPatterns = agent.getErrorPatterns();
      expect(errorPatterns.flaky_tool).toBeDefined();
      expect(errorPatterns.flaky_tool.frequency).toBeGreaterThan(0);
      expect(errorPatterns.flaky_tool.pattern).toBe('degraded_service');
    });
  });

  describe('Configuration and Tuning', () => {
    it('should allow custom retry configuration per tool', async () => {
      agent.setToolRetryConfig('flaky_tool', {
        maxRetries: 5,
        baseDelay: 25,
        backoffMultiplier: 1.5
      });

      mockTools.flaky_tool.callTool.mockRejectedValue(new Error('Custom retry test'));

      const toolCalls = [{
        name: 'flaky_tool_execute',
        input: {}
      }];

      const results = await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'test reasoning');

      expect(results[0].retryAttempts).toBe(5);
      expect(mockTools.flaky_tool.callTool).toHaveBeenCalledTimes(6); // Initial + 5 retries
    });

    it('should allow disabling retry for specific tools', async () => {
      agent.setToolRetryConfig('flaky_tool', { enabled: false });

      mockTools.flaky_tool.callTool.mockRejectedValue(new Error('No retry test'));

      const toolCalls = [{
        name: 'flaky_tool_execute',
        input: {}
      }];

      const results = await agent.executeToolsInParallelWithRetry(toolCalls, 'test-session', 'test reasoning');

      expect(results[0].retryAttempts).toBe(0);
      expect(results[0].retryDisabled).toBe(true);
      expect(mockTools.flaky_tool.callTool).toHaveBeenCalledTimes(1);
    });
  });
});