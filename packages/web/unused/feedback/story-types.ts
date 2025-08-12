// ABOUTME: Mock types for Storybook stories that don't match the actual feedback system
// ABOUTME: Used only for demo purposes in stories

export interface FeedbackEvent {
  id: string;
  type: string;
  title: string;
  content: string; // changed from 'description'
  timestamp: Date;
  priority: 'low' | 'medium' | 'high'; // changed from 'severity'
  tags: string[];
  context: {
    threadId: string;
    agentState?: string;
    currentTool?: string;
    turnMetrics?: {
      turnId: string;
      elapsedMs: number;
    };
  };
  metadata?: Record<string, unknown>;
}

export interface FeedbackInsight {
  id: string;
  type: string;
  title: string;
  description: string;
  confidence: number;
  timestamp: Date;
  suggestions: string[];
  impact: 'low' | 'medium' | 'high';
}

export interface PerformanceAnalysis {
  overall_score: number;
  response_time: {
    average: number;
    p95: number;
    p99: number;
  };
  memory_usage: {
    peak: number;
    average: number;
    trend: string;
  };
  cpu_usage: {
    peak: number;
    average: number;
    trend: string;
  };
  bottlenecks: Array<{
    type: string;
    component?: string;
    endpoint?: string;
    impact: string;
    suggestion: string;
  }>;
  improvements: Array<{
    description: string;
    impact: number;
    implemented: Date;
  }>;
}

export interface PredictiveInsight {
  id: string;
  type: string;
  title: string;
  description: string;
  confidence: number;
  probability: number;
  timeframe: string;
  timestamp: Date;
  recommendations: string[];
  impact: 'low' | 'medium' | 'high';
}
