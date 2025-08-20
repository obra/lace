// ABOUTME: Compaction indicator component that shows when conversation compaction is in progress
// ABOUTME: Displays a loading spinner and status message for auto vs manual compaction

'use client';

import React from 'react';
import type { CompactionState } from '@/components/providers/EventStreamProvider';

interface CompactionIndicatorProps {
  compactionState: CompactionState;
}

export function CompactionIndicator({ compactionState }: CompactionIndicatorProps) {
  const { isAuto, compactingAgentId } = compactionState;

  return (
    <div className="flex items-center justify-center p-3">
      <div className="flex items-center space-x-3 text-sm text-base-content/70 bg-base-200 rounded-lg px-4 py-2">
        {/* Spinning indicator */}
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent"></div>

        <div className="flex flex-col">
          <span className="font-medium">Compacting conversation...</span>
          <span className="text-xs opacity-75">
            {isAuto ? 'Auto-triggered' : 'Manual'} compaction in progress
            {compactingAgentId && ` (${compactingAgentId})`}
          </span>
        </div>
      </div>
    </div>
  );
}
