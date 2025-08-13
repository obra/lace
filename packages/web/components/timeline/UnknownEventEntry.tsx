// ABOUTME: Timeline component for displaying unknown/unhandled events with expandable content
// ABOUTME: Renders event data with truncation, expansion, and formatted metadata table

'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faChevronRight, faQuestion, faCode } from '@/lib/fontawesome';

interface UnknownEventEntryProps {
  id: string;
  eventType: string;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  compact?: boolean;
}

const MAX_LINES = 4;

function truncateText(text: string, maxLines: number): { truncated: string; isTruncated: boolean } {
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return { truncated: text, isTruncated: false };
  }
  return {
    truncated: lines.slice(0, maxLines).join('\n'),
    isTruncated: true,
  };
}

function formatMetadataValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value as Record<string, unknown>).length} props}`;
  }
  return String(value);
}

function formatTimestamp(timestamp: Date): string {
  const now = new Date();
  const diff = now.getTime() - timestamp.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
}

export function UnknownEventEntry({
  id,
  eventType,
  content,
  timestamp,
  metadata = {},
  compact = false,
}: UnknownEventEntryProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

  const { truncated, isTruncated } = truncateText(content, MAX_LINES);
  const displayContent = isExpanded ? content : truncated;

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 bg-base-100 border border-warning/20 rounded-lg">
        <div className="w-8 h-8 bg-warning/20 rounded flex items-center justify-center text-warning">
          <FontAwesomeIcon icon={faQuestion} className="w-3 h-3" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-base-content truncate">
            Unknown event: {eventType}
          </div>
          <div className="text-xs text-base-content/60">
            System Event • {formatTimestamp(timestamp)}
          </div>
        </div>
        {isTruncated && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="btn btn-xs btn-ghost text-base-content/60"
          >
            <FontAwesomeIcon
              icon={isExpanded ? faChevronDown : faChevronRight}
              className="w-3 h-3"
            />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-base-100 border border-warning/20 rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-warning/20 rounded-lg flex items-center justify-center text-warning">
            <FontAwesomeIcon icon={faQuestion} className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-medium text-base-content">
              Unknown Event:{' '}
              <code className="font-mono text-xs bg-base-200 px-1 rounded">{eventType}</code>
            </div>
            <div className="text-xs text-base-content/60">
              System Event • {formatTimestamp(timestamp)}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {metadata && Object.keys(metadata).length > 0 && (
            <button
              onClick={() => setShowMetadata(!showMetadata)}
              className="btn btn-xs btn-ghost tooltip tooltip-bottom"
              data-tip="Show event metadata"
            >
              <FontAwesomeIcon icon={faCode} className="w-3 h-3" />
            </button>
          )}
          {isTruncated && (
            <button onClick={() => setIsExpanded(!isExpanded)} className="btn btn-xs btn-ghost">
              <FontAwesomeIcon
                icon={isExpanded ? faChevronDown : faChevronRight}
                className="w-3 h-3"
              />
              {isExpanded ? 'Collapse' : 'Expand'}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="space-y-3">
        <div className="text-sm text-base-content/80">
          <pre className="whitespace-pre-wrap font-mono text-xs bg-base-200 p-3 rounded border">
            {displayContent}
          </pre>
          {isTruncated && !isExpanded && (
            <div className="text-center mt-2">
              <button
                onClick={() => setIsExpanded(true)}
                className="text-xs text-primary hover:underline"
              >
                Show {content.split('\n').length - MAX_LINES} more lines...
              </button>
            </div>
          )}
        </div>

        {/* Metadata Table */}
        {showMetadata && metadata && Object.keys(metadata).length > 0 && (
          <div className="pt-3 border-t border-base-300">
            <div className="text-xs font-medium text-base-content/80 mb-2">Event Metadata:</div>
            <div className="overflow-x-auto">
              <table className="table table-xs table-zebra">
                <thead>
                  <tr>
                    <th className="font-medium text-base-content/80">Property</th>
                    <th className="font-medium text-base-content/80">Value</th>
                    <th className="font-medium text-base-content/80">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(metadata).map(([key, value]: [string, unknown]) => (
                    <tr key={key}>
                      <td className="font-mono text-xs">{key}</td>
                      <td className="font-mono text-xs break-all">{formatMetadataValue(value)}</td>
                      <td className="text-xs text-base-content/60">
                        {value === null ? 'null' : typeof value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
