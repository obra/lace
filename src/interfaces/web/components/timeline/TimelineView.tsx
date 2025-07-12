// ABOUTME: Main timeline view component displaying conversation entries with auto-scroll
// ABOUTME: Handles both completed messages and streaming content display

'use client';

import React, { useEffect, useRef } from 'react';
import { TimelineEntry } from '../../types/chat';
import { TimelineMessage } from './TimelineMessage';
import { TypingIndicator } from './TypingIndicator';

interface TimelineViewProps {
  entries: TimelineEntry[];
  isTyping: boolean;
  currentAgent: string;
  streamingContent?: string;
}

export function TimelineView({
  entries,
  isTyping,
  currentAgent,
  streamingContent,
}: TimelineViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries, isTyping, streamingContent]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto overscroll-contain">
      <div className="p-4 space-y-4 pb-32">
        {entries.map((entry) => (
          <TimelineMessage key={entry.id} entry={entry} />
        ))}

        {streamingContent && (
          <TimelineMessage
            entry={{
              id: 'streaming',
              type: 'ai',
              content: streamingContent,
              agent: currentAgent,
              timestamp: new Date(),
            }}
          />
        )}

        {isTyping && !streamingContent && <TypingIndicator agent={currentAgent} />}
      </div>
    </div>
  );
}