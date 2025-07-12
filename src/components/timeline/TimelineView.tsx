'use client';

import { useEffect, useRef } from 'react';
import { TimelineEntry } from '~/types';
import { TimelineMessage } from './TimelineMessage';
import { TypingIndicator } from './TypingIndicator';

interface TimelineViewProps {
  entries: TimelineEntry[];
  isTyping: boolean;
  currentAgent: string;
}

export function TimelineView({ entries, isTyping, currentAgent }: TimelineViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries, isTyping]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto overscroll-contain">
      <div className="p-4 space-y-4 pb-32">
        {entries.map((entry) => (
          <TimelineMessage key={entry.id} entry={entry} />
        ))}

        {isTyping && <TypingIndicator agent={currentAgent} />}
      </div>
    </div>
  );
}
