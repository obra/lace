'use client';

import { useState, useEffect } from 'react';
import type { Session, ThreadId } from '@/types/api';

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<ThreadId | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<string[]>([]);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  // Connect to SSE when session selected
  useEffect(() => {
    if (!selectedSession) return;

    const eventSource = new EventSource(`/api/sessions/${selectedSession}/events/stream`);
    
    eventSource.onmessage = (event) => {
      setEvents(prev => [...prev, `Message: ${event.data}`]);
    };

    eventSource.addEventListener('connection', (event) => {
      setEvents(prev => [...prev, `Connected: ${event.data}`]);
    });

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      setEvents(prev => [...prev, `Error: Connection lost`]);
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

        {/* Events Stream */}
        {selectedSession && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-xl mb-4">Events Stream</h2>
            <div className="bg-gray-900 rounded p-4 h-64 overflow-y-auto font-mono text-sm">
              {events.length === 0 ? (
                <p className="text-gray-400">Connecting...</p>
              ) : (
                events.map((event, i) => (
                  <div key={i} className="mb-1">{event}</div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}