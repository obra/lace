// ABOUTME: Core contextual feedback system providing tennis commentary style insights
// ABOUTME: Analyzes development patterns and provides real-time intelligent commentary

import { EventEmitter } from 'events';
import { 
  FeedbackConfig, 
  FeedbackContext, 
  FeedbackEvent, 
  FeedbackInsight, 
  PerformanceAnalysis, 
  PredictiveInsight,
  CommentaryType,
  FeedbackEventHandlers
} from './types';
import { logger } from '~/utils/logger';
import { ThreadEvent } from '~/threads/types';
import { ToolCall, ToolResult } from '~/tools/types';
import { CurrentTurnMetrics } from '~/agents/agent';

export interface SessionMetrics {
  startTime: Date;
  totalTurns: number;
  totalTime: number;
  toolsUsed: Map<string, number>;
  errorsEncountered: string[];
  successfulOperations: number;
  responseTimeHistory: number[];
  tokenUsageHistory: number[];
}

interface PatternTracker {
  toolSequences: string[][];
  errorPatterns: Map<string, number>;
  performancePatterns: Map<string, number[]>;
  contextSwitches: number;
  backtrackingEvents: number;
}

export class ContextualFeedback extends EventEmitter {
  private _config: FeedbackConfig;
  private _context: FeedbackContext;
  private _sessionMetrics: SessionMetrics;
  private _patternTracker: PatternTracker;
  private _feedbackHistory: FeedbackEvent[] = [];
  private _lastFeedbackTime: Date = new Date();
  private _feedbackThisMinute: number = 0;
  private _minuteTracker: Date = new Date();
  private _eventHandlers: Partial<FeedbackEventHandlers> = {};

  constructor(config: FeedbackConfig, context: FeedbackContext) {
    super();
    this._config = config;
    this._context = context;
    this._sessionMetrics = {
      startTime: new Date(),
      totalTurns: 0,
      totalTime: 0,
      toolsUsed: new Map(),
      errorsEncountered: [],
      successfulOperations: 0,
      responseTimeHistory: [],
      tokenUsageHistory: []
    };
    this._patternTracker = {
      toolSequences: [],
      errorPatterns: new Map(),
      performancePatterns: new Map(),
      contextSwitches: 0,
      backtrackingEvents: 0
    };

    logger.info('ContextualFeedback initialized', {
      threadId: context.threadId,
      verbosity: config.verbosity,
      enabledTypes: config.enabledTypes
    });
  }

  // Event handlers registration
  onFeedbackGenerated(handler: (event: FeedbackEvent) => void): void {
    this._eventHandlers.onFeedbackGenerated = handler;
  }

  onInsightGenerated(handler: (insight: FeedbackInsight) => void): void {
    this._eventHandlers.onInsightGenerated = handler;
  }

  onPerformanceAnalysis(handler: (analysis: PerformanceAnalysis) => void): void {
    this._eventHandlers.onPerformanceAnalysis = handler;
  }

  onPredictiveInsight(handler: (insight: PredictiveInsight) => void): void {
    this._eventHandlers.onPredictiveInsight = handler;
  }

  // Main entry point for processing events
  processEvent(event: ThreadEvent, additionalContext?: Partial<FeedbackContext>): void {
    if (!this._shouldProcessEvent()) {
      return;
    }

    // Update context with additional info
    this._updateContext(additionalContext);

    // Update session metrics
    this._updateSessionMetrics(event);

    // Generate contextual feedback based on event type
    this._generateContextualFeedback(event);

    // Update pattern tracking
    this._updatePatternTracking(event);

    // Check for insights and predictions
    this._checkForInsights();
    this._generatePredictions();

    logger.debug('ContextualFeedback processed event', {
      eventType: event.type,
      feedbacksGenerated: this._feedbackHistory.length,
      threadId: this._context.threadId
    });
  }

