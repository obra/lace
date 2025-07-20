// ABOUTME: Individual feedback event card component
// ABOUTME: Displays a single feedback event with contextual styling and information

'use client';

import { FeedbackEvent } from '~/feedback/types';
import { Badge, TimestampDisplay } from '@/components/ui';
import { formatTime } from '~/utils/format';

interface FeedbackEventCardProps {
  event: FeedbackEvent;
  showContext?: boolean;
  compact?: boolean;
}

export function FeedbackEventCard({ 
  event, 
  showContext = false, 
  compact = false 
}: FeedbackEventCardProps) {
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'action': return 'bg-blue-100 text-blue-700';
      case 'performance': return 'bg-green-100 text-green-700';
      case 'educational': return 'bg-purple-100 text-purple-700';
      case 'predictive': return 'bg-yellow-100 text-yellow-700';
      case 'error': return 'bg-red-100 text-red-700';
      case 'optimization': return 'bg-orange-100 text-orange-700';
      case 'insight': return 'bg-indigo-100 text-indigo-700';
      case 'celebration': return 'bg-emerald-100 text-emerald-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'high': return '🔴';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'action': return '⚡';
      case 'performance': return '📊';
      case 'educational': return '🎓';
      case 'predictive': return '🔮';
      case 'error': return '❌';
      case 'optimization': return '⚡';
      case 'insight': return '💡';
      case 'celebration': return '🎉';
      default: return '📝';
    }
  };

  if (compact) {
    return (
      <div className="feedback-event-card-compact flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
        <div className="flex-shrink-0">
          <span className="text-lg" role="img" aria-label={event.type}>
            {getTypeIcon(event.type)}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <Badge variant="secondary" className={getTypeColor(event.type)}>
              {event.type}
            </Badge>
            <span className="text-xs text-gray-500">
              {getPriorityIcon(event.priority)}
            </span>
          </div>
          <p className="text-sm text-gray-900 mt-1 truncate">{event.content}</p>
        </div>
        <div className="flex-shrink-0 text-xs text-gray-500">
          <TimestampDisplay timestamp={event.timestamp} />
        </div>
      </div>
    );
  }

  return (
    <div className="feedback-event-card border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-3">
          <span className="text-xl" role="img" aria-label={event.type}>
            {getTypeIcon(event.type)}
          </span>
          <div>
            <h3 className="font-medium text-gray-900">{event.title}</h3>
            <div className="flex items-center space-x-2 mt-1">
              <Badge variant="secondary" className={getTypeColor(event.type)}>
                {event.type}
              </Badge>
              <span className="text-xs text-gray-500">
                {getPriorityIcon(event.priority)} {event.priority}
              </span>
            </div>
          </div>
        </div>
        <div className="text-sm text-gray-500">
          <TimestampDisplay timestamp={event.timestamp} />
        </div>
      </div>

      {/* Content */}
      <div className="text-sm text-gray-700 mb-3">
        {event.content}
      </div>

      {/* Tags */}
      {event.tags && event.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {event.tags.map((tag, index) => (
            <span
              key={index}
              className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-full"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Context (expandable) */}
      {showContext && event.context && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <details className="text-xs text-gray-600">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
              Context Details
            </summary>
            <div className="mt-2 space-y-1">
              <div><strong>Thread:</strong> {event.context.threadId}</div>
              {event.context.agentState && (
                <div><strong>Agent State:</strong> {event.context.agentState}</div>
              )}
              {event.context.currentTool && (
                <div><strong>Current Tool:</strong> {event.context.currentTool}</div>
              )}
              {event.context.turnMetrics && (
                <div>
                  <strong>Turn:</strong> {event.context.turnMetrics.turnId} 
                  ({event.context.turnMetrics.elapsedMs}ms)
                </div>
              )}
              {event.metadata && (
                <div className="mt-2">
                  <strong>Metadata:</strong>
                  <pre className="text-xs bg-gray-50 p-2 rounded mt-1 overflow-x-auto">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}