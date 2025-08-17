// ABOUTME: Insight card component for displaying contextual insights
// ABOUTME: Shows insights with confidence levels, recommendations, and actionable items

'use client';

import React from 'react';
import { FeedbackInsight } from '@/feedback/types';
import { Badge } from '@/components/ui';

interface FeedbackInsightCardProps {
  insight: FeedbackInsight;
  showRecommendations?: boolean;
  showRelatedEvents?: boolean;
}

export function FeedbackInsightCard({
  insight,
  showRecommendations = true,
  showRelatedEvents = false,
}: FeedbackInsightCardProps) {
  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'pattern':
        return 'bg-info/20 text-info';
      case 'performance':
        return 'bg-success/20 text-success';
      case 'error':
        return 'bg-error/20 text-error';
      case 'optimization':
        return 'bg-warning/20 text-warning';
      case 'prediction':
        return 'bg-secondary/20 text-secondary';
      default:
        return 'bg-base-200 text-base-content/80';
    }
  };

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'high':
        return 'text-error';
      case 'medium':
        return 'text-warning';
      case 'low':
        return 'text-success';
      default:
        return 'text-base-content/70';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'pattern':
        return '🔍';
      case 'performance':
        return '⚡';
      case 'error':
        return '🚨';
      case 'optimization':
        return '🔧';
      case 'prediction':
        return '🔮';
      default:
        return '💭';
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

  return (
    <div className="feedback-insight-card border border-base-300 rounded-lg p-4 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-3">
          <span className="text-xl" role="img" aria-label={insight.category}>
            {getCategoryIcon(insight.category)}
          </span>
          <div>
            <h3 className="font-medium text-base-content">{insight.title}</h3>
            <div className="flex items-center space-x-2 mt-1">
              <Badge variant="secondary" className={getCategoryColor(insight.category)}>
                {insight.category}
              </Badge>
              <span className={`text-xs font-medium ${getImpactColor(insight.impact)}`}>
                {insight.impact} impact
              </span>
              {insight.actionable && (
                <span className="text-xs bg-success/20 text-success px-2 py-1 rounded-full">
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

      {/* Description */}
      <div className="text-sm text-base-content/80 mb-3">{insight.description}</div>

      {/* Recommendations */}
      {showRecommendations && insight.recommendations && insight.recommendations.length > 0 && (
        <div className="mb-3">
          <h4 className="text-sm font-medium text-base-content/90 mb-2">Recommendations:</h4>
          <ul className="text-sm text-base-content/80 space-y-1">
            {insight.recommendations.map((rec, index) => (
              <li key={index} className="flex items-start space-x-2">
                <span className="text-success mt-1">•</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Related Events */}
      {showRelatedEvents && insight.relatedEvents && insight.relatedEvents.length > 0 && (
        <div className="pt-3 border-t border-base-300">
          <details className="text-xs text-base-content/70">
            <summary className="cursor-pointer text-base-content/60 hover:text-base-content/80">
              Related Events ({insight.relatedEvents.length})
            </summary>
            <div className="mt-2 space-y-1">
              {insight.relatedEvents.map((eventId, index) => (
                <div key={index} className="font-mono text-xs text-base-content/60">
                  {eventId}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
