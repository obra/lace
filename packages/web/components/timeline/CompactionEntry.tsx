// ABOUTME: Component for rendering COMPACTION events with expandable summary
// ABOUTME: Shows compaction stats and AI-generated summary when available

'use client';

import React from 'react';
import { useState } from 'react';
import { MessageHeader } from '@/components/ui';
import type { CompactionData } from '@/types/core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faChevronRight, faFolder } from '@/lib/fontawesome';

interface CompactionEntryProps {
  data: CompactionData;
  timestamp: Date | string;
}

export function CompactionEntry({ data, timestamp }: CompactionEntryProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const summary = data.metadata?.summary as string | undefined;
  const hasMetadata = Boolean(summary);
  const preservedMessages = data.metadata?.preservedUserMessages as number | undefined;
  const recentEvents = data.metadata?.recentEventCount as number | undefined;
  const strategy = (data.metadata?.strategy as string) || data.strategyId || 'unknown';

  return (
    <div className="my-4">
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-md bg-warning/10 text-warning flex items-center justify-center text-sm">
            <FontAwesomeIcon icon={faFolder} className="text-xs" />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <MessageHeader
            name="Compaction"
            timestamp={timestamp}
            badge={{ text: String(strategy), variant: 'warning' }}
          />

          <div className="bg-base-100 border border-warning/20 rounded-lg overflow-hidden">
            {/* Stats Bar */}
            <div className="p-3 bg-warning/5 border-b border-warning/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-base-content/70">
                    <strong className="text-base-content">{String(data.originalEventCount)}</strong>{' '}
                    →{' '}
                    <strong className="text-base-content">
                      {String(data.compactedEvents.length)}
                    </strong>{' '}
                    events
                  </span>
                  {preservedMessages !== undefined && preservedMessages > 0 && (
                    <span className="text-base-content/70">
                      <strong className="text-base-content">{String(preservedMessages)}</strong>{' '}
                      user messages preserved
                    </span>
                  )}
                  {recentEvents !== undefined && recentEvents > 0 && (
                    <span className="text-base-content/70">
                      <strong className="text-base-content">{String(recentEvents)}</strong> recent
                      events
                    </span>
                  )}
                </div>

                {hasMetadata && (
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-xs text-base-content/50 hover:text-base-content px-2 py-1 rounded hover:bg-base-200 flex items-center gap-1"
                  >
                    <FontAwesomeIcon
                      icon={isExpanded ? faChevronDown : faChevronRight}
                      className="text-xs"
                    />
                    {isExpanded ? 'Hide' : 'Show'} Summary
                  </button>
                )}
              </div>
            </div>

            {/* Summary Content */}
            {hasMetadata && isExpanded && (
              <div className="p-4 border-t border-base-200">
                <div className="prose prose-sm max-w-none text-base-content/80">
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">{summary || ''}</div>
                </div>
              </div>
            )}

            {/* No summary fallback */}
            {!hasMetadata && (
              <div className="p-3 text-center text-base-content/50 text-sm">
                Conversation history compacted to save memory
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
