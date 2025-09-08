// ABOUTME: Real-time SSE event stream monitor for debugging
// ABOUTME: Shows live events with truncated payloads and connection status

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircle, faTrash, faPause, faPlay } from '@/lib/fontawesome';
import type { LaceEvent } from '@/types/core';

interface EventStreamMonitorProps {
  maxEvents?: number;
}

export function EventStreamMonitor({ maxEvents = 50 }: EventStreamMonitorProps) {
  const [events, setEvents] = useState<LaceEvent[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('disconnected');
  const [isPaused, setIsPaused] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new events arrive
  useEffect(() => {
    if (!isPaused) {
      eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events, isPaused]);

  // Connect to SSE stream
  useEffect(() => {
    const connectToEventStream = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      setConnectionStatus('connecting');
      const eventSource = new EventSource('/api/events/stream');
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setConnectionStatus('connected');
      };

      eventSource.onmessage = (event) => {
        if (isPaused) return;

        try {
          const parsedEvent = JSON.parse(event.data as string) as LaceEvent;

          setEvents((prev) => {
            const newEvents = [...prev, parsedEvent].slice(-maxEvents);
            return newEvents;
          });
        } catch (error) {
          console.warn('Failed to parse SSE event:', error);
        }
      };

      eventSource.onerror = () => {
        setConnectionStatus('disconnected');
        // Auto-reconnect after 2 seconds
        setTimeout(connectToEventStream, 2000);
      };
    };

    connectToEventStream();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [maxEvents, isPaused]);

  const clearEvents = () => {
    setEvents([]);
  };

  const togglePause = () => {
    setIsPaused((prev) => !prev);
  };

  const formatEventData = (data: unknown): string => {
    if (typeof data === 'string') {
      return data.length > 100 ? data.substring(0, 100) + '...' : data;
    }

    if (typeof data === 'object' && data !== null) {
      const jsonStr = JSON.stringify(data);
      return jsonStr.length > 100 ? jsonStr.substring(0, 100) + '...' : jsonStr;
    }

    return String(data);
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'text-success';
      case 'connecting':
        return 'text-warning';
      case 'disconnected':
        return 'text-error';
      default:
        return 'text-base-content/60';
    }
  };

  const getEventTypeColor = (type?: string) => {
    if (!type) return 'text-base-content';
    if (type.includes('TASK')) return 'text-info';
    if (type.includes('AGENT')) return 'text-primary';
    if (type.includes('ERROR')) return 'text-error';
    if (type.includes('TOOL')) return 'text-warning';
    return 'text-base-content';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FontAwesomeIcon icon={faCircle} className={`w-2 h-2 ${getStatusColor()}`} />
          <span className="text-xs font-medium capitalize">{connectionStatus}</span>
          <span className="text-xs text-base-content/60">({events.length} events)</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={togglePause}
            className="btn btn-xs btn-ghost"
            title={isPaused ? 'Resume' : 'Pause'}
          >
            <FontAwesomeIcon icon={isPaused ? faPlay : faPause} className="w-3 h-3" />
          </button>
          <button onClick={clearEvents} className="btn btn-xs btn-ghost" title="Clear Events">
            <FontAwesomeIcon icon={faTrash} className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto space-y-1 bg-base-300 rounded p-2 text-xs font-mono">
        {events.length === 0 ? (
          <div className="text-base-content/60 text-center py-4">
            {isPaused ? 'Paused - click play to resume' : 'Waiting for events...'}
          </div>
        ) : (
          events.map((event, index) => (
            <div
              key={event.id || index}
              className="border-b border-base-content/10 pb-1 mb-1 last:border-b-0"
            >
              <div className="flex items-center justify-between">
                <span className={`font-medium ${getEventTypeColor(event.type)}`}>
                  {event.type || 'UNKNOWN_TYPE'}
                </span>
                <span className="text-base-content/50 text-xs">
                  {event.timestamp
                    ? new Date(event.timestamp).toLocaleTimeString()
                    : 'No timestamp'}
                </span>
              </div>

              <div className="text-base-content/70 text-xs">
                Thread: {event.threadId || 'unknown'}
              </div>

              {event.data && (
                <div className="text-base-content/60 text-xs mt-1 break-words">
                  {formatEventData(event.data)}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={eventsEndRef} />
      </div>
    </div>
  );
}
