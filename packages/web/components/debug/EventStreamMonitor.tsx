// ABOUTME: Real-time SSE event stream monitor for debugging
// ABOUTME: Shows live events with truncated payloads and connection status

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircle, faTrash, faPause, faPlay, faFilter } from '@/lib/fontawesome';
import { parseTyped } from '@/lib/serialization';
import { useEventStream } from '@/hooks/useEventStream';
import { useSSEStore } from '@/lib/sse-store';
import type { LaceEvent } from '@/types/core';
interface EventStreamMonitorProps {
  maxEvents?: number;
}

export function EventStreamMonitor({ maxEvents = 1000 }: EventStreamMonitorProps) {
  const [events, setEvents] = useState<LaceEvent[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [hideTokenEvents, setHideTokenEvents] = useState(true); // Hide noisy token events by default
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const pauseRef = useRef(false);

  // Get connection status from shared Zustand store
  const connectionStatus = useSSEStore((state) =>
    state.connectionStatus === 'connected'
      ? 'connected'
      : state.connectionStatus === 'connecting'
        ? 'connecting'
        : 'disconnected'
  );

  // Update pause ref when isPaused changes (without triggering reconnection)
  useEffect(() => {
    pauseRef.current = isPaused;
  }, [isPaused]);

  // Filter events for display
  const filteredEvents = hideTokenEvents
    ? events.filter((event) => event.type !== 'AGENT_TOKEN')
    : events;

  // Scroll to bottom when new events arrive (only if not paused)
  useEffect(() => {
    if (!pauseRef.current) {
      eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events]);

  // Use shared EventStream instead of direct EventSource
  useEventStream({
    onSessionEvent: (event) => {
      // Check pause state via ref (no dependency on isPaused state)
      if (pauseRef.current) return;

      setEvents((prev) => {
        const newEvents = [...prev, event].slice(-maxEvents);
        return newEvents;
      });
    },
  });

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
          <span className="text-xs text-base-content/60">
            ({filteredEvents.length}/{events.length} events)
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setHideTokenEvents((prev) => !prev)}
            className={`btn btn-xs ${hideTokenEvents ? 'btn-primary' : 'btn-ghost'}`}
            title={hideTokenEvents ? 'Show Token Events' : 'Hide Token Events'}
          >
            <FontAwesomeIcon icon={faFilter} className="w-3 h-3" />
          </button>
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
        {filteredEvents.length === 0 ? (
          <div className="text-base-content/60 text-center py-4">
            {isPaused
              ? 'Paused - click play to resume'
              : hideTokenEvents && events.length > 0
                ? 'Only token events (filtered out)'
                : 'Waiting for events...'}
          </div>
        ) : (
          filteredEvents.map((event, index) => (
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
                Thread: {event.context?.threadId || 'none'}
                {event.context?.sessionId && (
                  <span className="ml-2">Session: {event.context.sessionId}</span>
                )}
              </div>

              {/* Collapsible full event data */}
              <div className="collapse collapse-arrow mt-1">
                <input type="checkbox" />
                <div className="collapse-title text-xs p-0 min-h-0">
                  <span className="text-base-content/60">Show full data</span>
                </div>
                <div className="collapse-content text-xs p-0">
                  <pre className="text-base-content/50 text-xs mt-1 whitespace-pre-wrap break-words font-mono">
                    {JSON.stringify(event, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={eventsEndRef} />
      </div>
    </div>
  );
}
