'use client';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExternalLinkAlt } from '@/lib/fontawesome';

interface BaseIntegrationEntry {
  id: string;
  timestamp: Date;
  action: 'created' | 'shared' | 'updated' | 'completed' | 'posted' | 'commented';
  title: string;
  description?: string;
  url?: string;
  user?: {
    name: string;
    avatar?: string;
  };
}

interface GoogleDriveEntry extends BaseIntegrationEntry {
  type: 'google-drive';
  fileType: 'document' | 'spreadsheet' | 'presentation' | 'folder';
  sharedWith?: string[];
}

interface GoogleSheetsEntry extends BaseIntegrationEntry {
  type: 'google-sheets';
  sheetName: string;
  rowsAdded?: number;
  collaborators?: string[];
}

interface SlackEntry extends BaseIntegrationEntry {
  type: 'slack';
  channel: string;
  messagePreview?: string;
  reactions?: { emoji: string; count: number }[];
}

interface GitHubEntry extends BaseIntegrationEntry {
  type: 'github';
  repository: string;
  pullRequest?: number;
  commitCount?: number;
}

type IntegrationEntry = GoogleDriveEntry | GoogleSheetsEntry | SlackEntry | GitHubEntry;

interface IntegrationEntryProps {
  entry: IntegrationEntry;
  compact?: boolean;
}

export function IntegrationTimelineEntry({ entry, compact = false }: IntegrationEntryProps) {
  const getIntegrationIcon = (type: IntegrationEntry['type']) => {
    switch (type) {
      case 'google-drive':
        return { icon: '📁', color: 'bg-blue-500', name: 'Google Drive' };
      case 'google-sheets':
        return { icon: '📊', color: 'bg-green-500', name: 'Google Sheets' };
      case 'slack':
        return { icon: '#', color: 'bg-purple-500', name: 'Slack' };
      case 'github':
        return { icon: '🐙', color: 'bg-gray-800', name: 'GitHub' };
      default:
        return { icon: '🔗', color: 'bg-base-content', name: 'External' };
    }
  };

  const getActionText = (action: string, type: string) => {
    const actionMap: Record<string, Record<string, string>> = {
      'google-drive': {
        created: 'Created',
        shared: 'Shared',
        updated: 'Updated',
        completed: 'Completed',
      },
      'google-sheets': {
        created: 'Created',
        updated: 'Updated data in',
        shared: 'Shared',
        completed: 'Completed analysis in',
      },
      slack: {
        posted: 'Posted to',
        commented: 'Commented in',
        shared: 'Shared in',
      },
      github: {
        created: 'Created PR in',
        updated: 'Updated',
        completed: 'Merged PR in',
      },
    };

    return actionMap[type]?.[action] || action;
  };

  const formatTimestamp = (timestamp: Date) => {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'Just now';
  };

  const integrationInfo = getIntegrationIcon(entry.type);

  const renderTypeSpecificContent = () => {
    switch (entry.type) {
      case 'google-drive':
        const driveEntry = entry as GoogleDriveEntry;
        return (
          <div className="text-xs text-base-content/60 space-y-1">
            <div>File type: {driveEntry.fileType}</div>
            {driveEntry.sharedWith && driveEntry.sharedWith.length > 0 && (
              <div>Shared with: {driveEntry.sharedWith.join(', ')}</div>
            )}
          </div>
        );

      case 'google-sheets':
        const sheetsEntry = entry as GoogleSheetsEntry;
        return (
          <div className="text-xs text-base-content/60 space-y-1">
            <div>Sheet: {sheetsEntry.sheetName}</div>
            {sheetsEntry.rowsAdded && <div>Added {sheetsEntry.rowsAdded} rows</div>}
            {sheetsEntry.collaborators && (
              <div>Collaborators: {sheetsEntry.collaborators.join(', ')}</div>
            )}
          </div>
        );

      case 'slack':
        const slackEntry = entry as SlackEntry;
        return (
          <div className="text-xs text-base-content/60 space-y-1">
            <div>Channel: <span className="font-mono">{slackEntry.channel}</span></div>
            {slackEntry.messagePreview && (
              <div className="italic">&quot;{slackEntry.messagePreview}&quot;</div>
            )}
            {slackEntry.reactions && slackEntry.reactions.length > 0 && (
              <div className="flex gap-2">
                {slackEntry.reactions.map((reaction, index) => (
                  <span key={index} className="bg-base-200 px-1 rounded">
                    {reaction.emoji} {reaction.count}
                  </span>
                ))}
              </div>
            )}
          </div>
        );

      case 'github':
        const githubEntry = entry as GitHubEntry;
        return (
          <div className="text-xs text-base-content/60 space-y-1">
            <div>Repository: <span className="font-mono">{githubEntry.repository}</span></div>
            {githubEntry.pullRequest && <div>PR <span className="font-mono">#{githubEntry.pullRequest}</span></div>}
            {githubEntry.commitCount && <div>{githubEntry.commitCount} commits</div>}
          </div>
        );

      default:
        return null;
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 bg-base-100 border border-base-300 rounded-lg">
        <div
          className={`w-8 h-8 ${integrationInfo.color} rounded flex items-center justify-center text-white text-sm`}
        >
          {integrationInfo.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-base-content truncate">
            {getActionText(entry.action, entry.type)} {entry.title}
          </div>
          <div className="text-xs text-base-content/60">
            {integrationInfo.name} • {formatTimestamp(entry.timestamp)}
          </div>
        </div>
        {entry.url && (
          <button onClick={() => window.open(entry.url, '_blank')} className="btn btn-xs btn-ghost">
            <FontAwesomeIcon icon={faExternalLinkAlt} className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-base-100 border border-base-300 rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 ${integrationInfo.color} rounded-lg flex items-center justify-center text-white`}
          >
            {integrationInfo.icon}
          </div>
          <div>
            <div className="text-sm font-medium text-base-content">
              {getActionText(entry.action, entry.type)} &quot;{entry.title}&quot;
            </div>
            <div className="text-xs text-base-content/60">
              {integrationInfo.name} • {formatTimestamp(entry.timestamp)}
              {entry.user && ` • by ${entry.user.name}`}
            </div>
          </div>
        </div>

        {entry.url && (
          <button
            onClick={() => window.open(entry.url, '_blank')}
            className="btn btn-sm btn-outline"
          >
            <FontAwesomeIcon icon={faExternalLinkAlt} className="w-3 h-3 mr-1" />
            Open
          </button>
        )}
      </div>

      {/* Description */}
      {entry.description && <div className="text-sm text-base-content/80">{entry.description}</div>}

      {/* Type-specific content */}
      <div className="pt-2 border-t border-base-300">{renderTypeSpecificContent()}</div>
    </div>
  );
}

export { IntegrationTimelineEntry as IntegrationEntry };
