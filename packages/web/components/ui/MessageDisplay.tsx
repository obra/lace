import { MessageHeader, MessageText, Avatar, AgentBadge, TimestampDisplay } from '@/components/ui';

interface MessageDisplayProps {
  type: 'human' | 'ai' | 'admin' | 'tool';
  content: string;
  timestamp: Date | string;
  agent?: string;
  name?: string;
  role?: 'user' | 'assistant';
  tool?: string;
  result?: string;
  className?: string;
}

export default function MessageDisplay({
  type,
  content,
  timestamp,
  agent,
  name,
  role,
  tool,
  result,
  className = '',
}: MessageDisplayProps) {
  // Admin Messages
  if (type === 'admin') {
    return (
      <div className={`flex justify-center ${className}`}>
        <div className="bg-base-200 border border-base-300 rounded-full px-4 py-2 text-sm text-base-content/70">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-info rounded-full"></div>
            <span>{content}</span>
          </div>
        </div>
      </div>
    );
  }

  // Tool Messages
  if (type === 'tool') {
    return (
      <div className={`flex gap-3 ${className}`}>
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-md bg-teal-100 text-teal-700 flex items-center justify-center text-sm">
            <div className="w-3 h-3 bg-teal-600 rounded"></div>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <MessageHeader
            name="Tool"
            timestamp={timestamp}
            badge={tool ? { text: tool, variant: 'info' } : undefined}
          />
          <div className="text-sm font-mono bg-base-200 rounded-lg p-3 border border-base-300">
            <div className="text-base-content/80 mb-2 font-mono">$ {content}</div>
            {result && (
              <div className="text-base-content/60 text-xs whitespace-pre-wrap font-mono">{result}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Human Messages
  if (type === 'human') {
    return (
      <div className={`flex gap-3 ${className}`}>
        <div className="flex-1 min-w-0">
          <MessageHeader
            name={name || 'You'}
            timestamp={timestamp}
            role="user"
          />
          <MessageText content={content} />
        </div>
      </div>
    );
  }

  // AI Messages
  if (type === 'ai') {
    return (
      <div className={`flex gap-3 ${className}`}>
        <div className="flex-1 min-w-0">
          <MessageHeader
            name={agent || name || 'Assistant'}
            timestamp={timestamp}
            role="assistant"
            badge={agent ? { text: agent, variant: 'primary' } : undefined}
          />
          <MessageText content={content} />
        </div>
      </div>
    );
  }

  // Fallback for unknown types
  return (
    <div className={`flex gap-3 ${className}`}>
      <div className="flex-shrink-0">
        <div className="w-8 h-8 rounded-md bg-base-300 flex items-center justify-center text-sm">
          ?
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <MessageHeader
          name={name || 'Unknown'}
          timestamp={timestamp}
        />
        <MessageText content={content} />
      </div>
    </div>
  );
}