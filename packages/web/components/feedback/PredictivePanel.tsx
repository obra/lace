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
        return 'bg-red-100 text-red-700';
      case 'short':
        return 'bg-orange-100 text-orange-700';
      case 'medium':
        return 'bg-yellow-100 text-yellow-700';
      case 'long':
        return 'bg-green-100 text-green-700';
      default:
        return 'bg-gray-100 text-gray-700';
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
    const percentage = Math.round(confidence * 100);
    const color =
      confidence > 0.8 ? 'bg-green-500' : confidence > 0.6 ? 'bg-yellow-500' : 'bg-red-500';

    return (
      <div className="flex items-center space-x-2">
        <div className="w-16 h-2 bg-gray-200 rounded-full">
          <div className={`h-2 rounded-full ${color}`} style={{ width: `${percentage}%` }} />
        </div>
        <span className="text-xs text-gray-600">{percentage}%</span>
      </div>
    );
  };

  if (insights.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
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
          key={index}
          className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center space-x-3">
              <span className="text-xl" role="img" aria-label={insight.timeframe}>
                {getTimeframeIcon(insight.timeframe)}
              </span>
              <div>
                <h3 className="font-medium text-gray-900">{insight.prediction}</h3>
                <div className="flex items-center space-x-2 mt-1">
                  <Badge variant="secondary" className={getTimeframeColor(insight.timeframe)}>
                    {insight.timeframe}
                  </Badge>
                  {insight.actionable && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                      Actionable
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500 mb-1">Confidence</div>
              {getConfidenceBar(insight.confidence)}
            </div>
          </div>

          {/* Contributing Factors */}
          <div className="mb-3">
            <h4 className="text-sm font-medium text-gray-800 mb-2">Contributing Factors:</h4>
            <div className="flex flex-wrap gap-2">
              {insight.factors.map((factor, factorIndex) => (
                <span
                  key={factorIndex}
                  className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-full"
                >
                  {factor}
                </span>
              ))}
            </div>
          </div>

          {/* Prevention Suggestions */}
          {insight.preventionSuggestions && insight.preventionSuggestions.length > 0 && (
            <div className="pt-3 border-t border-gray-100">
              <h4 className="text-sm font-medium text-gray-800 mb-2">Prevention Suggestions:</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                {insight.preventionSuggestions.map((suggestion, suggestionIndex) => (
                  <li key={suggestionIndex} className="flex items-start space-x-2">
                    <span className="text-blue-500 mt-1">→</span>
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
