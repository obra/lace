// ABOUTME: Enhanced performance monitoring system for contextual feedback
// ABOUTME: Tracks detailed performance metrics and provides optimization suggestions

import { EventEmitter } from 'events';
import { logger } from '~/utils/logger';
import { ThreadEvent } from '~/threads/types';
import { ToolCall, ToolResult } from '~/tools/types';
import { CurrentTurnMetrics } from '~/agents/agent';

export interface PerformanceMetrics {
  responseTime: {
    current: number;
    average: number;
    min: number;
    max: number;
    p95: number;
    p99: number;
    samples: number[];
  };
  throughput: {
    turnsPerMinute: number;
    tokensPerSecond: number;
    toolCallsPerMinute: number;
  };
  reliability: {
    successRate: number;
    errorRate: number;
    retryRate: number;
    totalOperations: number;
  };
  resourceUsage: {
    tokenUsage: number;
    tokenEfficiency: number;
    memoryUsage?: number;
    cpuUsage?: number;
  };
  toolPerformance: Map<string, {
    averageTime: number;
    successRate: number;
    errorRate: number;
    callCount: number;
    lastUsed: Date;
  }>;
  patterns: {
    commonSequences: string[][];
    errorPatterns: Map<string, number>;
    performanceBottlenecks: string[];
  };
}

export interface OptimizationSuggestion {
  id: string;
  category: 'performance' | 'reliability' | 'efficiency' | 'cost';
  title: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
  priority: number; // 1-10 scale
  actionItems: string[];
  estimatedImprovement: string;
  relatedMetrics: string[];
}

export interface PerformanceAlert {
  id: string;
  type: 'warning' | 'critical' | 'info';
  title: string;
  message: string;
  threshold: number;
  currentValue: number;
  timestamp: Date;
  autoResolve: boolean;
  suggestions: string[];
}

export class PerformanceMonitor extends EventEmitter {
  private _metrics: PerformanceMetrics;
  private _sessionStart: Date;
  private _suggestions: OptimizationSuggestion[] = [];
  private _alerts: PerformanceAlert[] = [];
  private _thresholds: Record<string, number>;
  private _alertHistory: Map<string, Date> = new Map();
  private _isMonitoring: boolean = false;
  private _updateInterval?: NodeJS.Timeout;

  constructor(thresholds?: Record<string, number>) {
    super();
    this._sessionStart = new Date();
    this._thresholds = {
      maxResponseTime: 30000, // 30 seconds
      minSuccessRate: 0.85, // 85%
      maxErrorRate: 0.15, // 15%
      maxTokensPerTurn: 4000,
      minTurnsPerMinute: 0.5,
      ...thresholds
    };

    this._metrics = {
      responseTime: {
        current: 0,
        average: 0,
        min: 0,
        max: 0,
        p95: 0,
        p99: 0,
        samples: []
      },
      throughput: {
        turnsPerMinute: 0,
        tokensPerSecond: 0,
        toolCallsPerMinute: 0
      },
      reliability: {
        successRate: 1,
        errorRate: 0,
        retryRate: 0,
        totalOperations: 0
      },
      resourceUsage: {
        tokenUsage: 0,
        tokenEfficiency: 0
      },
      toolPerformance: new Map(),
      patterns: {
        commonSequences: [],
        errorPatterns: new Map(),
        performanceBottlenecks: []
      }
    };

    logger.info('PerformanceMonitor initialized', {
      thresholds: this._thresholds,
      sessionStart: this._sessionStart
    });
  }

  // Start monitoring
  startMonitoring(updateIntervalMs: number = 10000): void {
    if (this._isMonitoring) {
      return;
    }

    this._isMonitoring = true;
    this._updateInterval = setInterval(() => {
      this._analyzePerformance();
      this._generateSuggestions();
      this._checkAlerts();
    }, updateIntervalMs);

    logger.info('Performance monitoring started', {
      updateInterval: updateIntervalMs
    });
  }

  // Stop monitoring
  stopMonitoring(): void {
    if (!this._isMonitoring) {
      return;
    }

    this._isMonitoring = false;
    if (this._updateInterval) {
      clearInterval(this._updateInterval);
      this._updateInterval = undefined;
    }

    logger.info('Performance monitoring stopped');
  }

