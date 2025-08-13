// ABOUTME: Insight card component for displaying contextual insights
// ABOUTME: Shows insights with confidence levels, recommendations, and actionable items

'use client';

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
        return 'bg-blue-100 text-blue-700';
      case 'performance':
        return 'bg-green-100 text-green-700';
      case 'error':
        return 'bg-red-100 text-red-700';
      case 'optimization':
        return 'bg-orange-100 text-orange-700';
      case 'prediction':
        return 'bg-purple-100 text-purple-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'high':
        return 'text-red-600';
      case 'medium':
        return 'text-yellow-600';
      case 'low':
        return 'text-green-600';
      default:
        return 'text-gray-600';
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

  return (
    <div className="feedback-insight-card border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-3">
          <span className="text-xl" role="img" aria-label={insight.category}>
            {getCategoryIcon(insight.category)}
          </span>
          <div>
            <h3 className="font-medium text-gray-900">{insight.title}</h3>
            <div className="flex items-center space-x-2 mt-1">
              <Badge variant="secondary" className={getCategoryColor(insight.category)}>
                {insight.category}
              </Badge>
              <span className={`text-xs font-medium ${getImpactColor(insight.impact)}`}>
                {insight.impact} impact
              </span>
              {insight.actionable && (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
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

      {/* Description */}
      <div className="text-sm text-gray-700 mb-3">{insight.description}</div>

      {/* Recommendations */}
      {showRecommendations && insight.recommendations && insight.recommendations.length > 0 && (
        <div className="mb-3">
          <h4 className="text-sm font-medium text-gray-800 mb-2">Recommendations:</h4>
          <ul className="text-sm text-gray-600 space-y-1">
            {insight.recommendations.map((rec, index) => (
              <li key={index} className="flex items-start space-x-2">
                <span className="text-green-500 mt-1">•</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Related Events */}
      {showRelatedEvents && insight.relatedEvents && insight.relatedEvents.length > 0 && (
        <div className="pt-3 border-t border-gray-100">
          <details className="text-xs text-gray-600">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
              Related Events ({insight.relatedEvents.length})
            </summary>
            <div className="mt-2 space-y-1">
              {insight.relatedEvents.map((eventId, index) => (
                <div key={index} className="font-mono text-xs text-gray-500">
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
