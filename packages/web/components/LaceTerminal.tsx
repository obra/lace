// ABOUTME: Main terminal-like interface component for Lace web UI
// ABOUTME: Displays messages, handles input, and manages real-time updates

import React, { useState, useRef, useEffect } from 'react';
import { Session, Agent, SessionEvent, ThreadId } from '@/types/api';
import { useSSEStream } from '@/hooks/useSSEStream';
import { useSessionAPI } from '@/hooks/useSessionAPI';
import { AgentSpawner } from '@/components/AgentSpawner';

interface LaceTerminalProps {
  session: Session;
  onAgentSpawn: (agent: Agent) => void;
}

interface Message {
  id: string;
  type: 'user' | 'agent' | 'system' | 'thinking' | 'tool';
  content: string;
  threadId: ThreadId;
  timestamp: string;
  metadata?: any;
}

export function LaceTerminal({ session, onAgentSpawn }: LaceTerminalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [activeAgentId, setActiveAgentId] = useState<ThreadId | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { connected, events, error: sseError } = useSSEStream(session.id);
  const { sendMessage, loading } = useSessionAPI();

  // Process SSE events into messages
  useEffect(() => {
    const processedEvents = events
      .map((event) => {
        const messageId = `${event.threadId}-${event.timestamp}`;

        switch (event.type) {
          case 'USER_MESSAGE':
            return {
              id: messageId,
              type: 'user' as const,
              content: event.data.content || event.data.message || '',
              threadId: event.threadId,
              timestamp: event.timestamp,
            };

          case 'AGENT_MESSAGE':
            return {
              id: messageId,
              type: 'agent' as const,
              content: event.data.content || '',
              threadId: event.threadId,
              timestamp: event.timestamp,
            };

          case 'THINKING':
            return {
              id: messageId,
              type: 'thinking' as const,
              content: event.data.status === 'start' ? 'Thinking...' : '',
              threadId: event.threadId,
              timestamp: event.timestamp,
            };

          case 'TOOL_CALL':
            return {
              id: messageId,
              type: 'tool' as const,
              content: `Calling tool: ${event.data.name || 'unknown'}`,
              threadId: event.threadId,
              timestamp: event.timestamp,
              metadata: event.data,
            };

          case 'TOOL_RESULT':
            return {
              id: messageId,
              type: 'tool' as const,
              content: `Tool result: ${JSON.stringify(event.data.result || event.data, null, 2)}`,
              threadId: event.threadId,
              timestamp: event.timestamp,
              metadata: event.data,
            };

          default:
            return null;
        }
      })
      .filter(Boolean) as Message[];

    if (processedEvents.length > 0) {
      setMessages((prev) => [...prev, ...processedEvents]);
    }
  }, [events]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Set default active agent
  useEffect(() => {
    if (!activeAgentId && session.agents.length > 0) {
      setActiveAgentId(session.agents[0].threadId);
    }
  }, [session.agents, activeAgentId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!input.trim() || loading) return;

    const targetThreadId = activeAgentId || session.id;
    const message = input.trim();

    // Add user message immediately
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: message,
      threadId: targetThreadId,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Clear input
    setInput('');

    // Send message
    await sendMessage(targetThreadId, message);
  };

  const getAgentName = (threadId: ThreadId): string => {
    const agent = session.agents.find((a) => a.threadId === threadId);
    return agent?.name || 'Unknown';
  };

  return (
    <div className="terminal-container h-full flex flex-col">
      <div className="terminal-header">
        <div>
          <h1 className="font-bold">{session.name}</h1>
          <p className="text-xs text-gray-400">
            {connected ? (
              <span className="text-terminal-green">● Connected</span>
            ) : (
              <span className="text-terminal-red">● Disconnected</span>
            )}
            {sseError && <span className="ml-2 text-terminal-red">{sseError}</span>}
          </p>
        </div>
        <AgentSpawner sessionId={session.id} agents={session.agents} onAgentSpawn={onAgentSpawn} />
      </div>

      <div className="terminal-content scrollbar-terminal flex-1">
        {messages.map((message) => (
          <div key={message.id} className="mb-3">
            <div className="flex items-start gap-2">
              <span className="text-xs text-gray-500 mt-1">
                {new Date(message.timestamp).toLocaleTimeString()}
              </span>
              <div className="flex-1">
                {message.type === 'user' && (
                  <div className="message-user">
                    <span className="terminal-prompt">❯</span> {message.content}
                  </div>
                )}
                {message.type === 'agent' && (
                  <div className="message-agent">
                    <span className="text-terminal-purple">{getAgentName(message.threadId)}:</span>{' '}
                    {message.content}
                  </div>
                )}
                {message.type === 'thinking' && message.content && (
                  <div className="message-thinking">{message.content}</div>
                )}
                {message.type === 'tool' && (
                  <div className="message-tool font-mono text-xs">
                    <pre className="whitespace-pre-wrap">{message.content}</pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-800">
        <div className="flex items-center gap-2">
          {session.agents.length > 0 && (
            <select
              value={activeAgentId || ''}
              onChange={(e) => setActiveAgentId(e.target.value as ThreadId)}
              className="px-2 py-1 bg-gray-800 rounded text-sm focus:outline-none focus:ring-2 focus:ring-terminal-green"
            >
              <option value={session.id}>Session</option>
              {session.agents.map((agent) => (
                <option key={agent.threadId} value={agent.threadId}>
                  {agent.name} ({agent.status})
                </option>
              ))}
            </select>
          )}
          <span className="terminal-prompt">❯</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading || !connected}
            placeholder={loading ? 'Sending...' : 'Type your message...'}
            className="terminal-input"
            autoFocus
          />
        </div>
      </form>
    </div>
  );
}