  // Record turn metrics
  recordTurnMetrics(metrics: CurrentTurnMetrics): void {
    const responseTime = metrics.elapsedMs;
    
    // Update response time metrics
    this._metrics.responseTime.current = responseTime;
    this._metrics.responseTime.samples.push(responseTime);
    
    // Keep only last 1000 samples
    if (this._metrics.responseTime.samples.length > 1000) {
      this._metrics.responseTime.samples = this._metrics.responseTime.samples.slice(-1000);
    }

    this._updateResponseTimeStats();
    
    // Update throughput
    this._updateThroughputMetrics();
    
    // Update token usage
    this._metrics.resourceUsage.tokenUsage += metrics.tokensIn + metrics.tokensOut;
    
    // Update reliability metrics
    this._metrics.reliability.totalOperations++;
    
    // Check for retry metrics
    if (metrics.retryMetrics && metrics.retryMetrics.totalAttempts > 0) {
      this._metrics.reliability.retryRate = 
        (this._metrics.reliability.retryRate + metrics.retryMetrics.totalAttempts) / 2;
    }

    logger.debug('Turn metrics recorded', {
      turnId: metrics.turnId,
      responseTime,
      tokensIn: metrics.tokensIn,
      tokensOut: metrics.tokensOut
    });
  }

  // Record tool performance
  recordToolExecution(toolName: string, executionTime: number, success: boolean): void {
    const existing = this._metrics.toolPerformance.get(toolName) || {
      averageTime: 0,
      successRate: 1,
      errorRate: 0,
      callCount: 0,
      lastUsed: new Date()
    };

    existing.callCount++;
    existing.lastUsed = new Date();
    existing.averageTime = (existing.averageTime * (existing.callCount - 1) + executionTime) / existing.callCount;
    
    if (success) {
      existing.successRate = (existing.successRate * (existing.callCount - 1) + 1) / existing.callCount;
    } else {
      existing.errorRate = (existing.errorRate * (existing.callCount - 1) + 1) / existing.callCount;
      existing.successRate = 1 - existing.errorRate;
    }

    this._metrics.toolPerformance.set(toolName, existing);

    logger.debug('Tool execution recorded', {
      toolName,
      executionTime,
      success,
      callCount: existing.callCount
    });
  }

  // Record error patterns
  recordError(error: string, context?: Record<string, unknown>): void {
    const count = this._metrics.patterns.errorPatterns.get(error) || 0;
    this._metrics.patterns.errorPatterns.set(error, count + 1);

    this._metrics.reliability.errorRate = this._calculateErrorRate();

    logger.warn('Error recorded', {
      error,
      count: count + 1,
      context
    });
  }

  // Get current metrics
  getMetrics(): PerformanceMetrics {
    return { ...this._metrics };
  }

  // Get optimization suggestions
  getSuggestions(): OptimizationSuggestion[] {
    return [...this._suggestions];
  }

  // Get active alerts
  getAlerts(): PerformanceAlert[] {
    return [...this._alerts];
  }

  // Generate performance report
  generateReport(): {
    metrics: PerformanceMetrics;
    suggestions: OptimizationSuggestion[];
    alerts: PerformanceAlert[];
    sessionDuration: number;
    summary: string;
  } {
    const sessionDuration = Date.now() - this._sessionStart.getTime();
    const summary = this._generateSummary();

    return {
      metrics: this.getMetrics(),
      suggestions: this.getSuggestions(),
      alerts: this.getAlerts(),
      sessionDuration,
      summary
    };
  }

  // Private methods

  private _updateResponseTimeStats(): void {
    const samples = this._metrics.responseTime.samples;
    if (samples.length === 0) return;

    const sorted = [...samples].sort((a, b) => a - b);
    
    this._metrics.responseTime.average = samples.reduce((a, b) => a + b, 0) / samples.length;
    this._metrics.responseTime.min = sorted[0];
    this._metrics.responseTime.max = sorted[sorted.length - 1];
    this._metrics.responseTime.p95 = sorted[Math.floor(sorted.length * 0.95)];
    this._metrics.responseTime.p99 = sorted[Math.floor(sorted.length * 0.99)];
  }

