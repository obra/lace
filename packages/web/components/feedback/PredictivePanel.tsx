// ABOUTME: Predictive insights panel for contextual feedback
// ABOUTME: Displays predictions, timeframes, and prevention suggestions

'use client';

import React from 'react';
import { PredictiveInsight } from '@/feedback/types';
import { Badge } from '@/components/ui';

interface PredictivePanelProps {
  insights: PredictiveInsight[];
}

export function PredictivePanel({ insights }: PredictivePanelProps) {
  const getTimeframeColor = (timeframe: string) => {
    switch (timeframe) {
      case 'immediate':
        return 'bg-error/20 text-error';
      case 'short':
        return 'bg-warning/20 text-warning';
      case 'medium':
        return 'bg-warning/20 text-warning';
      case 'long':
        return 'bg-success/20 text-success';
      default:
        return 'bg-base-200 text-base-content/80';
    }
  };

  const getTimeframeIcon = (timeframe: string) => {
    switch (timeframe) {
      case 'immediate':
        return '🚨';
      case 'short':
        return '⏰';
      case 'medium':
        return '📅';
      case 'long':
        return '🗓️';
      default:
        return '⏳';
    }
  };

  const getConfidenceBar = (confidence: number) => {
    const percentage = Math.min(100, Math.max(0, Math.round(confidence * 100)));
    const color = confidence > 0.8 ? 'bg-success' : confidence > 0.6 ? 'bg-warning' : 'bg-error';

    return (
      <div className="flex items-center space-x-2">
        <div className="w-16 h-2 bg-base-300 rounded-full">
          <div className={`h-2 rounded-full ${color}`} style={{ width: `${percentage}%` }} />
        </div>
        <span className="text-xs text-base-content/60">{percentage}%</span>
      </div>
    );
  };

  if (insights.length === 0) {
    return (
      <div className="text-center py-8 text-base-content/60">
        <div className="text-4xl mb-2">🔮</div>
        <p>No predictions available yet</p>
        <p className="text-sm mt-1">Predictions will appear as patterns emerge</p>
      </div>
    );
  }

  return (
    <div className="predictive-panel space-y-4">
      {insights.map((insight, index) => (
        <div
          key={`${insight.prediction}-${insight.timeframe}-${index}`}
          className="bg-base-100 border border-base-300 rounded-lg p-4 hover:shadow-md transition-shadow"
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center space-x-3">
              <span className="text-xl" role="img" aria-label={insight.timeframe}>
                {getTimeframeIcon(insight.timeframe)}
              </span>
              <div>
                <h3 className="font-medium text-base-content">{insight.prediction}</h3>
                <div className="flex items-center space-x-2 mt-1">
                  <Badge variant="secondary" className={getTimeframeColor(insight.timeframe)}>
                    {insight.timeframe}
                  </Badge>
                  {insight.actionable && (
                    <span className="text-xs bg-info/20 text-info px-2 py-1 rounded-full">
                      Actionable
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-base-content/60 mb-1">Confidence</div>
              {getConfidenceBar(insight.confidence)}
            </div>
          </div>

          {/* Contributing Factors */}
          <div className="mb-3">
            <h4 className="text-sm font-medium text-base-content/90 mb-2">Contributing Factors:</h4>
            <div className="flex flex-wrap gap-2">
              {insight.factors.map((factor, factorIndex) => (
                <span
                  key={`factor-${factorIndex}-${factor.slice(0, 10)}`}
                  className="px-2 py-1 text-xs bg-base-200 text-base-content/80 rounded-full"
                >
                  {factor}
                </span>
              ))}
            </div>
          </div>

          {/* Prevention Suggestions */}
          {insight.preventionSuggestions && insight.preventionSuggestions.length > 0 && (
            <div className="pt-3 border-t border-base-300">
              <h4 className="text-sm font-medium text-base-content/90 mb-2">
                Prevention Suggestions:
              </h4>
              <ul className="text-sm text-base-content/80 space-y-1">
                {insight.preventionSuggestions.map((suggestion, suggestionIndex) => (
                  <li
                    key={`suggestion-${suggestionIndex}-${suggestion.slice(0, 20)}`}
                    className="flex items-start space-x-2"
                  >
                    <span className="text-info mt-1">→</span>
                    <span>{suggestion}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
