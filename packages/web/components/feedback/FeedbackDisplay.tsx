// ABOUTME: Main feedback display component for contextual feedback system
// ABOUTME: Renders feedback events, insights, and performance analysis in real-time

'use client';

import { useState, useEffect } from 'react';
import {
  FeedbackEvent,
  FeedbackInsight,
  PerformanceAnalysis,
  PredictiveInsight,
} from '@/feedback/types';
import { FeedbackEventCard } from './FeedbackEventCard';
import { FeedbackInsightCard } from './FeedbackInsightCard';
import { PerformancePanel } from './PerformancePanel';
import { PredictivePanel } from './PredictivePanel';
import { Badge } from '@/components/ui';

interface FeedbackDisplayProps {
  events: FeedbackEvent[];
  insights: FeedbackInsight[];
  performanceAnalysis?: PerformanceAnalysis;
  predictiveInsights: PredictiveInsight[];
  showPerformanceMetrics?: boolean;
  showPredictions?: boolean;
  showInsights?: boolean;
  maxEventsShown?: number;
  className?: string;
}

export function FeedbackDisplay({
  events,
  insights,
  performanceAnalysis,
  predictiveInsights,
  showPerformanceMetrics = true,
  showPredictions = false,
  showInsights = true,
  maxEventsShown = 10,
  className = '',
}: FeedbackDisplayProps) {
  const [activeTab, setActiveTab] = useState<'events' | 'insights' | 'performance' | 'predictions'>(
    'events'
  );
  const [filteredEvents, setFilteredEvents] = useState<FeedbackEvent[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

  // Filter and sort events
  useEffect(() => {
    let filtered = events;

    // Filter by type if any are selected
    if (selectedTypes.size > 0) {
      filtered = filtered.filter((event) => selectedTypes.has(event.type));
    }

    // Sort by timestamp (newest first)
    filtered = filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Limit to max events
    filtered = filtered.slice(0, maxEventsShown);

    setFilteredEvents(filtered);
  }, [events, selectedTypes, maxEventsShown]);

  const handleTypeToggle = (type: string) => {
    const newSelected = new Set(selectedTypes);
    if (newSelected.has(type)) {
      newSelected.delete(type);
    } else {
      newSelected.add(type);
    }
    setSelectedTypes(newSelected);
  };

  const getEventTypeCounts = () => {
    const counts: Record<string, number> = {};
    events.forEach((event) => {
      counts[event.type] = (counts[event.type] || 0) + 1;
    });
    return counts;
  };

  const eventTypeCounts = getEventTypeCounts();

  return (
    <div className={`feedback-display ${className}`}>
      {/* Header */}
      <div className="feedback-header border-b border-gray-200 pb-4 mb-4">
        <h2 className="text-xl font-semibold text-gray-900">Contextual Feedback</h2>
        <p className="text-sm text-gray-600 mt-1">
          Real-time insights and commentary on your development session
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="feedback-tabs flex space-x-1 mb-4">
        <button
          onClick={() => setActiveTab('events')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'events'
              ? 'bg-blue-100 text-blue-700'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Events
          {events.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {events.length}
            </Badge>
          )}
        </button>

        {showInsights && (
          <button
            onClick={() => setActiveTab('insights')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'insights'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Insights
            {insights.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {insights.length}
              </Badge>
            )}
          </button>
        )}

        {showPerformanceMetrics && performanceAnalysis && (
          <button
            onClick={() => setActiveTab('performance')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'performance'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Performance
          </button>
        )}

        {showPredictions && (
          <button
            onClick={() => setActiveTab('predictions')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'predictions'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Predictions
            {predictiveInsights.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {predictiveInsights.length}
              </Badge>
            )}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="feedback-content">
        {activeTab === 'events' && (
          <div className="events-panel">
            {/* Type filters */}
            <div className="filters mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Filter by type:</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(eventTypeCounts).map(([type, count]) => (
                  <button
                    key={type}
                    onClick={() => handleTypeToggle(type)}
                    className={`px-3 py-1 rounded-full text-sm transition-colors ${
                      selectedTypes.has(type)
                        ? 'bg-blue-100 text-blue-700 border-blue-300'
                        : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
                    } border`}
                  >
                    {type}
                    <span className="ml-1 text-xs">({count})</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Events list */}
            <div className="events-list space-y-3">
              {filteredEvents.length > 0 ? (
                filteredEvents.map((event) => <FeedbackEventCard key={event.id} event={event} />)
              ) : (
                <div className="text-center py-8 text-gray-500">
                  {selectedTypes.size > 0 ? (
                    <p>No events found for the selected types</p>
                  ) : (
                    <p>No feedback events yet</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'insights' && showInsights && (
          <div className="insights-panel">
            <div className="insights-list space-y-3">
              {insights.length > 0 ? (
                insights.map((insight) => (
                  <FeedbackInsightCard key={insight.id} insight={insight} />
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p>No insights available yet</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'performance' && showPerformanceMetrics && performanceAnalysis && (
          <div className="performance-panel">
            <PerformancePanel analysis={performanceAnalysis} />
          </div>
        )}

        {activeTab === 'predictions' && showPredictions && (
          <div className="predictions-panel">
            <PredictivePanel insights={predictiveInsights} />
          </div>
        )}
      </div>
    </div>
  );
}