  private _updateThroughputMetrics(): void {
    const sessionDurationMs = Date.now() - this._sessionStart.getTime();
    const sessionDurationMin = sessionDurationMs / (1000 * 60);

    if (sessionDurationMin > 0) {
      this._metrics.throughput.turnsPerMinute = this._metrics.reliability.totalOperations / sessionDurationMin;
      this._metrics.throughput.tokensPerSecond = this._metrics.resourceUsage.tokenUsage / (sessionDurationMs / 1000);
      
      const totalToolCalls = Array.from(this._metrics.toolPerformance.values())
        .reduce((sum, tool) => sum + tool.callCount, 0);
      this._metrics.throughput.toolCallsPerMinute = totalToolCalls / sessionDurationMin;
    }
  }

  private _calculateErrorRate(): number {
    const totalErrors = Array.from(this._metrics.patterns.errorPatterns.values())
      .reduce((sum, count) => sum + count, 0);
    return this._metrics.reliability.totalOperations > 0 ? 
      totalErrors / this._metrics.reliability.totalOperations : 0;
  }

  private _analyzePerformance(): void {
    // Identify performance bottlenecks
    const bottlenecks: string[] = [];

    // Check response time
    if (this._metrics.responseTime.average > this._thresholds.maxResponseTime) {
      bottlenecks.push('High average response time');
    }

    // Check tool performance
    for (const [toolName, perf] of this._metrics.toolPerformance) {
      if (perf.averageTime > 10000) { // 10 seconds
        bottlenecks.push(`Slow tool: ${toolName}`);
      }
      if (perf.successRate < 0.8) {
        bottlenecks.push(`Unreliable tool: ${toolName}`);
      }
    }

    // Check throughput
    if (this._metrics.throughput.turnsPerMinute < this._thresholds.minTurnsPerMinute) {
      bottlenecks.push('Low conversation throughput');
    }

    this._metrics.patterns.performanceBottlenecks = bottlenecks;
  }

  private _generateSuggestions(): void {
    this._suggestions = [];

    // Response time suggestions
    if (this._metrics.responseTime.average > this._thresholds.maxResponseTime) {
      this._suggestions.push({
        id: 'reduce_response_time',
        category: 'performance',
        title: 'Reduce Response Time',
        description: 'Average response time is above threshold',
        impact: 'high',
        effort: 'medium',
        priority: 8,
        actionItems: [
          'Optimize tool selection',
          'Implement caching',
          'Reduce context size',
          'Use faster models for simple tasks'
        ],
        estimatedImprovement: '30-50% faster responses',
        relatedMetrics: ['responseTime.average']
      });
    }

    // Tool optimization suggestions
    for (const [toolName, perf] of this._metrics.toolPerformance) {
      if (perf.averageTime > 5000 && perf.callCount > 10) {
        this._suggestions.push({
          id: `optimize_tool_${toolName}`,
          category: 'efficiency',
          title: `Optimize ${toolName} Usage`,
          description: `${toolName} is taking longer than expected`,
          impact: 'medium',
          effort: 'medium',
          priority: 6,
          actionItems: [
            'Review tool parameters',
            'Implement result caching',
            'Batch operations where possible'
          ],
          estimatedImprovement: '20-40% faster tool execution',
          relatedMetrics: [`toolPerformance.${toolName}.averageTime`]
        });
      }
    }

    // Error rate suggestions
    if (this._metrics.reliability.errorRate > this._thresholds.maxErrorRate) {
      this._suggestions.push({
        id: 'reduce_error_rate',
        category: 'reliability',
        title: 'Reduce Error Rate',
        description: 'Error rate is above acceptable threshold',
        impact: 'high',
        effort: 'high',
        priority: 9,
        actionItems: [
          'Implement better error handling',
          'Add input validation',
          'Improve tool reliability',
          'Add retry mechanisms'
        ],
        estimatedImprovement: '50-70% fewer errors',
        relatedMetrics: ['reliability.errorRate']
      });
    }

    // Token efficiency suggestions
    if (this._metrics.resourceUsage.tokenUsage > 100000) { // 100K tokens
      this._suggestions.push({
        id: 'improve_token_efficiency',
        category: 'cost',
        title: 'Improve Token Efficiency',
        description: 'High token usage detected',
        impact: 'medium',
        effort: 'low',
        priority: 5,
        actionItems: [
          'Implement conversation compaction',
          'Use more precise prompts',
          'Optimize tool descriptions',
          'Remove unnecessary context'
        ],
        estimatedImprovement: '20-30% token reduction',
        relatedMetrics: ['resourceUsage.tokenUsage']
      });
    }

    // Sort suggestions by priority
    this._suggestions.sort((a, b) => b.priority - a.priority);
  }

