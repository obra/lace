// ABOUTME: Performance analysis panel for contextual feedback
// ABOUTME: Displays performance metrics, trends, and resource usage

'use client';

import { PerformanceAnalysis } from '~/feedback/types';
import { Badge } from '@/components/ui';

interface PerformancePanelProps {
  analysis: PerformanceAnalysis;
}

export function PerformancePanel({ analysis }: PerformancePanelProps) {
  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'improving': return 'text-green-600';
      case 'stable': return 'text-blue-600';
      case 'degrading': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'improving': return '📈';
      case 'stable': return '📊';
      case 'degrading': return '📉';
      default: return '📊';
    }
  };

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens < 1000) return tokens.toString();
    if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
    return `${(tokens / 1000000).toFixed(1)}M`;
  };

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 0.9) return 'text-green-600';
    if (rate >= 0.7) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="performance-panel space-y-6">
      {/* Response Time Analysis */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="font-medium text-gray-900 mb-4 flex items-center">
          <span className="mr-2">⏱️</span>
          Response Time Analysis
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              {formatTime(analysis.responseTimeAnalysis.current)}
            </div>
            <div className="text-sm text-gray-500">Current</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-800">
              {formatTime(analysis.responseTimeAnalysis.average)}
            </div>
            <div className="text-sm text-gray-500">Average</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-600">
              {formatTime(analysis.responseTimeAnalysis.percentile95)}
            </div>
            <div className="text-sm text-gray-500">95th Percentile</div>
          </div>
          <div className="text-center">
            <div className={`text-2xl font-bold ${getTrendColor(analysis.responseTimeAnalysis.trend)}`}>
              {getTrendIcon(analysis.responseTimeAnalysis.trend)}
            </div>
            <div className="text-sm text-gray-500 capitalize">
              {analysis.responseTimeAnalysis.trend}
            </div>
          </div>
        </div>
      </div>

      {/* Tool Efficiency */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="font-medium text-gray-900 mb-4 flex items-center">
          <span className="mr-2">🔧</span>
          Tool Efficiency
        </h3>
        <div className="space-y-3">
          {analysis.toolEfficiency.map((tool, index) => (
            <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <span className="font-medium text-gray-900">{tool.toolName}</span>
                <Badge 
                  variant="secondary" 
                  className={`${getSuccessRateColor(tool.successRate)}`}
                >
                  {Math.round(tool.successRate * 100)}% success
                </Badge>
              </div>
              <div className="text-sm text-gray-600">
                {formatTime(tool.averageTime)} avg
                {tool.errorPatterns.length > 0 && (
                  <span className="ml-2 text-red-500">
                    {tool.errorPatterns.length} error patterns
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Conversation Flow */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="font-medium text-gray-900 mb-4 flex items-center">
          <span className="mr-2">💬</span>
          Conversation Flow
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">
              {analysis.conversationFlow.turnsPerMinute.toFixed(1)}
            </div>
            <div className="text-sm text-gray-500">Turns/min</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-yellow-600">
              {analysis.conversationFlow.contextSwitches}
            </div>
            <div className="text-sm text-gray-500">Context switches</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-red-600">
              {analysis.conversationFlow.backtrackingEvents}
            </div>
            <div className="text-sm text-gray-500">Backtracking events</div>
          </div>
        </div>
      </div>

      {/* Resource Usage */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="font-medium text-gray-900 mb-4 flex items-center">
          <span className="mr-2">📊</span>
          Resource Usage
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-purple-600">
              {formatTokens(analysis.resourceUsage.tokenUsage)}
            </div>
            <div className="text-sm text-gray-500">Total tokens</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-green-600">
              {analysis.resourceUsage.tokenEfficiency.toFixed(1)}
            </div>
            <div className="text-sm text-gray-500">Tokens/operation</div>
          </div>
          {analysis.resourceUsage.costEstimate && (
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-orange-600">
                ${analysis.resourceUsage.costEstimate.toFixed(4)}
              </div>
              <div className="text-sm text-gray-500">Estimated cost</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}