  // Process agent-specific events
  processAgentEvent(eventType: string, data: any): void {
    if (!this._shouldProcessEvent()) {
      return;
    }

    switch (eventType) {
      case 'agent_thinking_start':
        this._generateFeedback('action', 'Thinking Phase', 
          this._getTennisCommentary('thinking_start'), 'medium');
        break;
      case 'tool_call_start':
        this._generateFeedback('action', 'Tool Execution', 
          this._getTennisCommentary('tool_start', data), 'medium');
        break;
      case 'tool_call_complete':
        this._generateFeedback('action', 'Tool Complete', 
          this._getTennisCommentary('tool_complete', data), 'medium');
        break;
      case 'turn_start':
        this._generateFeedback('action', 'New Turn', 
          this._getTennisCommentary('turn_start', data), 'high');
        break;
      case 'turn_complete':
        this._generateFeedback('celebration', 'Turn Complete', 
          this._getTennisCommentary('turn_complete', data), 'high');
        break;
      case 'error':
        this._generateFeedback('error', 'Error Occurred', 
          this._getTennisCommentary('error', data), 'high');
        break;
      case 'retry_attempt':
        this._generateFeedback('performance', 'Retry Attempt', 
          this._getTennisCommentary('retry', data), 'medium');
        break;
    }
  }

  // Generate performance analysis
  generatePerformanceAnalysis(): PerformanceAnalysis {
    const analysis: PerformanceAnalysis = {
      responseTimeAnalysis: {
        current: this._sessionMetrics.responseTimeHistory.slice(-1)[0] || 0,
        average: this._calculateAverage(this._sessionMetrics.responseTimeHistory),
        trend: this._calculateTrend(this._sessionMetrics.responseTimeHistory),
        percentile95: this._calculatePercentile(this._sessionMetrics.responseTimeHistory, 0.95)
      },
      toolEfficiency: this._analyzeToolEfficiency(),
      conversationFlow: {
        turnsPerMinute: this._calculateTurnsPerMinute(),
        contextSwitches: this._patternTracker.contextSwitches,
        backtrackingEvents: this._patternTracker.backtrackingEvents
      },
      resourceUsage: {
        tokenUsage: this._sessionMetrics.tokenUsageHistory.reduce((a, b) => a + b, 0),
        tokenEfficiency: this._calculateTokenEfficiency()
      }
    };

    if (this._eventHandlers.onPerformanceAnalysis) {
      this._eventHandlers.onPerformanceAnalysis(analysis);
    }

    return analysis;
  }

  // Configuration updates
  updateConfig(config: Partial<FeedbackConfig>): void {
    this._config = { ...this._config, ...config };
    logger.info('ContextualFeedback config updated', { 
      threadId: this._context.threadId, 
      newConfig: config 
    });
  }

  updateContext(context: Partial<FeedbackContext>): void {
    this._context = { ...this._context, ...context };
  }

  // Get current state
  getFeedbackHistory(): FeedbackEvent[] {
    return [...this._feedbackHistory];
  }

  getSessionMetrics(): SessionMetrics {
    return { ...this._sessionMetrics };
  }

  // Private helper methods

  private _shouldProcessEvent(): boolean {
    const now = new Date();
    
    // Reset minute counter
    if (now.getMinutes() !== this._minuteTracker.getMinutes()) {
      this._feedbackThisMinute = 0;
      this._minuteTracker = now;
    }

    // Check rate limiting
    if (this._feedbackThisMinute >= this._config.maxFeedbacksPerMinute) {
      return false;
    }

    // Check timing preference
    if (this._config.timing === 'batched') {
      const timeSinceLastFeedback = now.getTime() - this._lastFeedbackTime.getTime();
      if (timeSinceLastFeedback < 5000) { // 5 second batching
        return false;
      }
    }

    return true;
  }

  private _updateContext(additionalContext?: Partial<FeedbackContext>): void {
    if (additionalContext) {
      this._context = { ...this._context, ...additionalContext };
    }
  }

  private _updateSessionMetrics(event: ThreadEvent): void {
    this._sessionMetrics.totalTurns++;
    
    if (event.type === 'TOOL_CALL') {
      const toolCall = event.data as ToolCall;
      const count = this._sessionMetrics.toolsUsed.get(toolCall.name) || 0;
      this._sessionMetrics.toolsUsed.set(toolCall.name, count + 1);
    }

    if (event.type === 'TOOL_RESULT') {
      const toolResult = event.data as ToolResult;
      if (!toolResult.isError) {
        this._sessionMetrics.successfulOperations++;
      } else {
        // Extract error message from content blocks
        const errorMessage = toolResult.content.find(block => block.type === 'text')?.text || 'Unknown error';
        this._sessionMetrics.errorsEncountered.push(errorMessage);
      }
    }
  }

