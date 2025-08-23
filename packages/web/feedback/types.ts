// ABOUTME: Type definitions for contextual feedback system
// ABOUTME: Defines commentary types, feedback events, and configuration options

type CommentaryType =
  | 'action' // What's happening now
  | 'performance' // How well things are going
  | 'educational' // Why certain decisions were made
  | 'predictive' // What's likely to happen next
  | 'error' // What went wrong and how to fix it
  | 'optimization' // Performance and efficiency suggestions
  | 'insight' // Deeper understanding of patterns
  | 'celebration'; // Acknowledging good outcomes;

type FeedbackVerbosity = 'quiet' | 'normal' | 'verbose' | 'commentary';

type FeedbackTiming = 'immediate' | 'batched' | 'milestone';

interface FeedbackContext {
  threadId: string;
  agentState?: string;
  currentTool?: string;
  turnMetrics?: {
    startTime: Date;
    elapsedMs: number;
    tokensIn: number;
    tokensOut: number;
    turnId: string;
  };
  performanceMetrics?: {
    averageResponseTime: number;
    successRate: number;
    errorRate: number;
    toolUsagePatterns: Record<string, number>;
  };
  sessionMetrics?: {
    totalTurns: number;
    totalTime: number;
    toolsUsed: string[];
    errorsSeen: string[];
  };
}

export interface FeedbackEvent {
  id: string;
  timestamp: Date;
  type: CommentaryType;
  title: string;
  content: string;
  context: FeedbackContext;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface FeedbackInsight {
  id: string;
  category: 'pattern' | 'performance' | 'error' | 'optimization' | 'prediction';
  title: string;
  description: string;
  confidence: number; // 0-1 scale
  actionable: boolean;
  impact: 'low' | 'medium' | 'high';
  recommendations?: string[];
  relatedEvents?: string[]; // IDs of related feedback events
}

export interface PerformanceAnalysis {
  responseTimeAnalysis: {
    current: number;
    average: number;
    trend: 'improving' | 'stable' | 'degrading';
    percentile95: number;
  };
  toolEfficiency: {
    toolName: string;
    successRate: number;
    averageTime: number;
    errorPatterns: string[];
  }[];
  conversationFlow: {
    turnsPerMinute: number;
    contextSwitches: number;
    backtrackingEvents: number;
  };
  resourceUsage: {
    tokenUsage: number;
    tokenEfficiency: number;
    costEstimate?: number;
  };
}

export interface PredictiveInsight {
  prediction: string;
  confidence: number;
  timeframe: 'immediate' | 'short' | 'medium' | 'long';
  factors: string[];
  actionable: boolean;
  preventionSuggestions?: string[];
}
