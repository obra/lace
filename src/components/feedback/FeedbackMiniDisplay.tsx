// ABOUTME: Compact feedback display for minimal UI space
// ABOUTME: Shows latest feedback events in a streamlined format

'use client';

import { useState } from 'react';
import { FeedbackEvent } from '~/feedback/types';
import { FeedbackEventCard } from './FeedbackEventCard';
import { Badge } from '~/components/ui';

interface FeedbackMiniDisplayProps {
  events: FeedbackEvent[];
  maxEvents?: number;
  showOnlyHighPriority?: boolean;
  className?: string;
}

export function FeedbackMiniDisplay({
  events,
  maxEvents = 3,
  showOnlyHighPriority = false,
  className = ''
}: FeedbackMiniDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Filter and sort events
  const filteredEvents = events
    .filter(event => !showOnlyHighPriority || event.priority === 'high')
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, isExpanded ? maxEvents * 2 : maxEvents);

  if (events.length === 0) {
    return null;
  }

  const getLatestEventType = () => {
    if (filteredEvents.length === 0) return null;
    return filteredEvents[0].type;
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

  const latestType = getLatestEventType();

  return (
    <div className={`feedback-mini-display ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          {latestType && (
            <span className="text-sm" role="img" aria-label={latestType}>
              {getTypeIcon(latestType)}
            </span>
          )}
          <h3 className="text-sm font-medium text-gray-700">Live Feedback</h3>
          <Badge variant="secondary" className="text-xs">
            {events.length}
          </Badge>
        </div>
        {events.length > maxEvents && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>

      {/* Events */}
      <div className="space-y-2">
        {filteredEvents.map((event) => (
          <FeedbackEventCard key={event.id} event={event} compact={true} />
        ))}
      </div>

      {/* Status indicator */}
      <div className="mt-2 text-xs text-gray-500 text-center">
        {events.length === 0 && 'No feedback yet'}
        {events.length > 0 && (
          <span>
            Latest: {filteredEvents[0]?.type} • {events.length} total
          </span>
        )}
      </div>
    </div>
  );
}