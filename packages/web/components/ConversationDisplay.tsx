// ABOUTME: Terminal-like conversation display component that shows messages, tool calls, and agent status
// ABOUTME: Renders conversation events in a structured, color-coded terminal interface style

import React, { useMemo, useCallback } from 'react';
import type { SessionEvent, Agent, ThreadId } from '@/types/api';

interface ConversationDisplayProps {
  events: SessionEvent[];
  agents?: Agent[];
  selectedAgent?: ThreadId;
  className?: string;
  isLoading?: boolean;
}

export function ConversationDisplay({ events, agents, selectedAgent, className = '', isLoading = false }: ConversationDisplayProps) {
  // Filter events by selected agent if provided
  const filteredEvents = useMemo(() => {
    if (!selectedAgent) return events;
    
    // Include events from the selected agent and USER_MESSAGE events sent to that agent
    return events.filter(event => {
      // Always include user messages directed to the selected agent
      if (event.type === 'USER_MESSAGE' && event.threadId === selectedAgent) {
        return true;
      }
      
      // Include all other events from the selected agent
      return event.threadId === selectedAgent;
    });
  }, [events, selectedAgent]);

  // Process events to merge streaming tokens into complete messages
  const processedEvents = useMemo(() => {
    const processed: SessionEvent[] = [];
    const streamingMessages = new Map<string, { content: string; timestamp: string }>();
    const MAX_STREAMING_MESSAGES = 100; // Prevent unbounded growth
    
    for (const event of filteredEvents) {
      if (event.type === 'AGENT_TOKEN') {
        // Accumulate streaming tokens
        const key = `${event.threadId}-streaming`;
        const existing = streamingMessages.get(key);
        if (existing) {
          existing.content += event.data.token;
        } else {
          // Limit map size to prevent memory issues
          if (streamingMessages.size >= MAX_STREAMING_MESSAGES) {
            // Remove oldest entry
            const firstKey = streamingMessages.keys().next().value;
            if (firstKey) streamingMessages.delete(firstKey);
          }
          streamingMessages.set(key, {
            content: event.data.token,
            timestamp: event.timestamp,
          });
        }
      } else if (event.type === 'AGENT_MESSAGE') {
        // Complete message received, remove streaming version
        const key = `${event.threadId}-streaming`;
        streamingMessages.delete(key);
        processed.push(event);
      } else {
        processed.push(event);
      }
    }
    
    // Add any remaining streaming messages
    for (const [key, streamingData] of streamingMessages.entries()) {
      const threadId = key.replace('-streaming', '');
      processed.push({
        type: 'AGENT_STREAMING',
        threadId: threadId as ThreadId,
        timestamp: streamingData.timestamp,
        data: { content: streamingData.content },
      } as SessionEvent);
    }
    
    return processed;
  }, [filteredEvents]);

  // Helper to extract agent name from threadId
  const getAgentName = useCallback((threadId: ThreadId): string => {
    // Try to find agent in the provided list
    const agent = agents?.find((a) => a.threadId === threadId);
    if (agent) {
      return agent.name;
    }

    // Fallback to extracting from threadId
    const threadIdStr = String(threadId);
    const match = threadIdStr.match(/\.(\d+)$/);
    return match ? `Agent ${match[1]}` : 'Agent';
  }, [agents]);

  const renderEvent = useCallback((event: SessionEvent, index: number) => {
    const timestamp = new Date(event.timestamp).toLocaleTimeString();

    switch (event.type) {
      case 'USER_MESSAGE':
        return (
          <div key={index} className="mb-3" data-testid="message">
            <div className="text-xs text-gray-500">[{timestamp}]</div>
            <div className="flex items-start gap-2">
              <span className="text-2xl">👤</span>
              <div className="flex-1">
                <span className="text-blue-400 font-semibold">User: </span>
                <span className="text-gray-100">{event.data.content || event.data.message}</span>
              </div>
            </div>
          </div>
        );

      case 'THINKING':
        return event.data.status === 'start' ? (
          <div key={index} className="mb-2 text-gray-400 italic" data-testid="thinking-indicator">
            <div className="text-xs text-gray-500">[{timestamp}]</div>
            <div className="flex items-start gap-2">
              <span className="text-xl animate-pulse">🤔</span>
              <span>{getAgentName(event.threadId as ThreadId)}: Thinking...</span>
            </div>
          </div>
        ) : null;

      case 'AGENT_MESSAGE':
        return (
          <div key={index} className="mb-3" data-testid="agent-response">
            <div className="text-xs text-gray-500">[{timestamp}]</div>
            <div className="flex items-start gap-2">
              <span className="text-2xl">🤖</span>
              <div className="flex-1">
                <span className="text-green-400 font-semibold">
                  {getAgentName(event.threadId as ThreadId)}:{' '}
                </span>
                <span className="text-gray-100 whitespace-pre-wrap">{event.data.content}</span>
              </div>
            </div>
          </div>
        );

      case 'AGENT_STREAMING':
        return (
          <div key={index} className="mb-3" data-testid="streaming-response">
            <div className="text-xs text-gray-500">[{timestamp}]</div>
            <div className="flex items-start gap-2">
              <span className="text-2xl">🤖</span>
              <div className="flex-1">
                <span className="text-green-400 font-semibold">
                  {getAgentName(event.threadId as ThreadId)}:{' '}
                </span>
                <span className="text-gray-100 whitespace-pre-wrap">{event.data.content}</span>
                <span className="text-green-400 animate-pulse">▌</span>
              </div>
            </div>
          </div>
        );

      case 'TOOL_CALL':
        return (
          <div key={index} className="mb-2 ml-8">
            <div className="text-xs text-gray-500">[{timestamp}]</div>
            <div className="bg-gray-800 rounded p-2 text-sm font-mono">
              <span className="text-yellow-400">🔧 Tool Call: </span>
              <span className="text-cyan-400">{event.data.toolName}</span>
              {event.data.input != null && (
                <pre className="text-xs text-gray-400 mt-1">
                  {JSON.stringify(event.data.input, null, 2)}
                </pre>
              )}
            </div>
          </div>
        );

      case 'TOOL_RESULT':
        const formatToolResult = (result: unknown): string => {
          if (typeof result === 'string') {
            return result;
          }
          if (result && typeof result === 'object' && 'content' in result) {
            const content = (result as { content: unknown }).content;
            if (typeof content === 'string') {
              return content;
            }
            return JSON.stringify(content, null, 2);
          }
          return JSON.stringify(result, null, 2);
        };

        return (
          <div key={index} className="mb-2 ml-8">
            <div className="text-xs text-gray-500">[{timestamp}]</div>
            <div className="bg-gray-800 rounded p-2 text-sm">
              <span className="text-green-400">✅ Tool Result: </span>
              <span className="text-blue-400">{event.data.toolName}</span>
              <div className="mt-2 text-gray-300 whitespace-pre-wrap font-mono text-xs">
                {formatToolResult(event.data.result)}
              </div>
            </div>
          </div>
        );

      case 'LOCAL_SYSTEM_MESSAGE':
        return (
          <div key={index} className="mb-2 text-center" data-testid="error-message">
            <div className="text-xs text-gray-500">[{timestamp}]</div>
            <div className="text-gray-400 italic">— {event.data.message} —</div>
          </div>
        );

      default:
        return (
          <div key={index} className="mb-2 text-gray-500 text-sm">
            <div className="text-xs">[{timestamp}]</div>
            <div className="font-mono">
              {event.type}: {JSON.stringify(event.data)}
            </div>
          </div>
        );
    }
  }, [getAgentName]);

  // Loading skeleton component
  const LoadingSkeleton = () => (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="flex items-center space-x-2">
            <div className="w-20 h-4 bg-gray-700 rounded"></div>
            <div className="w-32 h-4 bg-gray-700 rounded"></div>
          </div>
          <div className="space-y-2 ml-4">
            <div className="h-4 bg-gray-800 rounded w-full max-w-md"></div>
            <div className="h-4 bg-gray-800 rounded w-3/4 max-w-md"></div>
            <div className="h-4 bg-gray-800 rounded w-1/2 max-w-md"></div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className={`bg-gray-900 rounded-lg p-4 overflow-y-auto ${className}`}>
      {isLoading ? (
        <LoadingSkeleton />
      ) : processedEvents.length === 0 ? (
        <div className="text-gray-500 text-center py-8">No messages yet. Start a conversation!</div>
      ) : (
        <div className="space-y-1">{processedEvents.map((event, index) => renderEvent(event, index))}</div>
      )}
    </div>
  );
}
