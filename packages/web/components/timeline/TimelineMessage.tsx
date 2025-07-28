'use client';

import { TimelineEntry } from '@/types';
import { MessageHeader, MessageText, AgentBadge, TimestampDisplay } from '@/components/ui';
import { ToolCallDisplay } from '@/components/ui/ToolCallDisplay';
import { IntegrationEntry } from '@/components/timeline/IntegrationEntry';
import { UnknownEventEntry } from '@/components/timeline/UnknownEventEntry';
import GoogleDocChatMessage from '@/components/organisms/GoogleDocChatMessage';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faImages, faExternalLinkAlt, faUser, faRobot } from '@/lib/fontawesome';
import { formatTime } from '@/lib/format';

interface TimelineMessageProps {
  /** The timeline entry data to display with type discrimination for different message types */
  entry: TimelineEntry;
}

/**
 * TimelineMessage is a complex organism that renders different types of timeline entries
 * in a conversation interface. It handles multiple message types (human, AI, tool, 
 * integration, carousel, Google Doc) with appropriate styling and interactions.
 * 
 * @component
 * @example
 * ```tsx
 * <TimelineMessage entry={humanMessageEntry} />
 * <TimelineMessage entry={aiMessageEntry} />
 * <TimelineMessage entry={toolMessageEntry} />
 * ```
 */
