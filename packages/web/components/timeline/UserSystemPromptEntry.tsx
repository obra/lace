// ABOUTME: Timeline renderer for USER_SYSTEM_PROMPT events with markdown content and folding
// ABOUTME: Displays user system prompts with appropriate styling and expandable content

'use client';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faFileText } from '@/lib/fontawesome';
import { formatTime } from '@/lib/format';
import MarkdownRenderer from '@/components/ui/MarkdownRenderer';

interface UserSystemPromptEntryProps {
  content: string;
  timestamp: Date;
  isRecentMessage?: boolean;
}

export function UserSystemPromptEntry({ 
  content, 
  timestamp, 
  isRecentMessage = false 
}: UserSystemPromptEntryProps) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0">
        <div className="w-8 h-8 rounded-md bg-primary/20 text-primary flex items-center justify-center text-sm">
          <FontAwesomeIcon icon={faFileText} className="text-xs" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-medium text-sm text-base-content">User System Prompt</span>
          <span className="text-xs text-base-content/50">{formatTime(timestamp)}</span>
          <div className="badge badge-primary badge-xs">
            <FontAwesomeIcon icon={faUser} className="w-2 h-2 mr-1" />
            User
          </div>
        </div>
        <MarkdownRenderer
          content={content}
          maxLines={10}
          isRecentMessage={isRecentMessage}
        />
      </div>
    </div>
  );
}