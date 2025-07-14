'use client';

import { TimelineEntry } from '~/types';
import { formatTime } from '~/utils/format';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faInfoCircle,
  faUser,
  faRobot,
  faTerminal,
  faExternalLinkAlt,
  faImages,
} from '~/lib/fontawesome';
import { IntegrationEntry } from '~/components/timeline/IntegrationEntry';
import GoogleDocChatMessage from '~/components/chat/GoogleDocChatMessage';

interface TimelineMessageProps {
  entry: TimelineEntry;
}

export function TimelineMessage({ entry }: TimelineMessageProps) {
  const renderMessage = (content: string) => {
    // Code block formatting
    let formatted = content.replace(
      /```(\w+)?\n([\s\S]*?)```/g,
      (_match, lang: string, code: string) => {
        return `<div class="bg-base-300 border border-base-content/20 rounded-lg p-3 my-2 overflow-x-auto">
        <div class="text-xs text-base-content/60 mb-2">${lang || 'code'}</div>
        <pre class="text-accent text-sm"><code>${escapeHtml(code.trim())}</code></pre>
      </div>`;
      }
    );

    // Inline code formatting
    formatted = formatted.replace(
      /`([^`]+)`/g,
      '<code class="bg-base-300 px-2 py-1 rounded text-accent text-sm">$1</code>'
    );

    // Newline formatting
    formatted = formatted.replace(/\n/g, '<br>');

    return formatted;
  };

  const escapeHtml = (text: string) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  // Admin Messages
  if (entry.type === 'admin') {
    return (
      <div className="flex justify-center">
        <div className="bg-base-200 border border-base-300 rounded-full px-4 py-2 text-sm text-base-content/70">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faInfoCircle} className="w-4 h-4 text-info" />
            <span>{entry.content}</span>
          </div>
        </div>
      </div>
    );
  }

  // Human Messages
  if (entry.type === 'human') {
    return (
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-md bg-teal-600 text-white flex items-center justify-center text-sm font-medium">
            <FontAwesomeIcon icon={faUser} className="text-xs" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-medium text-sm text-base-content">You</span>
            <span className="text-xs text-base-content/50">{formatTime(entry.timestamp)}</span>
          </div>
          <div
            className="text-sm leading-relaxed text-base-content"
            dangerouslySetInnerHTML={{ __html: renderMessage(entry.content || '') }}
          />
        </div>
      </div>
    );
  }

  // AI Messages
  if (entry.type === 'ai') {
    const agentColors = {
      Claude: 'bg-orange-500 text-white',
      'GPT-4': 'bg-green-600 text-white',
      Gemini: 'bg-blue-600 text-white',
    };

    const agentBadgeColors = {
      Claude: 'bg-orange-900/20 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
      'GPT-4': 'bg-green-900/20 text-green-600 dark:bg-green-900/30 dark:text-green-400',
      Gemini: 'bg-blue-900/20 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    };

    return (
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div
            className={`w-8 h-8 rounded-md flex items-center justify-center text-sm font-medium ${
              agentColors[entry.agent as keyof typeof agentColors] || 'bg-gray-600 text-white'
            }`}
          >
            <FontAwesomeIcon icon={faRobot} className="text-xs" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-medium text-sm text-base-content">{entry.agent}</span>
            <span className="text-xs text-base-content/50">{formatTime(entry.timestamp)}</span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                agentBadgeColors[entry.agent as keyof typeof agentBadgeColors] ||
                'bg-base-content/10 text-base-content/60'
              }`}
            >
              {entry.agent}
            </span>
          </div>
          <div
            className="text-sm leading-relaxed text-base-content"
            dangerouslySetInnerHTML={{ __html: renderMessage(entry.content || '') }}
          />
        </div>
      </div>
    );
  }

  // Tool Call
  if (entry.type === 'tool') {
    return (
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-md bg-teal-100 text-teal-700 flex items-center justify-center text-sm">
            <FontAwesomeIcon icon={faTerminal} className="text-xs" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-medium text-sm text-base-content">Tool</span>
            <span className="text-xs text-base-content/50">{formatTime(entry.timestamp)}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-base-content/10 text-base-content/60">
              {entry.tool}
            </span>
          </div>
          <div className="text-sm font-mono bg-base-200 rounded-lg p-3 border border-base-300">
            <div className="text-base-content/80 mb-2">$ {entry.content}</div>
            <div className="text-base-content/60 text-xs whitespace-pre-wrap">{entry.result}</div>
          </div>
        </div>
      </div>
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