  private _generateContextualFeedback(event: ThreadEvent): void {
    const eventType = event.type;
    let commentaryType: CommentaryType = 'action';
    let title = '';
    let content = '';
    let priority: 'low' | 'medium' | 'high' = 'medium';

    switch (eventType) {
      case 'USER_MESSAGE':
        commentaryType = 'action';
        title = 'User Input';
        content = this._getTennisCommentary('user_message', event.data);
        priority = 'high';
        break;
      case 'AGENT_MESSAGE':
        commentaryType = 'action';
        title = 'Agent Response';
        content = this._getTennisCommentary('agent_message', event.data);
        priority = 'high';
        break;
      case 'TOOL_CALL':
        commentaryType = 'action';
        title = 'Tool Execution';
        content = this._getTennisCommentary('tool_call', event.data);
        priority = 'medium';
        break;
      case 'TOOL_RESULT':
        commentaryType = 'performance';
        title = 'Tool Result';
        content = this._getTennisCommentary('tool_result', event.data);
        priority = 'medium';
        break;
      default:
        return; // Skip unknown event types
    }

    this._generateFeedback(commentaryType, title, content, priority);
  }

  private _generateFeedback(
    type: CommentaryType, 
    title: string, 
    content: string, 
    priority: 'low' | 'medium' | 'high'
  ): void {
    if (!this._config.enabledTypes.includes(type)) {
      return;
    }

    const feedback: FeedbackEvent = {
      id: `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      type,
      title,
      content,
      context: { ...this._context },
      priority,
      tags: this._generateTags(type, title),
      metadata: {
        sessionTime: Date.now() - this._sessionMetrics.startTime.getTime(),
        turnCount: this._sessionMetrics.totalTurns
      }
    };

    this._feedbackHistory.push(feedback);
    this._feedbackThisMinute++;
    this._lastFeedbackTime = new Date();

    // Emit event
    this.emit('feedback_generated', feedback);
    
    if (this._eventHandlers.onFeedbackGenerated) {
      this._eventHandlers.onFeedbackGenerated(feedback);
    }

    logger.debug('Feedback generated', {
      type,
      title,
      priority,
      threadId: this._context.threadId
    });
  }

  private _getTennisCommentary(eventType: string, data?: any): string {
    if (!this._config.enableTennisBanter) {
      return this._getStandardCommentary(eventType, data);
    }

    const commentaries: Record<string, string[]> = {
      thinking_start: [
        "And here we see the agent entering deep thought mode - the mental preparation phase!",
        "The agent is analyzing the situation, calculating the best approach forward.",
        "Notice the contemplative pause - this is where the magic happens in AI reasoning."
      ],
      tool_start: [
        `A powerful ${data?.toolName || 'tool'} execution is underway - precision is key here!`,
        `The agent has selected ${data?.toolName || 'a tool'} - an interesting tactical choice!`,
        `Watch this ${data?.toolName || 'tool'} execution - timing and accuracy are everything.`
      ],
      tool_complete: [
        `Excellent execution! The ${data?.toolName || 'tool'} delivered exactly what was needed.`,
        `That's a clean completion - ${data?.toolName || 'tool'} performed flawlessly.`,
        `Beautiful work! The ${data?.toolName || 'tool'} operation was executed with precision.`
      ],
      turn_start: [
        "A new turn begins - the agent is ready to tackle the next challenge!",
        "Fresh turn, fresh possibilities - let's see what strategic moves unfold.",
        "The game continues with renewed energy - exciting developments ahead!"
      ],
      turn_complete: [
        "What a magnificent turn! The agent has delivered exceptional results.",
        "That's a wrap on another successful turn - impressive performance throughout.",
        "Outstanding completion! The agent has once again proven its capabilities."
      ],
      error: [
        "A minor setback, but watch how the agent adapts and recovers gracefully.",
        "Every champion faces challenges - it's the recovery that defines greatness.",
        "An unexpected twist! Let's see how the agent handles this curveball."
      ],
      retry: [
        "Persistence pays off - the agent is making another attempt with renewed focus.",
        "Second chances often lead to better outcomes - patience is a virtue here.",
        "The agent is demonstrating resilience - this is what separates good from great."
      ]
    };