export function TimelineMessage({ entry }: TimelineMessageProps) {
  // Admin Messages
  if (entry.type === 'admin') {
    return (
      <div className="flex justify-center">
        <div className="bg-base-200 border border-base-300 rounded-full px-4 py-2 text-sm text-base-content/70">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-info rounded-full"></div>
            <span>{entry.content}</span>
          </div>
        </div>
      </div>
    );
  }

  // Tool Messages - use enhanced display for aggregated tools, fallback for legacy
  if (entry.type === 'tool') {
    // Check if this is an aggregated tool call with metadata
    if (entry.metadata && entry.metadata.toolId) {
      return (
        <ToolCallDisplay
          tool={entry.tool || 'Unknown Tool'}
          content={entry.content || ''}
          result={entry.result}
          timestamp={entry.timestamp}
          metadata={entry.metadata}
        />
      );
    }
    
    // Legacy tool display for backwards compatibility
    return (
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-md bg-teal-100 text-teal-700 flex items-center justify-center text-sm">
            <div className="w-3 h-3 bg-teal-600 rounded"></div>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <MessageHeader
            name="Tool"
            timestamp={entry.timestamp}
            badge={entry.tool ? { text: entry.tool, variant: 'info' } : undefined}
          />
          <div className="text-sm font-mono bg-base-200 rounded-lg p-3 border border-base-300">
            <div className="text-base-content/80 mb-2 font-mono">$ {entry.content}</div>
            {entry.result && (
              <div className="text-base-content/60 text-xs whitespace-pre-wrap font-mono">{entry.result}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Human Messages
  if (entry.type === 'human') {
    return (
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <MessageHeader
            name="You"
            timestamp={entry.timestamp}
            role="user"
          />
          <MessageText content={entry.content || ''} />
        </div>
      </div>
    );
  }

  // AI Messages
  if (entry.type === 'ai') {
    return (
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <MessageHeader
            name={entry.agent || 'Assistant'}
            timestamp={entry.timestamp}
            role="assistant"
            badge={entry.agent ? { text: entry.agent, variant: 'primary' } : undefined}
          />
          <MessageText content={entry.content || ''} />
        </div>
      </div>
    );
  }

  // Unknown events with expandable content and metadata
  if (entry.type === 'unknown') {
    return (
      <UnknownEventEntry
        id={entry.id.toString()}
        eventType={entry.eventType || 'UNKNOWN'}
        content={entry.content || ''}
        timestamp={entry.timestamp}
        metadata={entry.metadata}
      />
    );
  }

  // Integration
  if (entry.type === 'integration') {
    const baseEntry = {
      id: entry.id.toString(),
      action: entry.action as 'created' | 'updated' | 'shared' | 'completed',
      title: entry.title || '',
      description: entry.description || '',
      url: entry.link,
      timestamp: entry.timestamp,
    };

    let integrationEntry;
    switch (entry.tool) {
      case 'Google Drive':
        integrationEntry = {
          ...baseEntry,
          type: 'google-drive' as const,
          fileType: 'document' as const,
          sharedWith: ['user@example.com'],
        };
        break;
      case 'Google Sheets':
        integrationEntry = {
          ...baseEntry,
          type: 'google-sheets' as const,
          sheetName: 'Sheet1',
          rowsAdded: 100,
          collaborators: ['user@example.com'],
        };
        break;
      case 'Slack':
        integrationEntry = {
          ...baseEntry,
          type: 'slack' as const,
          channel: '#development',
          messagePreview: entry.description,
        };
        break;
      case 'GitHub':
        integrationEntry = {
          ...baseEntry,
          type: 'github' as const,
          repository: 'lace',
          pullRequest: 123,
        };
        break;
      default:
        integrationEntry = {
          ...baseEntry,
          type: 'google-drive' as const,
          fileType: 'document' as const,
          sharedWith: ['user@example.com'],
        };
    }

    return <IntegrationEntry entry={integrationEntry} />;
  }

  // Carousel
  if (entry.type === 'carousel' && entry.items) {
    return (
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-md bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 flex items-center justify-center text-sm">
            <FontAwesomeIcon icon={faImages} className="text-xs" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-base-content">{entry.title}</h3>
            <span className="text-xs text-base-content/50">{formatTime(entry.timestamp)}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {entry.items.map((item, index) => (
              <div key={index} className="card bg-base-100 shadow-sm border border-base-300">
                <div className="card-body p-3">
                  <div className="flex items-start justify-between">
                    <h4 className="card-title text-sm">{item.title}</h4>
                    <div
                      className={`badge badge-sm ${
                        item.type === 'feature'
                          ? 'badge-success'
                          : item.type === 'bugfix'
                            ? 'badge-error'
                            : item.type === 'refactor'
                              ? 'badge-warning'
                              : 'badge-ghost'
                      }`}
                    >
                      {item.type}
                    </div>
                  </div>
                  <p className="text-xs text-base-content/70 mt-2">{item.description}</p>

                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-base-content/50">Impact:</span>
                      <div className="flex gap-1">
                        {[1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className={`w-2 h-2 rounded-full ${
                              item.impact === 'high' && i <= 3
                                ? 'bg-error'
                                : item.impact === 'medium' && i <= 2
                                  ? 'bg-warning'
                                  : item.impact === 'low' && i <= 1
                                    ? 'bg-success'
                                    : 'bg-base-300'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                    <span className="text-xs font-mono text-base-content/50">{item.commit}</span>
                  </div>

                  <div className="mt-3">
                    <span className="text-xs text-base-content/50 block mb-1">Files:</span>
                    {item.files.slice(0, 2).map((file, i) => (
                      <div key={i} className="text-xs bg-base-200 px-2 py-1 rounded mb-1 font-mono">
                        {file}
                      </div>
                    ))}
                    {item.files.length > 2 && (
                      <div className="text-xs text-base-content/50">
                        +{item.files.length - 2} more files
                      </div>
                    )}
                  </div>

                  <div className="card-actions justify-end mt-3">
                    <button className="btn btn-xs btn-outline">
                      <FontAwesomeIcon icon={faExternalLinkAlt} className="mr-1" />
                      View
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Google Doc Messages
  if (entry.type === 'google-doc') {
    const message = {
      id: entry.id.toString(),
      role: entry.agent ? ('assistant' as const) : ('user' as const),
      content: entry.content || '',
      timestamp: entry.timestamp,
      document: entry.document,
    };

    return (
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div
            className={`w-8 h-8 rounded-md flex items-center justify-center text-sm font-medium ${
              entry.agent ? 'bg-orange-500 text-white' : 'bg-teal-600 text-white'
            }`}
          >
            <FontAwesomeIcon icon={entry.agent ? faRobot : faUser} className="text-xs" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-medium text-sm text-base-content">{entry.agent || 'You'}</span>
            <span className="text-xs text-base-content/50">{formatTime(entry.timestamp)}</span>
            {entry.agent && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-orange-900/20 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
                {entry.agent}
              </span>
            )}
          </div>
          <div className="bg-base-100 border border-base-300 rounded-lg overflow-hidden">
            <GoogleDocChatMessage message={message} />
          </div>
        </div>
      </div>
    );
  }

  return null;
}
