// ABOUTME: Comprehensive tests for the contextual feedback system
// ABOUTME: Tests core feedback generation, commentary types, and event processing

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ContextualFeedback } from '../contextual-feedback';
import { FeedbackConfig, FeedbackContext, CommentaryType } from '../types';
import { ThreadEvent, EventType } from '~/threads/types';
import { ToolCall, ToolResult } from '~/tools/types';

describe('ContextualFeedback', () => {
  let feedback: ContextualFeedback;
  let config: FeedbackConfig;
  let context: FeedbackContext;
  let mockEventHandlers: any;

  beforeEach(() => {
    config = {
      verbosity: 'normal',
      timing: 'immediate',
      enabledTypes: ['action', 'performance', 'error', 'celebration'],
      showPerformanceMetrics: true,
      showPredictions: false,
      showInsights: true,
      maxFeedbacksPerMinute: 15,
      enableTennisBanter: false
    };

    context = {
      threadId: 'test-thread-123',
      agentState: 'idle',
      currentTool: undefined,
      turnMetrics: {
        startTime: new Date(),
        elapsedMs: 1000,
        tokensIn: 100,
        tokensOut: 50,
        turnId: 'turn-123'
      }
    };

    mockEventHandlers = {
      onFeedbackGenerated: vi.fn(),
      onInsightGenerated: vi.fn(),
      onPerformanceAnalysis: vi.fn(),
      onPredictiveInsight: vi.fn()
    };

    feedback = new ContextualFeedback(config, context);
    feedback.onFeedbackGenerated(mockEventHandlers.onFeedbackGenerated);
    feedback.onInsightGenerated(mockEventHandlers.onInsightGenerated);
    feedback.onPerformanceAnalysis(mockEventHandlers.onPerformanceAnalysis);
    feedback.onPredictiveInsight(mockEventHandlers.onPredictiveInsight);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with correct config and context', () => {
      expect(feedback).toBeDefined();
      expect(feedback.getSessionMetrics()).toEqual({
        startTime: expect.any(Date),
        totalTurns: 0,
        totalTime: 0,
        toolsUsed: expect.any(Map),
        errorsEncountered: [],
        successfulOperations: 0,
        responseTimeHistory: [],
        tokenUsageHistory: []
      });
    });

    it('should handle empty enabled types', () => {
      const emptyConfig = { ...config, enabledTypes: [] };
      const emptyFeedback = new ContextualFeedback(emptyConfig, context);
      
      const event: ThreadEvent = {
        id: 'test-event',
        threadId: 'test-thread',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'Test message'
      };

      emptyFeedback.processEvent(event);
      expect(emptyFeedback.getFeedbackHistory()).toHaveLength(0);
    });
  });

  describe('Event Processing', () => {
    it('should process USER_MESSAGE events', () => {
      const event: ThreadEvent = {
        id: 'test-event',
        threadId: 'test-thread',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'Test user message'
      };

      feedback.processEvent(event);
      
      expect(mockEventHandlers.onFeedbackGenerated).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'action',
          title: 'User Input',
          priority: 'high'
        })
      );
    });

    it('should process TOOL_CALL events', () => {
      const toolCall: ToolCall = {
        id: 'tool-123',
        name: 'bash',
        input: { command: 'ls -la' }
      };

      const event: ThreadEvent = {
        id: 'test-event',
        threadId: 'test-thread',
        type: 'TOOL_CALL',
        timestamp: new Date(),
        data: toolCall
      };

      feedback.processEvent(event);
      
      expect(mockEventHandlers.onFeedbackGenerated).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'action',
          title: 'Tool Execution',
          priority: 'medium'
        })
      );
    });

    it('should process TOOL_RESULT events', () => {
      const toolResult: ToolResult = {
        toolCallId: 'tool-123',
        success: true,
        output: 'Command executed successfully',
        error: undefined
      };

      const event: ThreadEvent = {
        id: 'test-event',
        threadId: 'test-thread',
        type: 'TOOL_RESULT',
        timestamp: new Date(),
        data: toolResult
      };

      feedback.processEvent(event);
      
      expect(mockEventHandlers.onFeedbackGenerated).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'performance',
          title: 'Tool Result',
          priority: 'medium'
        })
      );
    });

    it('should skip events when type is not enabled', () => {
      const restrictedConfig = { ...config, enabledTypes: ['error'] as CommentaryType[] };
      const restrictedFeedback = new ContextualFeedback(restrictedConfig, context);
      restrictedFeedback.onFeedbackGenerated(mockEventHandlers.onFeedbackGenerated);

      const event: ThreadEvent = {
        id: 'test-event',
        threadId: 'test-thread',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'Test message'
      };

      restrictedFeedback.processEvent(event);
      expect(mockEventHandlers.onFeedbackGenerated).not.toHaveBeenCalled();
    });
  });

  describe('Agent Event Processing', () => {
    it('should process agent thinking events', () => {
      feedback.processAgentEvent('agent_thinking_start', {});
      
      expect(mockEventHandlers.onFeedbackGenerated).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'action',
          title: 'Thinking Phase',
          priority: 'medium'
        })
      );
    });

    it('should process tool execution events', () => {
      const toolData = { toolName: 'file-read', input: { path: '/test.txt' } };
      
      feedback.processAgentEvent('tool_call_start', toolData);
      
      expect(mockEventHandlers.onFeedbackGenerated).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'action',
          title: 'Tool Execution',
          priority: 'medium'
        })
      );
    });

    it('should process error events', () => {
      const errorData = { error: new Error('Test error'), context: {} };
      
      feedback.processAgentEvent('error', errorData);
      
      expect(mockEventHandlers.onFeedbackGenerated).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          title: 'Error Occurred',
          priority: 'high'
        })
      );
    });

    it('should process turn completion events', () => {
      const turnData = { turnId: 'turn-123', metrics: context.turnMetrics };
      
      feedback.processAgentEvent('turn_complete', turnData);
      
      expect(mockEventHandlers.onFeedbackGenerated).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'celebration',
          title: 'Turn Complete',
          priority: 'high'
        })
      );
    });
  });

  describe('Tennis Commentary', () => {
    beforeEach(() => {
      const tennisConfig = { ...config, enableTennisBanter: true };
      feedback = new ContextualFeedback(tennisConfig, context);
      feedback.onFeedbackGenerated(mockEventHandlers.onFeedbackGenerated);
    });

    it('should generate tennis-style commentary when enabled', () => {
      feedback.processAgentEvent('agent_thinking_start', {});
      
      const call = mockEventHandlers.onFeedbackGenerated.mock.calls[0][0];
      expect(call.content).toMatch(/agent.*thinking|mental.*preparation|contemplative.*pause/i);
    });

    it('should include tennis terminology in tool execution', () => {
      const toolData = { toolName: 'bash', input: { command: 'ls' } };
      
      feedback.processAgentEvent('tool_call_start', toolData);
      
      const call = mockEventHandlers.onFeedbackGenerated.mock.calls[0][0];
      expect(call.content).toMatch(/execution|tactical|precision|timing/i);
    });

    it('should celebrate completions with tennis commentary', () => {
      const turnData = { turnId: 'turn-123', metrics: context.turnMetrics };
      
      feedback.processAgentEvent('turn_complete', turnData);
      
      const call = mockEventHandlers.onFeedbackGenerated.mock.calls[0][0];
      expect(call.content).toMatch(/magnificent|exceptional|outstanding|impressive/i);
    });
  });

  describe('Rate Limiting', () => {
    it('should respect maxFeedbacksPerMinute setting', () => {
      const limitedConfig = { ...config, maxFeedbacksPerMinute: 2 };
      const limitedFeedback = new ContextualFeedback(limitedConfig, context);
      limitedFeedback.onFeedbackGenerated(mockEventHandlers.onFeedbackGenerated);

      // Generate 3 feedbacks quickly
      for (let i = 0; i < 3; i++) {
        limitedFeedback.processAgentEvent('agent_thinking_start', {});
      }

      // Should only have 2 feedbacks due to rate limiting
      expect(mockEventHandlers.onFeedbackGenerated).toHaveBeenCalledTimes(2);
    });

    it('should handle batched timing', () => {
      const batchedConfig = { ...config, timing: 'batched' };
      const batchedFeedback = new ContextualFeedback(batchedConfig, context);
      batchedFeedback.onFeedbackGenerated(mockEventHandlers.onFeedbackGenerated);

      // First feedback should go through
      batchedFeedback.processAgentEvent('agent_thinking_start', {});
      expect(mockEventHandlers.onFeedbackGenerated).toHaveBeenCalledTimes(1);

      // Second feedback should be batched (not go through immediately)
      batchedFeedback.processAgentEvent('tool_call_start', { toolName: 'bash' });
      expect(mockEventHandlers.onFeedbackGenerated).toHaveBeenCalledTimes(1);
    });
  });

  describe('Performance Analysis', () => {
    it('should generate performance analysis', () => {
      const analysis = feedback.generatePerformanceAnalysis();
      
      expect(analysis).toHaveProperty('responseTimeAnalysis');
      expect(analysis).toHaveProperty('toolEfficiency');
      expect(analysis).toHaveProperty('conversationFlow');
      expect(analysis).toHaveProperty('resourceUsage');
      expect(mockEventHandlers.onPerformanceAnalysis).toHaveBeenCalledWith(analysis);
    });

    it('should track tool efficiency', () => {
      // Process some tool events
      const toolCall: ToolCall = {
        id: 'tool-123',
        name: 'bash',
        input: { command: 'ls' }
      };

      const toolResult: ToolResult = {
        toolCallId: 'tool-123',
        success: true,
        output: 'file1.txt file2.txt',
        error: undefined
      };

      feedback.processEvent({
        id: 'call-event',
        threadId: 'test-thread',
        type: 'TOOL_CALL',
        timestamp: new Date(),
        data: toolCall
      });

      feedback.processEvent({
        id: 'result-event',
        threadId: 'test-thread',
        type: 'TOOL_RESULT',
        timestamp: new Date(),
        data: toolResult
      });

      const analysis = feedback.generatePerformanceAnalysis();
      expect(analysis.toolEfficiency).toHaveLength(1);
      expect(analysis.toolEfficiency[0]).toHaveProperty('toolName', 'bash');
      expect(analysis.toolEfficiency[0]).toHaveProperty('successRate', 1);
    });
  });

  describe('Insights Generation', () => {
    it('should generate insights for error patterns', () => {
      // Generate multiple errors to trigger pattern detection
      for (let i = 0; i < 3; i++) {
        const errorResult: ToolResult = {
          toolCallId: `tool-${i}`,
          success: false,
          output: '',
          error: 'File not found'
        };

        feedback.processEvent({
          id: `error-event-${i}`,
          threadId: 'test-thread',
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: errorResult
        });
      }

      // Should trigger insight generation
      expect(mockEventHandlers.onInsightGenerated).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'error',
          title: 'Recurring Error Pattern',
          actionable: true
        })
      );
    });

    it('should generate performance insights', () => {
      // Simulate slow response times
      const slowTimes = [5000, 6000, 7000, 8000, 9000, 10000];
      slowTimes.forEach(time => {
        feedback.processEvent({
          id: `slow-event-${time}`,
          threadId: 'test-thread',
          type: 'USER_MESSAGE',
          timestamp: new Date(),
          data: 'test'
        }, {
          turnMetrics: {
            startTime: new Date(),
            elapsedMs: time,
            tokensIn: 100,
            tokensOut: 50,
            turnId: `turn-${time}`
          }
        });
      });

      // Should trigger performance insight
      expect(mockEventHandlers.onInsightGenerated).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'performance',
          title: 'Performance Degradation',
          actionable: true
        })
      );
    });
  });

  describe('Configuration Updates', () => {
    it('should update configuration', () => {
      const newConfig = { verbosity: 'verbose' as const, enableTennisBanter: true };
      
      feedback.updateConfig(newConfig);
      
      // Test that new config is applied (tennis banter should now work)
      feedback.processAgentEvent('agent_thinking_start', {});
      
      const call = mockEventHandlers.onFeedbackGenerated.mock.calls[0][0];
      expect(call.content).toMatch(/agent.*thinking|mental.*preparation|contemplative.*pause/i);
    });

    it('should update context', () => {
      const newContext = { agentState: 'thinking', currentTool: 'bash' };
      
      feedback.updateContext(newContext);
      
      feedback.processAgentEvent('agent_thinking_start', {});
      
      const call = mockEventHandlers.onFeedbackGenerated.mock.calls[0][0];
      expect(call.context).toMatchObject(newContext);
    });
  });

  describe('History Management', () => {
    it('should maintain feedback history', () => {
      feedback.processAgentEvent('agent_thinking_start', {});
      feedback.processAgentEvent('tool_call_start', { toolName: 'bash' });
      feedback.processAgentEvent('turn_complete', { turnId: 'turn-123' });

      const history = feedback.getFeedbackHistory();
      expect(history).toHaveLength(3);
      expect(history[0]).toHaveProperty('type', 'action');
      expect(history[0]).toHaveProperty('title', 'Thinking Phase');
    });

    it('should provide session metrics', () => {
      feedback.processAgentEvent('turn_complete', { turnId: 'turn-123' });

      const metrics = feedback.getSessionMetrics();
      expect(metrics.totalTurns).toBe(1);
      expect(metrics.startTime).toBeInstanceOf(Date);
      expect(metrics.toolsUsed).toBeInstanceOf(Map);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed events gracefully', () => {
      const malformedEvent = {
        id: 'bad-event',
        threadId: 'test-thread',
        type: 'UNKNOWN_TYPE' as EventType,
        timestamp: new Date(),
        data: null
      };

      expect(() => {
        feedback.processEvent(malformedEvent);
      }).not.toThrow();
    });

    it('should handle missing context gracefully', () => {
      const feedbackWithMinimalContext = new ContextualFeedback(config, { threadId: 'test' });
      
      expect(() => {
        feedbackWithMinimalContext.processAgentEvent('agent_thinking_start', {});
      }).not.toThrow();
    });

    it('should handle invalid tool data gracefully', () => {
      expect(() => {
        feedback.processAgentEvent('tool_call_start', { invalidData: true });
      }).not.toThrow();
    });
  });
});