    const options = commentaries[eventType] || ["The agent continues its impressive performance."];
    return options[Math.floor(Math.random() * options.length)];
  }

  private _getStandardCommentary(eventType: string, data?: any): string {
    const commentaries: Record<string, string> = {
      thinking_start: "Agent is processing and analyzing the request.",
      tool_start: `Executing ${data?.toolName || 'tool'} operation.`,
      tool_complete: `${data?.toolName || 'Tool'} operation completed successfully.`,
      turn_start: "Starting new conversation turn.",
      turn_complete: "Turn completed successfully.",
      error: "Error encountered, analyzing and handling.",
      retry: "Retrying operation after temporary failure."
    };

    return commentaries[eventType] || "Operation in progress.";
  }

  private _updatePatternTracking(event: ThreadEvent): void {
    if (event.type === 'TOOL_CALL') {
      const toolCall = event.data as ToolCall;
      this._patternTracker.toolSequences.push([toolCall.name]);
      
      // Track tool sequences
      if (this._patternTracker.toolSequences.length > 1) {
        const lastSequence = this._patternTracker.toolSequences[this._patternTracker.toolSequences.length - 2];
        if (lastSequence[0] !== toolCall.name) {
          this._patternTracker.contextSwitches++;
        }
      }
    }

    if (event.type === 'TOOL_RESULT') {
      const toolResult = event.data as ToolResult;
      if (toolResult.isError) {
        const errorMessage = toolResult.content.find(block => block.type === 'text')?.text || 'unknown_error';
        const count = this._patternTracker.errorPatterns.get(errorMessage) || 0;
        this._patternTracker.errorPatterns.set(errorMessage, count + 1);
      }
    }
  }

  private _checkForInsights(): void {
    // Pattern-based insights
    if (this._patternTracker.errorPatterns.size > 0) {
      const mostCommonError = [...this._patternTracker.errorPatterns.entries()]
        .sort((a, b) => b[1] - a[1])[0];
      
      if (mostCommonError[1] > 2) { // More than 2 occurrences
        this._generateInsight('error', `Recurring Error Pattern`, 
          `The error "${mostCommonError[0]}" has occurred ${mostCommonError[1]} times.`, 
          0.8, true, 'medium');
      }
    }

    // Performance insights
    if (this._sessionMetrics.responseTimeHistory.length > 5) {
      const recentAverage = this._calculateAverage(this._sessionMetrics.responseTimeHistory.slice(-5));
      const overallAverage = this._calculateAverage(this._sessionMetrics.responseTimeHistory);
      
      if (recentAverage > overallAverage * 1.5) {
        this._generateInsight('performance', 'Performance Degradation', 
          'Recent response times are significantly slower than average.', 
          0.7, true, 'high');
      }
    }
  }

  private _generatePredictions(): void {
    // Predict potential issues based on current patterns
    const predictions = this._analyzePatterns();
    
    predictions.forEach(prediction => {
      const insight: PredictiveInsight = {
        prediction: prediction.description,
        confidence: prediction.confidence,
        timeframe: prediction.timeframe as 'immediate' | 'short' | 'medium' | 'long',
        factors: prediction.factors,
        actionable: prediction.actionable,
        preventionSuggestions: prediction.suggestions
      };

      if (this._eventHandlers.onPredictiveInsight) {
        this._eventHandlers.onPredictiveInsight(insight);
      }
    });
  }

  private _generateInsight(
    category: 'pattern' | 'performance' | 'error' | 'optimization' | 'prediction',
    title: string,
    description: string,
    confidence: number,
    actionable: boolean,
    impact: 'low' | 'medium' | 'high'
  ): void {
    const insight: FeedbackInsight = {
      id: `insight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      category,
      title,
      description,
      confidence,
      actionable,
      impact,
      recommendations: this._generateRecommendations(category, title),
      relatedEvents: this._findRelatedEvents(category, title)
    };

    this.emit('insight_generated', insight);
    
    if (this._eventHandlers.onInsightGenerated) {
      this._eventHandlers.onInsightGenerated(insight);
    }

    logger.info('Insight generated', {
      category,
      title,
      confidence,
      threadId: this._context.threadId
    });
  }

  private _generateTags(type: CommentaryType, title: string): string[] {
    const tags: string[] = [type];
    
    if (title.includes('Tool')) tags.push('tool');
    if (title.includes('Error')) tags.push('error');
    if (title.includes('Performance')) tags.push('performance');
    if (title.includes('Turn')) tags.push('turn');
    
    return tags;
  }

  private _calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  }

  private _calculateTrend(numbers: number[]): 'improving' | 'stable' | 'degrading' {
    if (numbers.length < 3) return 'stable';
    
    const recent = numbers.slice(-3);
    const earlier = numbers.slice(-6, -3);
    
    if (earlier.length === 0) return 'stable';
    
    const recentAvg = this._calculateAverage(recent);
    const earlierAvg = this._calculateAverage(earlier);
    
    if (recentAvg < earlierAvg * 0.9) return 'improving';
    if (recentAvg > earlierAvg * 1.1) return 'degrading';
    return 'stable';
  }

  private _calculatePercentile(numbers: number[], percentile: number): number {
    if (numbers.length === 0) return 0;
    
    const sorted = [...numbers].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[index];
  }

  private _analyzeToolEfficiency(): PerformanceAnalysis['toolEfficiency'] {
    const efficiency: PerformanceAnalysis['toolEfficiency'] = [];
    
    for (const [toolName, count] of this._sessionMetrics.toolsUsed) {
      const errorCount = this._patternTracker.errorPatterns.get(toolName) || 0;
      const successRate = count > 0 ? (count - errorCount) / count : 1;
      
      efficiency.push({
        toolName,
        successRate,
        averageTime: 0, // Would need timing data
        errorPatterns: this._getErrorPatternsForTool(toolName)
      });
    }
    
    return efficiency;
  }

  private _calculateTurnsPerMinute(): number {
    const sessionTimeMs = Date.now() - this._sessionMetrics.startTime.getTime();
    const sessionMinutes = sessionTimeMs / (1000 * 60);
    return sessionMinutes > 0 ? this._sessionMetrics.totalTurns / sessionMinutes : 0;
  }

  private _calculateTokenEfficiency(): number {
    const totalTokens = this._sessionMetrics.tokenUsageHistory.reduce((a, b) => a + b, 0);
    const successfulOps = this._sessionMetrics.successfulOperations;
    return successfulOps > 0 ? totalTokens / successfulOps : 0;
  }

  private _getErrorPatternsForTool(toolName: string): string[] {
    const patterns: string[] = [];
    for (const [error, count] of this._patternTracker.errorPatterns) {
      if (error.includes(toolName) && count > 1) {
        patterns.push(error);
      }
    }
    return patterns;
  }

  private _analyzePatterns(): Array<{
    description: string;
    confidence: number;
    timeframe: string;
    factors: string[];
    actionable: boolean;
    suggestions: string[];
  }> {
    const predictions = [];
    
    // Analyze error patterns
    if (this._patternTracker.errorPatterns.size > 0) {
      predictions.push({
        description: 'Higher error rates detected, potential stability issues ahead',
        confidence: 0.7,
        timeframe: 'short',
        factors: ['increasing error frequency', 'pattern repetition'],
        actionable: true,
        suggestions: ['Review error logs', 'Check system resources', 'Validate inputs']
      });
    }
    
    // Analyze performance trends
    const responseTimes = this._sessionMetrics.responseTimeHistory;
    if (responseTimes.length > 3) {
      const trend = this._calculateTrend(responseTimes);
      if (trend === 'degrading') {
        predictions.push({
          description: 'Performance may continue to degrade without intervention',
          confidence: 0.6,
          timeframe: 'medium',
          factors: ['increasing response times', 'resource constraints'],
          actionable: true,
          suggestions: ['Optimize tool usage', 'Review token usage', 'Consider caching']
        });
      }
    }
    
    return predictions;
  }

  private _generateRecommendations(category: string, title: string): string[] {
    const recommendations: string[] = [];
    
    switch (category) {
      case 'error':
        recommendations.push('Review error logs for patterns', 'Implement error handling', 'Validate inputs');
        break;
      case 'performance':
        recommendations.push('Monitor response times', 'Optimize tool usage', 'Consider caching');
        break;
      case 'pattern':
        recommendations.push('Analyze usage patterns', 'Optimize workflows', 'Review best practices');
        break;
    }
    
    return recommendations;
  }

  private _findRelatedEvents(category: string, title: string): string[] {
    return this._feedbackHistory
      .filter(event => event.type === category || event.title.includes(title))
      .slice(-3)
      .map(event => event.id);
  }
}