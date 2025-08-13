// ABOUTME: Timeline renderer for SYSTEM_PROMPT events with markdown content and folding
// ABOUTME: Displays system prompts with appropriate styling and expandable content

'use client';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCog } from '@/lib/fontawesome';
import { formatTime } from '@/lib/format';
import MarkdownRenderer from '@/components/ui/MarkdownRenderer';

interface SystemPromptEntryProps {
  content: string;
  timestamp: Date;
  isRecentMessage?: boolean;
}

export function SystemPromptEntry({
  content,
  timestamp,
  isRecentMessage = false,
}: SystemPromptEntryProps) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0">
        <div className="w-8 h-8 rounded-md bg-base-300 text-base-content/60 flex items-center justify-center text-sm">
          <FontAwesomeIcon icon={faCog} className="text-xs" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-medium text-sm text-base-content">System Prompt</span>
          <span className="text-xs text-base-content/50">{formatTime(timestamp)}</span>
          <div className="badge badge-ghost badge-xs">System</div>
        </div>
        <MarkdownRenderer content={content} maxLines={10} isRecentMessage={isRecentMessage} />
      </div>
    </div>
  );
}