  private _checkAlerts(): void {
    const now = new Date();
    const newAlerts: PerformanceAlert[] = [];

    // Response time alert
    if (this._metrics.responseTime.current > this._thresholds.maxResponseTime) {
      newAlerts.push({
        id: 'high_response_time',
        type: 'warning',
        title: 'High Response Time',
        message: `Current response time (${this._metrics.responseTime.current}ms) exceeds threshold`,
        threshold: this._thresholds.maxResponseTime,
        currentValue: this._metrics.responseTime.current,
        timestamp: now,
        autoResolve: true,
        suggestions: ['Check system resources', 'Optimize current operation']
      });
    }

    // Error rate alert
    if (this._metrics.reliability.errorRate > this._thresholds.maxErrorRate) {
      newAlerts.push({
        id: 'high_error_rate',
        type: 'critical',
        title: 'High Error Rate',
        message: `Error rate (${(this._metrics.reliability.errorRate * 100).toFixed(1)}%) exceeds threshold`,
        threshold: this._thresholds.maxErrorRate,
        currentValue: this._metrics.reliability.errorRate,
        timestamp: now,
        autoResolve: false,
        suggestions: ['Review recent errors', 'Check tool configurations']
      });
    }

    // Success rate alert
    if (this._metrics.reliability.successRate < this._thresholds.minSuccessRate) {
      newAlerts.push({
        id: 'low_success_rate',
        type: 'warning',
        title: 'Low Success Rate',
        message: `Success rate (${(this._metrics.reliability.successRate * 100).toFixed(1)}%) below threshold`,
        threshold: this._thresholds.minSuccessRate,
        currentValue: this._metrics.reliability.successRate,
        timestamp: now,
        autoResolve: true,
        suggestions: ['Investigate failures', 'Improve error handling']
      });
    }

    // Update alerts, avoiding duplicates
    for (const alert of newAlerts) {
      const lastAlert = this._alertHistory.get(alert.id);
      if (!lastAlert || now.getTime() - lastAlert.getTime() > 60000) { // 1 minute cooldown
        this._alerts.push(alert);
        this._alertHistory.set(alert.id, now);
        this.emit('alert', alert);
      }
    }

    // Auto-resolve alerts
    this._alerts = this._alerts.filter(alert => {
      if (alert.autoResolve) {
        const shouldResolve = this._shouldResolveAlert(alert);
        if (shouldResolve) {
          this.emit('alert_resolved', alert);
        }
        return !shouldResolve;
      }
      return true;
    });
  }

  private _shouldResolveAlert(alert: PerformanceAlert): boolean {
    switch (alert.id) {
      case 'high_response_time':
        return this._metrics.responseTime.current <= this._thresholds.maxResponseTime;
      case 'low_success_rate':
        return this._metrics.reliability.successRate >= this._thresholds.minSuccessRate;
      default:
        return false;
    }
  }

  private _generateSummary(): string {
    const metrics = this._metrics;
    const sessionDurationMin = (Date.now() - this._sessionStart.getTime()) / (1000 * 60);
    
    const summary = [
      `Session Duration: ${sessionDurationMin.toFixed(1)} minutes`,
      `Total Operations: ${metrics.reliability.totalOperations}`,
      `Average Response Time: ${metrics.responseTime.average.toFixed(0)}ms`,
      `Success Rate: ${(metrics.reliability.successRate * 100).toFixed(1)}%`,
      `Tokens Used: ${metrics.resourceUsage.tokenUsage.toLocaleString()}`,
      `Active Alerts: ${this._alerts.length}`,
      `Optimization Suggestions: ${this._suggestions.length}`
    ];

    return summary.join(' • ');
  }
}