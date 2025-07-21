'use client';

import { useEffect, useRef } from 'react';
import { TimelineEntry } from '@/types';
import { TimelineMessage } from '@/components/timeline/TimelineMessage';
import { TypingIndicator } from '@/components/timeline/TypingIndicator';

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
    <div ref={containerRef} className="h-full overflow-y-auto overscroll-contain">
      <div className="p-4 space-y-4 pb-32">
        {entries.length === 0 && (
          <div className="text-gray-400 text-center py-8">
            No conversation data loaded. {entries.length} entries.
          </div>
        )}
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
