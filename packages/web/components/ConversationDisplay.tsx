// ABOUTME: Terminal-like conversation display component that shows messages, tool calls, and agent status
// ABOUTME: Renders conversation events in a structured, color-coded terminal interface style

import React from 'react';
import type { SessionEvent, Agent } from '@/types/api';

interface ConversationDisplayProps {
  events: SessionEvent[];
  agents?: Agent[];
  className?: string;
}

export function ConversationDisplay({ events, agents, className = '' }: ConversationDisplayProps) {
  const renderEvent = (event: SessionEvent, index: number) => {
    const timestamp = new Date(event.timestamp).toLocaleTimeString();

    switch (event.type) {
      case 'USER_MESSAGE':
        return (
          <div key={index} className="mb-3">
            <div className="text-xs text-gray-500">[{timestamp}]</div>
            <div className="flex items-start gap-2">
              <span className="text-2xl">👤</span>
              <div className="flex-1">
                <span className="text-blue-400 font-semibold">User: </span>
                <span className="text-gray-100">{event.data?.content}</span>
              </div>
            </div>
          </div>
        );

      case 'THINKING':
        return event.data?.status === 'start' ? (
          <div key={index} className="mb-2 text-gray-400 italic">
            <div className="text-xs text-gray-500">[{timestamp}]</div>
            <div className="flex items-start gap-2">
              <span className="text-xl animate-pulse">🤔</span>
              <span>{getAgentName(event.threadId)}: Thinking...</span>
            </div>
          </div>
        ) : null;

      case 'AGENT_MESSAGE':
        return (
          <div key={index} className="mb-3">
            <div className="text-xs text-gray-500">[{timestamp}]</div>
            <div className="flex items-start gap-2">
              <span className="text-2xl">🤖</span>
              <div className="flex-1">
                <span className="text-green-400 font-semibold">
                  {getAgentName(event.threadId)}:{' '}
                </span>
                <span className="text-gray-100 whitespace-pre-wrap">{event.data?.content}</span>
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
              <span className="text-cyan-400">{event.data?.toolName}</span>
              {event.data?.input && (
                <pre className="text-xs text-gray-400 mt-1">
                  {JSON.stringify(event.data.input, null, 2)}
                </pre>
              )}
            </div>
          </div>
        );

      case 'TOOL_RESULT':
        return (
          <div key={index} className="mb-2 ml-8">
            <div className="text-xs text-gray-500">[{timestamp}]</div>
            <div className="bg-gray-800 rounded p-2 text-sm">
              <span className="text-green-400">✅ Tool Result: </span>
              <span className="text-gray-300">{event.data?.toolName} completed</span>
            </div>
          </div>
        );

      case 'LOCAL_SYSTEM_MESSAGE':
        return (
          <div key={index} className="mb-2 text-center">
            <div className="text-xs text-gray-500">[{timestamp}]</div>
            <div className="text-gray-400 italic">— {event.data?.message} —</div>
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
  };

  // Helper to extract agent name from threadId
  const getAgentName = (threadId: string): string => {
    // Try to find agent in the provided list
    const agent = agents?.find((a) => a.threadId === threadId);
    if (agent) {
      return agent.name;
    }

    // Fallback to extracting from threadId
    const match = threadId.match(/\.(\d+)$/);
    return match ? `Agent ${match[1]}` : 'Agent';
  };

  return (
    <div className={`bg-gray-900 rounded-lg p-4 overflow-y-auto ${className}`}>
      {events.length === 0 ? (
        <div className="text-gray-500 text-center py-8">No messages yet. Start a conversation!</div>
      ) : (
        <div className="space-y-1">{events.map((event, index) => renderEvent(event, index))}</div>
      )}
    </div>
  );
}
