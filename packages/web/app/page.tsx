'use client';

import { useState, useEffect } from 'react';
import type { Session, ThreadId, SessionEvent } from '@/types/api';
import { ConversationDisplay } from '@/components/ConversationDisplay';

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<ThreadId | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [agentName, setAgentName] = useState('');
  const [message, setMessage] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<ThreadId | null>(null);
  const [sendingMessage, setSendingMessage] = useState(false);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  // Connect to SSE when session selected
  useEffect(() => {
    if (!selectedSession) return;
    
    // Clear events when switching sessions
    setEvents([]);
    setSelectedAgent(null);

    const eventSource = new EventSource(`/api/sessions/${selectedSession}/events/stream`);
    
    // Listen to all event types
    const eventTypes = [
      'USER_MESSAGE', 'AGENT_MESSAGE', 'TOOL_CALL', 'TOOL_RESULT', 
      'THINKING', 'SYSTEM_MESSAGE', 'LOCAL_SYSTEM_MESSAGE'
    ];
    
    eventTypes.forEach(eventType => {
      eventSource.addEventListener(eventType, (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          setEvents(prev => [...prev, data as SessionEvent]);
        } catch (error) {
          console.error('Failed to parse event:', error);
        }
      });
    });

    eventSource.addEventListener('connection', (event) => {
      const connectionEvent: SessionEvent = {
        type: 'LOCAL_SYSTEM_MESSAGE',
        threadId: selectedSession,
        timestamp: new Date().toISOString(),
        data: { message: 'Connected to session stream' }
      };
      setEvents(prev => [...prev, connectionEvent]);
    });

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      const errorEvent: SessionEvent = {
        type: 'LOCAL_SYSTEM_MESSAGE',
        threadId: selectedSession,
        timestamp: new Date().toISOString(),
        data: { message: 'Connection lost' }
      };
      setEvents(prev => [...prev, errorEvent]);
    };

    return () => {
      eventSource.close();
    };
  }, [selectedSession]);

  async function loadSessions() {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  }

  async function createSession() {
    if (!sessionName.trim()) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sessionName })
      });
      
      if (res.ok) {
        const data = await res.json();
        setSelectedSession(data.session.id);
        setSessionName('');
        await loadSessions();
      }
    } catch (error) {
      console.error('Failed to create session:', error);
    }
    setLoading(false);
  }

  async function spawnAgent() {
    if (!selectedSession || !agentName.trim()) return;
    
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${selectedSession}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: agentName,
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-20241022'
        })
      });
      
      if (res.ok) {
        setAgentName('');
        await loadSessions();
        // Select the new agent
        const data = await res.json();
        if (data.agent?.threadId) {
          setSelectedAgent(data.agent.threadId);
        }
      }
    } catch (error) {
      console.error('Failed to spawn agent:', error);
    }
    setLoading(false);
  }

  async function sendMessage() {
    if (!selectedAgent || !message.trim()) return;
    
    setSendingMessage(true);
    try {
      const res = await fetch(`/api/threads/${selectedAgent}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      
      if (res.ok) {
        setMessage('');
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
    setSendingMessage(false);
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Lace Web Interface</h1>
        
        {/* Session Creation */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <h2 className="text-xl mb-4">Create New Session</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="Session name..."
              className="flex-1 px-3 py-2 bg-gray-700 rounded text-white"
              onKeyDown={(e) => e.key === 'Enter' && createSession()}
            />
            <button
              onClick={createSession}
              disabled={loading || !sessionName.trim()}
              className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>

        {/* Sessions List */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <h2 className="text-xl mb-4">Sessions</h2>
          {sessions.length === 0 ? (
            <p className="text-gray-400">No sessions yet</p>
          ) : (
            <div className="space-y-2">
              {sessions.map(session => (
                <div
                  key={session.id}
                  onClick={() => setSelectedSession(session.id)}
                  className={`p-3 rounded cursor-pointer ${
                    selectedSession === session.id 
                      ? 'bg-blue-600' 
                      : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  <div className="font-semibold">{session.name}</div>
                  <div className="text-sm text-gray-300">
                    {session.agents.length} agents • {new Date(session.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Selected Session Details */}
        {selectedSession && (
          <>
            {/* Agent Management */}
            <div className="bg-gray-800 rounded-lg p-4 mb-6">
              <h2 className="text-xl mb-4">Agents</h2>
              <div className="mb-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="Agent name..."
                    className="flex-1 px-3 py-2 bg-gray-700 rounded text-white"
                    onKeyDown={(e) => e.key === 'Enter' && spawnAgent()}
                  />
                  <button
                    onClick={spawnAgent}
                    disabled={loading || !agentName.trim()}
                    className="px-4 py-2 bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    Spawn Agent
                  </button>
                </div>
              </div>
              
              {/* Agent List */}
              {sessions.find(s => s.id === selectedSession)?.agents.map(agent => (
                <div
                  key={agent.threadId}
                  onClick={() => setSelectedAgent(agent.threadId)}
                  className={`p-3 mb-2 rounded cursor-pointer ${
                    selectedAgent === agent.threadId 
                      ? 'bg-green-600' 
                      : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  <div className="font-semibold">{agent.name}</div>
                  <div className="text-sm text-gray-300">
                    {agent.threadId} • {agent.status}
                  </div>
                </div>
              ))}
            </div>

            {/* Message Input */}
            {selectedAgent && (
              <div className="bg-gray-800 rounded-lg p-4 mb-6">
                <h2 className="text-xl mb-4">Send Message</h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Type your message..."
                    className="flex-1 px-3 py-2 bg-gray-700 rounded text-white"
                    onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                    disabled={sendingMessage}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={sendingMessage || !message.trim()}
                    className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </div>
            )}

            {/* Conversation Display */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h2 className="text-xl mb-4">Conversation</h2>
              <ConversationDisplay 
                events={events} 
                agents={sessions.find(s => s.id === selectedSession)?.agents}
                className="h-96" 
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}