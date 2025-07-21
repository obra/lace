// ABOUTME: Design system message display component for conversation events
// ABOUTME: Renders individual messages using atomic design system components

import React from 'react';
import type { SessionEvent, Agent, ThreadId } from '@/types/api';
import MessageBubble from '@/components/ui/MessageBubble';
import MessageHeader from '@/components/ui/MessageHeader';
import AgentBadge from '@/components/ui/AgentBadge';
import CodeBlock from '@/components/ui/CodeBlock';
import { StreamingIndicator } from '@/components/ui/StreamingIndicator';

interface LaceMessageDisplayProps {
  event: SessionEvent;
  agent?: Agent;
  isStreaming?: boolean;
}

export function LaceMessageDisplay({ event, agent, isStreaming = false }: LaceMessageDisplayProps) {
  const timestamp = event.timestamp;
  const threadId = event.threadId;

  // Helper to get agent name for display
  const getAgentName = (): string => {
    if (agent) {
      return agent.name;
    }
    // Fallback: extract from threadId (e.g., "session-123.agent-1" -> "Agent 1")
    const parts = String(threadId).split('.');
    if (parts.length > 1) {
      const agentPart = parts.pop();
      return `Agent ${agentPart?.replace('agent-', '') || 'Unknown'}`;
    }
    return 'Agent';
  };

  // Helper to format tool parameters/results
  const formatToolData = (data: unknown): string => {
    if (data === null || data === undefined) {
      return 'null';
    }
    if (typeof data === 'string') {
      return data;
    }
    if (typeof data === 'object' && 'content' in (data as any)) {
      const content = (data as { content: unknown }).content;
      if (typeof content === 'string') {
        return content;
      }
    }
    return JSON.stringify(data, null, 2);
  };

  switch (event.type) {
    case 'USER_MESSAGE':
      return (
        <MessageBubble align="right" variant="user">
          <MessageHeader timestamp={timestamp} agent={undefined} />
          <div className="text-gray-100">
            {event.data.content || event.data.message || ''}
          </div>
        </MessageBubble>
      );

    case 'AGENT_MESSAGE':
      return (
        <MessageBubble align="left" variant="agent">
          <MessageHeader timestamp={timestamp} agent={getAgentName()} />
          {agent && (
            <AgentBadge 
              name={agent.name} 
              provider={agent.provider} 
              model={agent.model} 
            />
          )}
          <div className="text-gray-100 whitespace-pre-wrap">
            {event.data.content || ''}
          </div>
        </MessageBubble>
      );

    case 'AGENT_STREAMING':
      return (
        <MessageBubble align="left" variant="agent">
          <MessageHeader timestamp={timestamp} agent={getAgentName()} />
          {agent && (
            <AgentBadge 
              name={agent.name} 
              provider={agent.provider} 
              model={agent.model} 
            />
          )}
          <div className="text-gray-100 whitespace-pre-wrap">
            {event.data.content || ''}
            {isStreaming && <StreamingIndicator />}
          </div>
        </MessageBubble>
      );

    case 'TOOL_CALL':
      return (
        <div className="ml-8 mb-2">
          <MessageHeader timestamp={timestamp} agent={getAgentName()} />
          <div className="bg-gray-800 rounded p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-yellow-400">🔧</span>
              <span className="text-cyan-400 font-semibold">{event.data.toolName}</span>
            </div>
            {event.data.input != null && (
              <CodeBlock language="json">
                {formatToolData(event.data.input)}
              </CodeBlock>
            )}
            {event.data.input == null && (
              <CodeBlock language="json">
                null
              </CodeBlock>
            )}
          </div>
        </div>
      );

    case 'TOOL_RESULT':
      return (
        <div className="ml-8 mb-2">
          <MessageHeader timestamp={timestamp} agent={getAgentName()} />
          <div className="bg-gray-800 rounded p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-green-400">✅</span>
              <span className="text-blue-400 font-semibold">{event.data.toolName}</span>
            </div>
            <CodeBlock language="text">
              {formatToolData(event.data.result)}
            </CodeBlock>
          </div>
        </div>
      );

    case 'THINKING':
      if (event.data.status === 'start') {
        return (
          <MessageBubble align="left" variant="system">
            <MessageHeader timestamp={timestamp} agent={getAgentName()} />
            <div className="text-gray-400 italic flex items-center gap-2">
              <span className="animate-pulse">🤔</span>
              <span>{getAgentName()} is thinking...</span>
            </div>
          </MessageBubble>
        );
      }
      return null;

    case 'LOCAL_SYSTEM_MESSAGE':
      return (
        <MessageBubble align="center" variant="system">
          <MessageHeader timestamp={timestamp} agent={undefined} />
          <div className="text-gray-400 italic text-center">
            — {event.data.message} —
          </div>
        </MessageBubble>
      );

    default:
      // Fallback for unknown event types
      return (
        <MessageBubble align="left" variant="system">
          <MessageHeader timestamp={timestamp} agent={getAgentName()} />
          <div className="text-gray-500 text-sm">
            <div className="font-mono text-xs mb-1">{event.type}</div>
            <CodeBlock language="json">
              {JSON.stringify(event.data, null, 2)}
            </CodeBlock>
          </div>
        </MessageBubble>
      );
  }
}